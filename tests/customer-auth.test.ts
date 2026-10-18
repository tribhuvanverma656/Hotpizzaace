import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomerPhone, verifyDemoCustomerLogin } from '../lib/customer-auth';
import { getOrdersForCustomer } from '../lib/order-tracking';
import { initialOrders } from '../lib/data';
import { useDemoStore } from '../lib/store';

test('demo login validates Indian mobiles and rejects incorrect demo codes', () => {
  for (const phone of ['9876543210', '+91 98765 43210', '91-9876543210'])
    assert.equal(normalizeCustomerPhone(phone), '9876543210');
  for (const phone of ['12345', '1234567890', '+1 9876543210', '98765432100'])
    assert.throws(() => normalizeCustomerPhone(phone));
  assert.throws(() => verifyDemoCustomerLogin('9876543210', '000000'), /123456/);
  assert.deepEqual(verifyDemoCustomerLogin('+919876543210', '123456'), { phone: '9876543210' });
});
test('customer demo sessions remain independent of the admin session and can sign out', () => {
  useDemoStore.setState({ customerSession: null, adminSession: false });
  assert.throws(() => useDemoStore.getState().loginCustomer('9876543210', '000000'));
  assert.equal(useDemoStore.getState().customerSession, null);
  useDemoStore.getState().loginCustomer('9876543210', '123456');
  assert.deepEqual(useDemoStore.getState().customerSession, { phone: '9876543210' });
  assert.equal(useDemoStore.getState().adminSession, false);
  useDemoStore.getState().logoutCustomer();
  assert.equal(useDemoStore.getState().customerSession, null);
});
test('signed-in order lists match normalized mobile and exclude another customer', () => {
  const own = {
    ...initialOrders[0],
    id: 'own',
    createdAt: '2026-10-17T11:00:00.000Z',
    customer: { ...initialOrders[0].customer, phone: '+91 98765 43210' },
  };
  const older = { ...own, id: 'older', createdAt: '2026-10-17T10:00:00.000Z' };
  const other = { ...own, id: 'other', customer: { ...own.customer, phone: '9988776655' } };
  assert.deepEqual(
    getOrdersForCustomer([other, older, own], '9876543210').map((order) => order.id),
    ['own', 'older'],
  );
  assert.deepEqual(getOrdersForCustomer([other, older, own], '9123456789'), []);
});
