import assert from 'node:assert/strict';
import test from 'node:test';
import { createRazorpayRefund, type RazorpayConfig } from '../lib/payments/razorpay';
const config: RazorpayConfig = {
  mode: 'test',
  paymentMode: 'razorpay_test',
  keyId: 'rzp_test_fixture123',
  keySecret: 'fixture-secret-only',
  webhookSecret: 'fixture-webhook-only',
};
const input = {
  paymentId: 'pay_fixture123',
  amount: 1000,
  idempotencyKey: 'cancel_11111111-1111-4111-8111-111111111111',
};
function response(overrides = {}) {
  return Response.json({
    entity: 'refund',
    id: 'rfnd_fixture123',
    payment_id: input.paymentId,
    amount: input.amount,
    currency: 'INR',
    status: 'pending',
    created_at: Math.floor(Date.now() / 1000),
    ...overrides,
  });
}
test('cancellation refund retries preserve provider idempotency key, amount and server authentication', async () => {
  const calls: RequestInit[] = [];
  const request = (async (url, options) => {
    assert.equal(String(url), 'https://api.razorpay.com/v1/payments/pay_fixture123/refund');
    calls.push(options!);
    return response();
  }) as typeof fetch;
  for (let i = 0; i < 2; i++)
    assert.equal((await createRazorpayRefund(config, input, request)).status, 'pending');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    const headers = new Headers(call.headers);
    assert.equal(call.method, 'POST');
    assert.equal(headers.get('X-Refund-Idempotency'), input.idempotencyKey);
    assert.match(headers.get('Authorization')!, /^Basic /);
    assert.deepEqual(JSON.parse(String(call.body)), { amount: 1000 });
  }
});
test('invalid refund inputs never contact the provider', async () => {
  let calls = 0;
  const request = (async () => {
    calls++;
    return response();
  }) as typeof fetch;
  for (const change of [
    { amount: 0 },
    { amount: -1 },
    { amount: 1.5 },
    { amount: 100000001 },
    { paymentId: 'bad' },
    { idempotencyKey: 'short' },
  ])
    await assert.rejects(createRazorpayRefund(config, { ...input, ...change }, request));
  assert.equal(calls, 0);
});
test('refund response must match the stored payment and requested amount', async () => {
  for (const change of [{ payment_id: 'pay_other123' }, { amount: 999 }, { currency: 'USD' }])
    await assert.rejects(
      createRazorpayRefund(config, input, (async () => response(change)) as typeof fetch),
    );
});
test('uncertain provider response is an error, never a fabricated processed refund', async () => {
  await assert.rejects(
    createRazorpayRefund(config, input, (async () => {
      throw new Error('timeout');
    }) as typeof fetch),
  );
  await assert.rejects(
    createRazorpayRefund(
      config,
      input,
      (async () => new Response('unavailable', { status: 503 })) as typeof fetch,
    ),
  );
});

test('cancelled-order refund requires matching verified capture and reuses an existing full refund', async () => {
  const { refundCancelledRazorpayOrder } = await import('../lib/payments/service');
  const order={id:'11111111-1111-4111-8111-111111111111',total:1000,status:'cancelled',paymentStatus:'paid',paymentMode:'razorpay_test'};
  const attempt={id:order.id,order_id:order.id,mode:'test',amount:1000,currency:'INR',receipt:'fixture',state:'captured',provider_order_id:'order_fixture123'};
  for(const existing of [false,true]) {
    let posted=0;let created=existing;const rpcCalls:string[]=[];
    const payment={entity:'payment',id:'pay_fixture123',order_id:attempt.provider_order_id,amount:1000,currency:'INR',status:'captured',captured:true,amount_refunded:0};
    const refund={entity:'refund',id:'rfnd_fixture123',payment_id:payment.id,amount:1000,currency:'INR',status:'pending',created_at:Math.floor(Date.now()/1000)};
    const db={rpc:async(name:string)=>{rpcCalls.push(name);return {data:name==='hpa_payment_reconciliation_attempts'?[attempt]:{ok:true},error:null};}};
    const request=(async(url,options)=>{
      const path=new URL(String(url)).pathname;
      if(options?.method==='POST'){posted++;created=true;return Response.json(refund);}
      if(path.endsWith('/payments')) return Response.json({entity:'collection',count:1,items:[payment]});
      if(path.endsWith('/refunds')) return Response.json({entity:'collection',count:created?1:0,items:created?[refund]:[]});
      return Response.json(payment);
    }) as typeof fetch;
    await refundCancelledRazorpayOrder(db,config,order,request);
    assert.equal(posted,existing?0:1);
    assert.ok(rpcCalls.includes('hpa_payment_sync_refunds'));
    await assert.rejects(refundCancelledRazorpayOrder(db,config,{...order,status:'preparing'},request));
  }
});
