import crypto from 'crypto';
import Razorpay from 'razorpay';

export const razorpayKeyId =
  process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || '';
export const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET || '';

export const isRazorpayConfigured = Boolean(razorpayKeyId && razorpayKeySecret);

/**
 * Returns a Razorpay client instance if keys are provided.
 */
export function getRazorpayClient(): Razorpay | null {
  if (!isRazorpayConfigured) {
    return null;
  }
  return new Razorpay({
    key_id: razorpayKeyId,
    key_secret: razorpayKeySecret,
  });
}

/**
 * Verifies Razorpay payment signature using HMAC SHA256.
 * Signature formula: HMAC-SHA256(order_id + "|" + payment_id, secret)
 */
export function verifyRazorpaySignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
  secret?: string;
}): boolean {
  const secret = params.secret || razorpayKeySecret;
  if (!secret) return false;

  const generatedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest('hex');

  return generatedSignature === params.signature;
}

/**
 * Verifies Razorpay webhook signature.
 */
export function verifyWebhookSignature(body: string, signature: string, secret?: string): boolean {
  const webhookSecret = secret || process.env.RAZORPAY_WEBHOOK_SECRET || razorpayKeySecret;
  if (!webhookSecret) return false;

  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex');

  return expectedSignature === signature;
}
