import { CommerceError } from '@/lib/commerce/domain';
import {
  assertLocalPosOrigin,
  localPosJson,
  logLocalPosFailure,
  readLocalPosJson,
  requireLocalPosUser,
} from '@/lib/local-pos/http';
import { listLocalPosCatalog, updateLocalPosCatalog } from '@/lib/local-pos/products';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireLocalPosUser(['super_user', 'pos_manager']);
    return localPosJson(listLocalPosCatalog());
  } catch (error) {
    return logLocalPosFailure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertLocalPosOrigin(request);
    const user = await requireLocalPosUser(['super_user', 'pos_manager']);
    const catalog = updateLocalPosCatalog(user.role, await readLocalPosJson(request, 3_100_000));
    return localPosJson({ catalog });
  } catch (error) {
    if (error instanceof CommerceError)
      return localPosJson({ error: error.message, code: error.code }, error.status);
    return logLocalPosFailure(error);
  }
}
