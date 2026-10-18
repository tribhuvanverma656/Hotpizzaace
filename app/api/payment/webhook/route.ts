import { NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/razorpay';
import { getServiceSupabase } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-razorpay-signature') || '';

    if (!verifyWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });
    }

    const event = JSON.parse(rawBody);
    const eventType = event.event;
    const paymentEntity = event.payload?.payment?.entity;
    const razorpayOrderId = paymentEntity?.order_id;

    const supabase = getServiceSupabase();
    if (!supabase || !razorpayOrderId) {
      return NextResponse.json({ received: true });
    }

    if (eventType === 'payment.captured') {
      await supabase
        .from('payments')
        .update({
          razorpay_payment_id: paymentEntity.id,
          status: 'captured',
          method: paymentEntity.method,
          updated_at: new Date().toISOString(),
        })
        .eq('razorpay_order_id', razorpayOrderId);

      // Fetch payment record to find app order_id
      const { data: paymentRecord } = await supabase
        .from('payments')
        .select('order_id')
        .eq('razorpay_order_id', razorpayOrderId)
        .single();

      if (paymentRecord?.order_id) {
        await supabase
          .from('orders')
          .update({
            payment_status: 'paid',
            status: 'confirmed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', paymentRecord.order_id);
      }
    } else if (eventType === 'payment.failed') {
      await supabase
        .from('payments')
        .update({
          status: 'failed',
          error_code: paymentEntity.error_code,
          error_description: paymentEntity.error_description,
          updated_at: new Date().toISOString(),
        })
        .eq('razorpay_order_id', razorpayOrderId);
    }

    return NextResponse.json({ received: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Webhook processing failed';
    console.error('Webhook error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
