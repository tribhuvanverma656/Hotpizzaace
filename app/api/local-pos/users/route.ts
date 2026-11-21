import { z } from 'zod';
import { createLocalStaffUser } from '@/lib/local-pos/auth';
import { listLocalUsers } from '@/lib/local-pos/database';
import {
  assertLocalPosOrigin,
  logLocalPosFailure,
  localPosJson,
  readLocalPosJson,
  requireLocalPosUser,
} from '@/lib/local-pos/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const createUserSchema = z
  .object({
    username: z.string().max(32),
    displayName: z.string().max(80),
    password: z.string().max(128),
    role: z.enum(['pos_manager', 'kitchen']),
  })
  .strict();

export async function GET() {
  try {
    const user = await requireLocalPosUser(['super_user', 'pos_manager']);
    const users = listLocalUsers().filter(
      (entry) =>
        entry.role !== 'super_user' && (user.role === 'super_user' || entry.role === 'kitchen'),
    );
    return localPosJson({ users });
  } catch (error) {
    return logLocalPosFailure(error);
  }
}

export async function POST(request: Request) {
  try {
    assertLocalPosOrigin(request);
    const creator = await requireLocalPosUser(['super_user', 'pos_manager']);
    const input = createUserSchema.parse(await readLocalPosJson(request));
    const user = await createLocalStaffUser(creator, input);
    return localPosJson({ user }, 201);
  } catch (error) {
    return logLocalPosFailure(error);
  }
}
