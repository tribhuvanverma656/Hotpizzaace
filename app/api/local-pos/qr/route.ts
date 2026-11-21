import { z } from 'zod';
import { getLocalQrState, setLocalQrState } from '@/lib/local-pos/qr-ordering';
import {
  assertLocalPosOrigin,
  localPosJson,
  logLocalPosFailure,
  readLocalPosJson,
  requireLocalPosUser,
} from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const actionSchema = z.object({ action: z.enum(['enable', 'rotate', 'disable']) }).strict();

export async function GET() {
  try {
    await requireLocalPosUser(['super_user', 'pos_manager']);
    return localPosJson(getLocalQrState());
  } catch (error) {
    return logLocalPosFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLocalPosOrigin(request);
    await requireLocalPosUser(['super_user', 'pos_manager']);
    const body = actionSchema.parse(await readLocalPosJson(request));
    return localPosJson(setLocalQrState(body.action));
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
