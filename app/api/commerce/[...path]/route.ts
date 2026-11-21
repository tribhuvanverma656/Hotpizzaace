import { proxyCommerce } from '@/lib/commerce/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) {
  return proxyCommerce(request, (await context.params).path);
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
