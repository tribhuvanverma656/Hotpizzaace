export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Local process liveness only; dependency readiness remains at /api/health. */
export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
