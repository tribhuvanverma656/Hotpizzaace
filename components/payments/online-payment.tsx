'use client';

import type { Order } from '@/types';
import { gatewayProvider } from '@/lib/payments/method';
import { PhonePePayment } from './phonepe-payment';
import { RazorpayPayment } from './razorpay-payment';

/** Each saved order keeps the gateway it was created with; historical Razorpay orders still resolve. */
export function OnlinePayment(props: { order: Order; onConfirmed?: (order: Order) => void }) {
  const provider = gatewayProvider(props.order.paymentMode);
  if (provider === 'phonepe') return <PhonePePayment {...props} />;
  if (provider === 'razorpay') return <RazorpayPayment {...props} />;
  return null;
}
