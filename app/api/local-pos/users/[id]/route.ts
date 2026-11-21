import { z } from 'zod';
import { setLocalStaffEnabled, resetLocalStaffPassword } from '@/lib/local-pos/auth';
import { LocalPosError } from '@/lib/local-pos/auth';
import {
  assertLocalPosOrigin,
  logLocalPosFailure,
  localPosJson,
  readLocalPosJson,
  requireLocalPosUser,
} from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const mutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['enable', 'disable']) }).strict(),
  z.object({ action: z.literal('reset-password'), password: z.string().max(128) }).strict(),
]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertLocalPosOrigin(request);
    const actor = await requireLocalPosUser(['super_user', 'pos_manager']);
    const { id } = await context.params;
    if (!/^[a-f0-9]{32}$/.test(id))
      throw new LocalPosError('The selected staff account is unavailable.', 404, 'user_not_found');
    const input = mutationSchema.parse(await readLocalPosJson(request));
    if (input.action === 'reset-password') await resetLocalStaffPassword(actor, id, input.password);
    else setLocalStaffEnabled(actor, id, input.action === 'enable');
    return localPosJson({ updated: true });
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
