import { currentLocalPosUser, localPosJson, logLocalPosFailure } from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return localPosJson({ user: await currentLocalPosUser() });
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
