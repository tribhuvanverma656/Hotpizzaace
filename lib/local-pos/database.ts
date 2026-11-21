import 'server-only';

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getPublicBranchRegistration, publicBusinessIdentity } from '../business-identity';
import { initialCategories, initialProducts, initialSettings } from '../data';

export type LocalRole = 'super_user' | 'pos_manager' | 'kitchen';
export type LocalUser = {
  id: string;
  username: string;
  displayName: string;
  role: LocalRole;
  enabled: boolean;
  createdAt: string;
};

const globalForLocalPos = globalThis as typeof globalThis & {
  localPosDatabase?: DatabaseSync;
};

export function localPosDatabasePath(): string {
  if (process.env.LOCAL_POS_DATA_DIR) return join(process.env.LOCAL_POS_DATA_DIR, 'pos.sqlite');
  const dataRoot =
    process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(dataRoot, 'HotPizzaAce', 'POS', 'pos.sqlite');
}

export function openLocalPosDatabase(path = localPosDatabasePath()): DatabaseSync {
  if (path === localPosDatabasePath() && globalForLocalPos.localPosDatabase)
    return globalForLocalPos.localPosDatabase;

  if (path !== ':memory:') mkdirSync(join(path, '..'), { recursive: true });
  const database = new DatabaseSync(path, { timeout: 5000 });
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;

    CREATE TABLE IF NOT EXISTS local_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('super_user', 'pos_manager', 'kitchen')),
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS local_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS local_sessions_expiry ON local_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS local_login_limits (
      identifier TEXT PRIMARY KEY,
      failures INTEGER NOT NULL CHECK (failures >= 0),
      reset_at INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS local_categories (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS local_products (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL REFERENCES local_categories(id),
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS local_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data_json TEXT NOT NULL,
      business_day_start_minute INTEGER NOT NULL DEFAULT 180
        CHECK (business_day_start_minute BETWEEN 0 AND 1439)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS local_orders (
      id TEXT PRIMARY KEY,
      order_number TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      created_at TEXT NOT NULL,
      business_date TEXT NOT NULL,
      data_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS local_orders_business_date
      ON local_orders(business_date, created_at);

    CREATE TABLE IF NOT EXISTS local_order_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES local_orders(id),
      actor_id TEXT NOT NULL REFERENCES local_users(id),
      event_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      data_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS local_order_events_order
      ON local_order_events(order_id, created_at);

    CREATE TABLE IF NOT EXISTS local_qr_submissions (
      idempotency_key TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES local_orders(id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS local_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
  `);
  database.exec(`
    INSERT OR IGNORE INTO local_meta(key, value)
    SELECT 'catalog_revision', '1'
    WHERE EXISTS (SELECT 1 FROM local_settings WHERE id = 1);
  `);

  if (path === localPosDatabasePath()) globalForLocalPos.localPosDatabase = database;
  return database;
}

export function listLocalUsers(database = openLocalPosDatabase()): LocalUser[] {
  const rows = database
    .prepare(
      `SELECT id, username, display_name AS displayName, role, enabled, created_at AS createdAt
       FROM local_users ORDER BY created_at, username`,
    )
    .all() as (Omit<LocalUser, 'enabled' | 'role'> & {
    enabled: number;
    role: LocalRole;
  })[];
  return rows.map((row) => ({ ...row, enabled: row.enabled === 1 }));
}

export function seedLocalCatalog(database: DatabaseSync): void {
  const registration = getPublicBranchRegistration('barra');
  if (!registration)
    throw new Error('The local POS needs a confirmed Barra FSSAI registration before setup.');
  const insertCategory = database.prepare(
    'INSERT INTO local_categories(id, data_json, sort_order) VALUES (?, ?, ?)',
  );
  const insertProduct = database.prepare(
    'INSERT INTO local_products(id, category_id, data_json, updated_at) VALUES (?, ?, ?, ?)',
  );
  const now = new Date().toISOString();
  for (const category of initialCategories) {
    insertCategory.run(category.id, JSON.stringify(category), category.sortOrder);
  }
  for (const product of initialProducts) {
    insertProduct.run(product.id, product.categoryId, JSON.stringify(product), now);
  }
  const settings = {
    ...structuredClone(initialSettings),
    name: publicBusinessIdentity.name,
    billing: {
      businessName: publicBusinessIdentity.name,
      address: publicBusinessIdentity.address,
      gstin: publicBusinessIdentity.gstin,
      fssaiNumber: registration.fssaiNumber,
      stateName: 'Uttar Pradesh',
      stateCode: '09',
      sac: '996331',
      cgstRate: 2.5,
      sgstRate: 2.5,
    },
    counterAcceptingOrders: true,
  } satisfies typeof initialSettings;
  database
    .prepare(
      'INSERT INTO local_settings(id, data_json, business_day_start_minute) VALUES (1, ?, 180)',
    )
    .run(JSON.stringify(settings));
  database
    .prepare("INSERT INTO local_meta(key, value) VALUES ('catalog_revision', '1')")
    .run();
}
