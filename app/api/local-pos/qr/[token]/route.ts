import { LocalPosError } from '@/lib/local-pos/errors';
import { createLocalQrOrder, getLocalQrMenu } from '@/lib/local-pos/qr-ordering';
import {
  assertLocalPosOrigin,
  localPosJson,
  logLocalPosFailure,
  readLocalPosJson,
} from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseToken(token: string): string {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new LocalPosError(
      'This restaurant QR is unavailable. Ask staff for the current QR.',
      404,
      'qr_not_found',
    );
  return token;
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    return localPosJson(getLocalQrMenu(parseToken(token)));
  } catch (error) {
    return logLocalPosFailure(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    assertLocalPosOrigin(request);
    const { token } = await context.params;
    const body = await readLocalPosJson(request);
    return localPosJson({ order: createLocalQrOrder(parseToken(token), body) }, 201);
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
