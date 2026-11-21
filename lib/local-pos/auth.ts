import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { listLocalUsers, openLocalPosDatabase, seedLocalCatalog, type LocalUser } from './database';
import { LocalPosError } from './errors';
export { LocalPosError } from './errors';

const PASSWORD_BYTES = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const LOCAL_SESSION_COOKIE = 'hpa_local_session';
export const LOCAL_SESSION_TTL_SECONDS = 12 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;

type Credentials = { username: string; displayName: string; password: string };
type UserCredentialRow = {
  id: string;
  username: string;
  displayName: string;
  role: LocalUser['role'];
  enabled: number;
  createdAt: string;
  passwordSalt: string;
  passwordHash: string;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, PASSWORD_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  return hash.toString('hex');
}

function parseCredentialRow(row: unknown): UserCredentialRow | undefined {
  if (!row || typeof row !== 'object') return undefined;
  return row as UserCredentialRow;
}

function publicUser(
  row: Pick<
    UserCredentialRow,
    'id' | 'username' | 'displayName' | 'role' | 'enabled' | 'createdAt'
  >,
): LocalUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
  };
}

export function localPosIsConfigured(database = openLocalPosDatabase()): boolean {
  return listLocalUsers(database).some((user) => user.role === 'super_user');
}

function validateCredentials(credentials: Credentials): Credentials {
  const username = credentials.username.trim().toLowerCase();
  const displayName = credentials.displayName.trim();
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username))
    throw new LocalPosError(
      'Use a username with 3–32 letters, numbers, dots, underscores, or hyphens.',
      400,
      'invalid_username',
    );
  if (displayName.length < 2 || displayName.length > 80)
    throw new LocalPosError(
      'Enter a display name between 2 and 80 characters.',
      400,
      'invalid_display_name',
    );
  if (
    credentials.password.length < 12 ||
    credentials.password.length > 128 ||
    !/\S/.test(credentials.password)
  )
    throw new LocalPosError('Use a password with 12–128 characters.', 400, 'invalid_password');
  return { username, displayName, password: credentials.password };
}

export async function createFirstSuperUser(
  input: Credentials,
  database = openLocalPosDatabase(),
): Promise<LocalUser> {
  const credentials = validateCredentials(input);
  const salt = randomBytes(16).toString('hex');
  const passwordHash = await hashPassword(credentials.password, salt);
  const user: LocalUser = {
    id: randomBytes(16).toString('hex'),
    username: credentials.username,
    displayName: credentials.displayName,
    role: 'super_user',
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  database.exec('BEGIN IMMEDIATE');
  try {
    if (localPosIsConfigured(database))
      throw new LocalPosError(
        'The first Super User has already been created.',
        409,
        'already_configured',
      );
    database
      .prepare(
        `INSERT INTO local_users
          (id, username, display_name, role, password_salt, password_hash, enabled, created_at)
         VALUES (?, ?, ?, 'super_user', ?, ?, 1, ?)`,
      )
      .run(user.id, user.username, user.displayName, salt, passwordHash, user.createdAt);
    seedLocalCatalog(database);
    database
      .prepare("INSERT OR REPLACE INTO local_meta(key, value) VALUES ('setup_complete', '1')")
      .run();
    database.exec('COMMIT');
    return user;
  } catch (error) {
    database.exec('ROLLBACK');
    if (error instanceof LocalPosError) throw error;
    throw error;
  }
}

export async function createAdditionalSuperUser(
  input: Credentials,
  database = openLocalPosDatabase(),
): Promise<LocalUser> {
  const credentials = validateCredentials(input);
  if (!localPosIsConfigured(database))
    throw new LocalPosError(
      'Use first-time setup to create the initial Super User.',
      409,
      'not_configured',
    );

  const salt = randomBytes(16).toString('hex');
  const passwordHash = await hashPassword(credentials.password, salt);
  const user: LocalUser = {
    id: randomBytes(16).toString('hex'),
    username: credentials.username,
    displayName: credentials.displayName,
    role: 'super_user',
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  try {
    database
      .prepare(
        `INSERT INTO local_users
          (id, username, display_name, role, password_salt, password_hash, enabled, created_at)
         VALUES (?, ?, ?, 'super_user', ?, ?, 1, ?)`,
      )
      .run(user.id, user.username, user.displayName, salt, passwordHash, user.createdAt);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed'))
      throw new LocalPosError('That username is already in use.', 409, 'username_conflict');
    throw error;
  }
  return user;
}

export function disableLocalSuperUser(
  username: string,
  replacementUsername: string,
  database = openLocalPosDatabase(),
): void {
  const normalizedUsername = username.trim().toLowerCase();
  const normalizedReplacement = replacementUsername.trim().toLowerCase();
  if (normalizedUsername === normalizedReplacement)
    throw new LocalPosError(
      'Choose a different Super User account to keep enabled.',
      400,
      'same_user',
    );

  database.exec('BEGIN IMMEDIATE');
  try {
    const target = database
      .prepare(
        "SELECT id FROM local_users WHERE username = ? AND role = 'super_user' AND enabled = 1",
      )
      .get(normalizedUsername) as { id: string } | undefined;
    const replacement = database
      .prepare(
        "SELECT id FROM local_users WHERE username = ? AND role = 'super_user' AND enabled = 1",
      )
      .get(normalizedReplacement) as { id: string } | undefined;
    if (!target)
      throw new LocalPosError(
        'The Super User account to disable is unavailable.',
        404,
        'user_not_found',
      );
    if (!replacement)
      throw new LocalPosError(
        'The replacement Super User must be enabled first.',
        409,
        'replacement_not_enabled',
      );

    const result = database
      .prepare(
        "UPDATE local_users SET enabled = 0 WHERE id = ? AND role = 'super_user' AND enabled = 1",
      )
      .run(target.id);
    if (result.changes !== 1)
      throw new LocalPosError(
        'The Super User account could not be disabled.',
        409,
        'disable_conflict',
      );
    database.prepare('DELETE FROM local_sessions WHERE user_id = ?').run(target.id);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export async function resetLocalAccountsWithSuperUser(
  input: Credentials,
  database = openLocalPosDatabase(),
): Promise<LocalUser> {
  const credentials = validateCredentials(input);
  const salt = randomBytes(16).toString('hex');
  const passwordHash = await hashPassword(credentials.password, salt);
  const user: LocalUser = {
    id: randomBytes(16).toString('hex'),
    username: credentials.username,
    displayName: credentials.displayName,
    role: 'super_user',
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  database.exec('BEGIN IMMEDIATE');
  try {
    database
      .prepare(
        `INSERT INTO local_users
          (id, username, display_name, role, password_salt, password_hash, enabled, created_at)
         VALUES (?, ?, ?, 'super_user', ?, ?, 1, ?)`,
      )
      .run(user.id, user.username, user.displayName, salt, passwordHash, user.createdAt);
    database.prepare('UPDATE local_users SET enabled = 0 WHERE id != ?').run(user.id);
    database.prepare('DELETE FROM local_sessions').run();
    database.prepare('DELETE FROM local_login_limits').run();
    database.exec('COMMIT');
    return user;
  } catch (error) {
    database.exec('ROLLBACK');
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed'))
      throw new LocalPosError('That username is already in use.', 409, 'username_conflict');
    throw error;
  }
}

export async function createLocalStaffUser(
  creator: LocalUser,
  input: Credentials & { role: 'pos_manager' | 'kitchen' },
  database = openLocalPosDatabase(),
): Promise<LocalUser> {
  if (
    (input.role === 'pos_manager' && creator.role !== 'super_user') ||
    (input.role === 'kitchen' && !['super_user', 'pos_manager'].includes(creator.role))
  )
    throw new LocalPosError('This account cannot create that role.', 403, 'role_denied');

  const credentials = validateCredentials(input);
  const salt = randomBytes(16).toString('hex');
  const passwordHash = await hashPassword(credentials.password, salt);
  const user: LocalUser = {
    id: randomBytes(16).toString('hex'),
    username: credentials.username,
    displayName: credentials.displayName,
    role: input.role,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
  try {
    database
      .prepare(
        `INSERT INTO local_users
          (id, username, display_name, role, password_salt, password_hash, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(user.id, user.username, user.displayName, user.role, salt, passwordHash, user.createdAt);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed'))
      throw new LocalPosError('That username is already in use.', 409, 'username_conflict');
    throw error;
  }
  return user;
}

export async function resetLocalStaffPassword(
  actor: LocalUser,
  userId: string,
  password: string,
  database = openLocalPosDatabase(),
): Promise<void> {
  const target = listLocalUsers(database).find((user) => user.id === userId);
  if (!target || target.role === 'super_user')
    throw new LocalPosError('The selected staff account is unavailable.', 404, 'user_not_found');
  if (
    target.role === 'pos_manager'
      ? actor.role !== 'super_user'
      : !['super_user', 'pos_manager'].includes(actor.role)
  )
    throw new LocalPosError('This account cannot reset that password.', 403, 'role_denied');
  if (password.length < 12 || password.length > 128 || !/\S/.test(password))
    throw new LocalPosError('Use a password with 12–128 characters.', 400, 'invalid_password');

  const salt = randomBytes(16).toString('hex');
  const passwordHash = await hashPassword(password, salt);
  database
    .prepare('UPDATE local_users SET password_salt = ?, password_hash = ? WHERE id = ?')
    .run(salt, passwordHash, userId);
  database.prepare('DELETE FROM local_sessions WHERE user_id = ?').run(userId);
}

export async function resetLocalSuperUserPassword(
  username: string,
  password: string,
  database = openLocalPosDatabase(),
): Promise<void> {
  const normalizedUsername = username.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(normalizedUsername))
    throw new LocalPosError(
      'Enter the Super User username created during setup.',
      400,
      'invalid_username',
    );
  if (password.length < 12 || password.length > 128 || !/\S/.test(password))
    throw new LocalPosError('Use a password with 12–128 characters.', 400, 'invalid_password');

  const target = database
    .prepare("SELECT id FROM local_users WHERE username = ? AND role = 'super_user'")
    .get(normalizedUsername) as { id: string } | undefined;
  if (!target)
    throw new LocalPosError('No Super User account matches that username.', 404, 'user_not_found');

  const salt = randomBytes(16).toString('hex');
  const passwordHash = await hashPassword(password, salt);
  database.exec('BEGIN IMMEDIATE');
  try {
    const updated = database
      .prepare(
        "UPDATE local_users SET password_salt = ?, password_hash = ? WHERE id = ? AND role = 'super_user'",
      )
      .run(salt, passwordHash, target.id);
    if (updated.changes !== 1)
      throw new LocalPosError(
        'The Super User account could not be updated.',
        409,
        'reset_conflict',
      );
    database.prepare('DELETE FROM local_sessions WHERE user_id = ?').run(target.id);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function setLocalStaffEnabled(
  actor: LocalUser,
  userId: string,
  enabled: boolean,
  database = openLocalPosDatabase(),
): void {
  const target = listLocalUsers(database).find((user) => user.id === userId);
  if (!target || target.role === 'super_user')
    throw new LocalPosError('The selected staff account is unavailable.', 404, 'user_not_found');
  if (
    target.role === 'pos_manager'
      ? actor.role !== 'super_user'
      : !['super_user', 'pos_manager'].includes(actor.role)
  )
    throw new LocalPosError('This account cannot manage that staff account.', 403, 'role_denied');
  if (target.id === actor.id && !enabled)
    throw new LocalPosError('You cannot disable your own account.', 400, 'self_disable_denied');

  database.prepare('UPDATE local_users SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, userId);
  if (!enabled) database.prepare('DELETE FROM local_sessions WHERE user_id = ?').run(userId);
}

function loginIsLocked(identifier: string, database: DatabaseSync, now: number): boolean {
  const row = database
    .prepare('SELECT failures, reset_at AS resetAt FROM local_login_limits WHERE identifier = ?')
    .get(identifier) as { failures: number; resetAt: number } | undefined;
  if (!row) return false;
  if (row.resetAt <= now) {
    database.prepare('DELETE FROM local_login_limits WHERE identifier = ?').run(identifier);
    return false;
  }
  return row.failures >= MAX_LOGIN_FAILURES;
}

function recordLoginFailure(identifier: string, database: DatabaseSync, now: number): void {
  const current = database
    .prepare('SELECT failures, reset_at AS resetAt FROM local_login_limits WHERE identifier = ?')
    .get(identifier) as { failures: number; resetAt: number } | undefined;
  if (!current || current.resetAt <= now) {
    database
      .prepare(
        `INSERT INTO local_login_limits(identifier, failures, reset_at) VALUES (?, 1, ?)
         ON CONFLICT(identifier) DO UPDATE SET failures = 1, reset_at = excluded.reset_at`,
      )
      .run(identifier, now + LOGIN_WINDOW_MS);
    return;
  }
  database
    .prepare('UPDATE local_login_limits SET failures = failures + 1 WHERE identifier = ?')
    .run(identifier);
}

export async function authenticateLocalUser(
  rawUsername: string,
  password: string,
  database = openLocalPosDatabase(),
  now = Date.now(),
): Promise<LocalUser | null> {
  const username = rawUsername.trim().toLowerCase();
  if (!username || username.length > 32 || password.length > 128) return null;
  if (loginIsLocked(username, database, now)) return null;

  const row = parseCredentialRow(
    database
      .prepare(
        `SELECT id, username, display_name AS displayName, role, enabled,
                created_at AS createdAt, password_salt AS passwordSalt,
                password_hash AS passwordHash
         FROM local_users WHERE username = ? COLLATE NOCASE`,
      )
      .get(username),
  );
  const salt = row?.passwordSalt ?? '00000000000000000000000000000000';
  const actualHash = await hashPassword(password, salt);
  const expected = row?.passwordHash ?? '0'.repeat(PASSWORD_BYTES * 2);
  const validHash = timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expected, 'hex'));
  if (!row || row.enabled !== 1 || !validHash) {
    recordLoginFailure(username, database, now);
    return null;
  }

  database.prepare('DELETE FROM local_login_limits WHERE identifier = ?').run(username);
  return publicUser(row);
}

export function createLocalSession(
  userId: string,
  database = openLocalPosDatabase(),
): {
  token: string;
  expiresAt: string;
} {
  const token = randomBytes(32).toString('base64url');
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + LOCAL_SESSION_TTL_SECONDS * 1000).toISOString();
  database
    .prepare(
      'INSERT INTO local_sessions(token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    )
    .run(hashToken(token), userId, createdAt.toISOString(), expiresAt);
  return { token, expiresAt };
}

export function readLocalSession(
  token: string | undefined,
  database = openLocalPosDatabase(),
  now = new Date(),
): LocalUser | null {
  if (!token || token.length > 100) return null;
  const row = database
    .prepare(
      `SELECT u.id, u.username, u.display_name AS displayName, u.role, u.enabled,
              u.created_at AS createdAt, s.expires_at AS expiresAt
       FROM local_sessions s JOIN local_users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(hashToken(token)) as
    | (Omit<UserCredentialRow, 'passwordSalt' | 'passwordHash'> & {
        expiresAt: string;
      })
    | undefined;
  if (!row) return null;
  if (row.enabled !== 1 || Date.parse(row.expiresAt) <= now.getTime()) {
    database.prepare('DELETE FROM local_sessions WHERE token_hash = ?').run(hashToken(token));
    return null;
  }
  return publicUser(row);
}

export function revokeLocalSession(
  token: string | undefined,
  database = openLocalPosDatabase(),
): void {
  if (!token || token.length > 100) return;
  database.prepare('DELETE FROM local_sessions WHERE token_hash = ?').run(hashToken(token));
}
