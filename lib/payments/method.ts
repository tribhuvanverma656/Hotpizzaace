export const paymentMethodLabels = {
  upi: 'UPI',
  card: 'Debit / credit card',
  cash: 'Cash',
} as const;

/** Hosted Checkout may use another method; the original order field records the selection only. */
export function getPaymentMethodDetails(order: { paymentMode?: string; paymentMethod: string }) {
  const provider = gatewayProvider(order.paymentMode);
  return {
    provider,
    paymentMethod: provider ? null : order.paymentMethod,
    requestedPaymentMethod: provider ? order.paymentMethod : null,
  };
}

/** Website orders paid through a hosted gateway. Historical Razorpay rows stay valid. */
export type GatewayProvider = 'razorpay' | 'phonepe';
export function gatewayProvider(mode: string | undefined | null): GatewayProvider | null {
  if (mode === 'razorpay_test' || mode === 'razorpay_live') return 'razorpay';
  if (mode === 'phonepe_test' || mode === 'phonepe_live') return 'phonepe';
  return null;
}
export function isGatewayMode(mode: string | undefined | null): boolean {
  return gatewayProvider(mode) !== null;
}
export function isLiveGatewayMode(mode: string | undefined | null): boolean {
  return mode === 'razorpay_live' || mode === 'phonepe_live';
}
export function isTestGatewayMode(mode: string | undefined | null): boolean {
  return mode === 'razorpay_test' || mode === 'phonepe_test';
}
export const gatewayLabels: Record<GatewayProvider, string> = {
  razorpay: 'Razorpay',
  phonepe: 'PhonePe',
};
