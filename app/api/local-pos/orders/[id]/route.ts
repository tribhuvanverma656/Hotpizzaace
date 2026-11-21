import { z } from 'zod';
import {
  acknowledgeLocalOrderChange,
  collectLocalPayment,
  editLocalOrder,
  updateLocalOrderStatus,
} from '@/lib/local-pos/orders';
import { LocalPosError } from '@/lib/local-pos/errors';
import {
  assertLocalPosOrigin,
  logLocalPosFailure,
  localPosJson,
  readLocalPosJson,
  requireLocalPosUser,
} from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), expectedVersion: z.number().int().min(1), status: z.enum(['preparing', 'ready']) }).strict(),
  z.object({ action: z.literal('acknowledge'), expectedVersion: z.number().int().min(1) }).strict(),
  z.object({ action: z.literal('payment'), expectedVersion: z.number().int().min(1), payment: z.unknown() }).strict(),
  z.object({ action: z.literal('edit'), order: z.unknown() }).strict(),
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertLocalPosOrigin(request);
    const actor = await requireLocalPosUser();
    const { id } = await context.params;
    if (!/^[a-f0-9-]{36}$/i.test(id))
      throw new LocalPosError('This order could not be found.', 404, 'order_not_found');
    const action = actionSchema.parse(await readLocalPosJson(request));
    let order;
    switch (action.action) {
      case 'status':
        if (actor.role !== 'kitchen' && actor.role !== 'pos_manager' && actor.role !== 'super_user')
          throw new LocalPosError(
            'Order status updates require a Kitchen, POS Manager or Super User login.',
            403,
            'role_denied',
          );
        order = updateLocalOrderStatus(actor, id, {
          expectedVersion: action.expectedVersion,
          status: action.status,
        });
        break;
      case 'acknowledge':
        if (actor.role !== 'kitchen' && actor.role !== 'super_user')
          throw new LocalPosError(
            'Kitchen update acknowledgements require a Kitchen or Super User login.',
            403,
            'role_denied',
          );
        order = acknowledgeLocalOrderChange(actor, id, action.expectedVersion);
        break;
      case 'payment':
        order = collectLocalPayment(actor, id, action.expectedVersion, action.payment);
        break;
      case 'edit':
        order = editLocalOrder(actor, id, action.order);
        break;
    }
    return localPosJson({ order });
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
