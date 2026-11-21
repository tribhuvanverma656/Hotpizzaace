import { z } from 'zod';
import { findLocalCustomerAddress } from '@/lib/local-pos/orders';
import {
  logLocalPosFailure,
  localPosJson,
  requireLocalPosUser,
} from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const phoneSchema = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number.');

export async function GET(request: Request) {
  try {
    await requireLocalPosUser(['super_user', 'pos_manager']);
    const phone = phoneSchema.parse(new URL(request.url).searchParams.get('phone'));
    return localPosJson({ customer: findLocalCustomerAddress(phone) });
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
