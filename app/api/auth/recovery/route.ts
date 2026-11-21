import { passwordRequestOrigin, passwordResponseHeaders } from '@/lib/auth/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const origin = passwordRequestOrigin(request, {});
  if (origin instanceof Response) return origin;
  return Response.json(
    { ok: false, error: 'recovery_disabled' },
    { status: 404, headers: passwordResponseHeaders },
  );
}

// Email scanners and browser prefetch must never consume a recovery token on GET.
export function GET() {
  return Response.json(
    { error: 'Method not allowed.' },
    {
      status: 405,
      headers: { ...passwordResponseHeaders, Allow: 'POST' },
    },
  );
}
