import { passwordRequestOrigin, passwordResponseHeaders } from '@/lib/auth/password';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const origin = passwordRequestOrigin(request, {});
  if (origin instanceof Response) return origin;
  return Response.json(
    { error: 'Email password recovery is currently disabled.' },
    { status: 404, headers: passwordResponseHeaders },
  );
}
