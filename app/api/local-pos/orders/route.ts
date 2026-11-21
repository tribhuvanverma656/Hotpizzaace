import { z } from 'zod';
import { createLocalOrder, listLocalOrders } from '@/lib/local-pos/orders';
import { localBusinessDate } from '@/lib/local-pos/business-day';
import {
  assertLocalPosOrigin,
  logLocalPosFailure,
  localPosJson,
  readLocalPosJson,
  requireLocalPosUser,
} from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireLocalPosUser();
    const rawDate = new URL(request.url).searchParams.get('date');
    const date = rawDate
      ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(rawDate)
      : localBusinessDate(new Date());
    const orders = listLocalOrders(date);
    return localPosJson({
      orders:
        user.role === 'kitchen'
          ? orders.filter((order) => ['confirmed', 'preparing', 'ready'].includes(order.status))
          : orders,
      businessDate: date,
    });
  } catch (error) {
    return logLocalPosFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLocalPosOrigin(request);
    const actor = await requireLocalPosUser(['super_user', 'pos_manager']);
    const order = createLocalOrder(actor, await readLocalPosJson(request));
    return localPosJson({ order }, 201);
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
