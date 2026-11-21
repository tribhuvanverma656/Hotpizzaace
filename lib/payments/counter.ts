import type { Order } from '../../types';

/** Shared by counter fulfillment and financial reporting; no runtime pricing/domain dependencies. */
export function isStaffCounterPaymentComplete(order: Order): boolean {
  const payment = order.settlement;
  return (
    order.channel === 'counter' &&
    ['dine_in', 'delivery'].includes(order.fulfillment) &&
    order.paymentMode === 'counter_manual' &&
    order.paymentStatus === 'paid' &&
    !order.testVoid &&
    !order.paymentReviewRequired &&
    Number.isSafeInteger(order.total) &&
    order.total > 0 &&
    !!payment &&
    payment.source === 'staff' &&
    payment.amount === order.total &&
    payment.method === order.paymentMethod &&
    !!payment.confirmedBy &&
    Number.isFinite(Date.parse(payment.confirmedAt)) &&
    (payment.method === 'cash'
      ? Number.isSafeInteger(payment.cashTendered) &&
        Number(payment.cashTendered) >= order.total &&
        payment.change === Number(payment.cashTendered) - order.total
      : payment.method === 'upi' &&
        (payment.upiReference === undefined || /^[A-Z0-9]{6,80}$/.test(payment.upiReference)))
  );
}
