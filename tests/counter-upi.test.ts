import assert from 'node:assert/strict';
import test from 'node:test';
import { counterUpiLinks, readCounterUpiConfig, upiAmount } from '../lib/counter-upi';

test('counter UPI config needs a well-formed UPI ID and cleans the payee name', () => {
  assert.equal(readCounterUpiConfig(undefined, 'Shop'), null);
  assert.equal(readCounterUpiConfig('', 'Shop'), null);
  assert.equal(readCounterUpiConfig('not-a-upi-id', 'Shop'), null);
  assert.equal(readCounterUpiConfig('shop@ybl?am=1', 'Shop'), null);
  assert.equal(readCounterUpiConfig('javascript:alert(1)@x', 'Shop'), null);
  assert.deepEqual(readCounterUpiConfig(' hotpizza.ace@ybl ', 'Hot Pizza Ace <b>'), {
    vpa: 'hotpizza.ace@ybl',
    payeeName: 'Hot Pizza Ace b',
  });
  assert.equal(readCounterUpiConfig('q123@ybl', undefined)?.payeeName, 'Hot Pizza Ace');
});

test('UPI amounts are exact two-decimal rupees from paise', () => {
  assert.equal(upiAmount(45600), '456.00');
  assert.equal(upiAmount(45605), '456.05');
  assert.equal(upiAmount(100), '1.00');
  for (const bad of [0, -100, 1.5, Number.NaN, 10_000_001]) assert.throws(() => upiAmount(bad));
});

test('payment links carry the exact total, payee and request number', () => {
  const config = readCounterUpiConfig('hotpizza.ace@ybl', 'Hot Pizza Ace')!;
  const links = counterUpiLinks(config, { total: 45600, requestNumber: 'R-0042' });
  assert.equal(
    links.upi,
    'upi://pay?pa=hotpizza.ace%40ybl&pn=Hot%20Pizza%20Ace&am=456.00&cu=INR&tn=HPA%20R-0042',
  );
  assert.equal(links.amountText, '456.00');
  assert.equal(links.note, 'HPA R-0042');
  const params = new URL(links.upi.replace('upi://pay', 'https://x/')).searchParams;
  assert.equal(params.get('pa'), 'hotpizza.ace@ybl');
  assert.equal(params.get('am'), '456.00');
  assert.deepEqual(
    links.apps.map((app) => app.href.split('?')[0]),
    ['tez://upi/pay', 'phonepe://pay', 'paytmmp://pay'],
  );
  assert.ok(links.apps.every((app) => app.href.endsWith(links.upi.split('?')[1])));
});

test('request numbers cannot inject extra UPI parameters', () => {
  const config = readCounterUpiConfig('shop@ybl', 'Shop')!;
  const links = counterUpiLinks(config, { total: 1000, requestNumber: 'R-1&am=1&pa=evil@x' });
  const params = new URL(links.upi.replace('upi://pay', 'https://x/')).searchParams;
  assert.equal(params.get('am'), '10.00');
  assert.equal(params.get('pa'), 'shop@ybl');
  assert.equal(params.getAll('pa').length, 1);
  assert.ok(params.get('tn')!.length <= 34);
});
