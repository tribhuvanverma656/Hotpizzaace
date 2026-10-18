import { NextResponse } from 'next/server';
import { verifyRazorpaySignature, isRazorpayConfigured } from '@/lib/razorpay';
import { getServiceSupabase } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      orderId, // App's internal order ID
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = body;

    // Handle mock verification when keys are not configured
    if (!isRazorpayConfigured) {
      return NextResponse.json({
        success: true,
        mock: true,
        message: 'Signature verified in simulated test mode.',
      });
    }

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { error: 'Missing required Razorpay payment verification fields' },
        { status: 400 },
      );
    }

    const isValid = verifyRazorpaySignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!isValid) {
      // Record failed payment if Supabase is connected
      const supabase = getServiceSupabase();
      if (supabase && orderId) {
        await supabase
          .from('payments')
          .update({
            status: 'failed',
            error_code: 'BAD_SIGNATURE',
            error_description: 'Signature verification mismatch',
            updated_at: new Date().toISOString(),
          })
          .eq('razorpay_order_id', razorpay_order_id);

        await supabase
          .from('orders')
          .update({
            payment_status: 'failed',
            updated_at: new Date().toISOString(),
          })
          .eq('id', orderId);
      }

      return NextResponse.json(
        { error: 'Invalid payment signature. Verification failed.' },
        { status: 400 },
      );
    }

    // Payment Signature is Valid! Update Supabase database
    const supabase = getServiceSupabase();
    if (supabase && orderId) {
      await supabase
        .from('payments')
        .update({
          razorpay_payment_id,
          razorpay_signature,
          status: 'captured',
          updated_at: new Date().toISOString(),
        })
        .eq('razorpay_order_id', razorpay_order_id);

      await supabase
        .from('orders')
        .update({
          payment_status: 'paid',
          status: 'confirmed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId);
    }

    return NextResponse.json({
      success: true,
      message: 'Payment verified and captured successfully.',
      razorpay_payment_id,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Payment verification encountered an unexpected error';
    console.error('Payment verification error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
