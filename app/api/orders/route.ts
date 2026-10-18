import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const orderData = await request.json();

    const supabase = getServiceSupabase();
    if (!supabase) {
      // In local demo or when Supabase is not yet configured, return acknowledgment
      return NextResponse.json({
        success: true,
        order: orderData,
        source: 'local',
      });
    }

    const { data, error } = await supabase
      .from('orders')
      .insert({
        id: orderData.id,
        number: orderData.number,
        customer: orderData.customer,
        fulfillment: orderData.fulfillment,
        items: orderData.items,
        subtotal: orderData.subtotal,
        delivery_fee: orderData.deliveryFee ?? 0,
        discount: orderData.discount ?? 0,
        total: orderData.total,
        coupon: orderData.coupon || '',
        payment_method: orderData.paymentMethod,
        payment_status: orderData.paymentStatus,
        status: orderData.status,
        branch_id: orderData.branchId || 'barra',
        branch_name: orderData.branchName || 'Barra · Kanpur',
        branch_address: orderData.branchAddress,
        branch_phone: orderData.branchPhone,
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase order insert error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, order: data, source: 'supabase' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to process order';
    console.error('Order creation error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const phone = searchParams.get('phone');

    const supabase = getServiceSupabase();
    if (!supabase) {
      return NextResponse.json({ orders: [], source: 'local' });
    }

    let query = supabase.from('orders').select('*');

    if (id) {
      query = query.eq('id', id);
    } else if (phone) {
      query = query.filter('customer->>phone', 'eq', phone);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ orders: data, source: 'supabase' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to fetch orders';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
