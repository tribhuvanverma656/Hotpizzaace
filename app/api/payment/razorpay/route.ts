import { NextResponse } from 'next/server';
import { getRazorpayClient, razorpayKeyId } from '@/lib/razorpay';
import { getServiceSupabase } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { orderId, amount, receipt, notes } = body;

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Valid payment amount in paise is required' },
        { status: 400 },
      );
    }

    const razorpay = getRazorpayClient();

    // Fallback if Razorpay keys are not yet configured in environment
    if (!razorpay) {
      const mockRazorpayOrderId = `order_mock_${Date.now()}`;
      return NextResponse.json({
        mock: true,
        orderId: mockRazorpayOrderId,
        amount,
        currency: 'INR',
        keyId: razorpayKeyId || 'rzp_test_mock',
        message: 'Razorpay keys not configured; operating in simulated fallback mode.',
      });
    }

    // Razorpay amounts are strictly in paise (integers)
    const options = {
      amount: Math.round(amount),
      currency: 'INR',
      receipt: receipt || (orderId ? `rcpt_${orderId.slice(0, 30)}` : `rcpt_${Date.now()}`),
      notes: notes || {},
    };

    const razorpayOrder = await razorpay.orders.create(options);

    // Save payment attempt to Supabase if available
    const supabase = getServiceSupabase();
    if (supabase && orderId) {
      await supabase.from('payments').insert({
        order_id: orderId,
        provider: 'razorpay',
        razorpay_order_id: razorpayOrder.id,
        amount: Math.round(amount),
        currency: 'INR',
        status: 'created',
      });
    }

    return NextResponse.json({
      success: true,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: razorpayKeyId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to create Razorpay order';
    console.error('Razorpay order creation error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
