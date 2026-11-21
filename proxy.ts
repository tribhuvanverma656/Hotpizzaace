import { NextResponse, type NextRequest } from 'next/server';
import { canonicalPageRedirect } from '@/lib/canonical-origin';
import { updateSupabaseSession } from '@/lib/supabase/proxy';
import { isLocalPosPath, localPosEnabled } from '@/lib/local-pos/availability';

export function proxy(request: NextRequest) {
  // The local POS exists only on the restaurant computer; hosted sites never expose it.
  if (isLocalPosPath(request.nextUrl.pathname) && !localPosEnabled())
    return new NextResponse('Not found', {
      status: 404,
      headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'text/plain' },
    });
  const destination = canonicalPageRedirect(request);
  if (destination) {
    const response = NextResponse.redirect(destination, 307);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }
  const pathname = request.nextUrl.pathname;
  // Public pages need only the domain redirect, not a Supabase request or session cookie write.
  if (
    pathname === '/checkout' ||
    ['/account', '/auth', '/api/auth', '/api/commerce'].some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  )
    return updateSupabaseSession(request);
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|.*\\.[^/]+$).*)',
    '/api/auth/:path*',
    '/api/commerce/:path*',
    '/api/local-pos/:path*',
  ],
};
