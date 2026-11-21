import { localPosIsConfigured } from '@/lib/local-pos/auth';
import { localPosJson, logLocalPosFailure } from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try {
    return localPosJson({ configured: localPosIsConfigured() });
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
