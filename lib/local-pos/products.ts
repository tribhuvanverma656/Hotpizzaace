import type { Branch, Category, Product, RestaurantSettings } from '../../types';
import type { CommerceCatalog } from '../commerce/domain';
import { mutateCatalog } from '../commerce/domain';
import { openLocalPosDatabase } from './database';
import type { LocalRole } from './database';
import { LocalPosError } from './errors';

type CatalogRow = { data_json: string };

export function updateLocalPosCatalog(
  actorRole: LocalRole,
  body: unknown,
  database = openLocalPosDatabase(),
): CommerceCatalog {
  if (!['super_user', 'pos_manager'].includes(actorRole))
    throw new LocalPosError('This account cannot manage the menu.', 403, 'role_denied');
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new LocalPosError('Send a valid catalog update.', 400, 'invalid_request');
  const request = body as Record<string, unknown>;
  if (
    typeof request.expectedRevision !== 'number' ||
    !Number.isSafeInteger(request.expectedRevision) ||
    typeof request.action !== 'string'
  )
    throw new LocalPosError('Refresh the menu before saving changes.', 400, 'invalid_request');
  if (
    actorRole !== 'super_user' &&
    ['updateSettings', 'updatePaymentMethods', 'setPaymentMethodEnabled'].includes(request.action)
  )
    throw new LocalPosError('Only the Super User can change restaurant settings.', 403, 'role_denied');
  if (
    ![
      'saveProduct',
      'archiveProduct',
      'deleteProduct',
      'restoreProduct',
      'saveCategory',
      'archiveCategory',
      'restoreCategory',
      'deleteCategory',
      'moveCategory',
      'reorderCategory',
      ...(actorRole === 'super_user' ? ['updateSettings'] : []),
    ].includes(request.action)
  )
    throw new LocalPosError('This local catalog action is not supported.', 400, 'invalid_action');

  return withCatalogTransaction(database, () => {
    const previous = listLocalPosCatalog(database);
    if (previous.revision !== request.expectedRevision)
      throw new LocalPosError(
        'The menu changed on another screen. Refresh and review your changes.',
        409,
        'catalog_revision_conflict',
      );
    const updated = mutateCatalog(previous, request.action, request.args);
    database.exec('DELETE FROM local_products; DELETE FROM local_categories;');
    const saveCategory = database.prepare(
      'INSERT INTO local_categories(id, data_json, sort_order) VALUES (?, ?, ?)',
    );
    for (const category of updated.categories)
      saveCategory.run(category.id, JSON.stringify(category), category.sortOrder);
    const saveProduct = database.prepare(
      'INSERT INTO local_products(id, category_id, data_json, updated_at) VALUES (?, ?, ?, ?)',
    );
    const now = new Date().toISOString();
    for (const product of updated.products)
      saveProduct.run(product.id, product.categoryId, JSON.stringify(product), now);
    database
      .prepare("UPDATE local_settings SET data_json = ? WHERE id = 1")
      .run(JSON.stringify(updated.branches[0].settings));
    database
      .prepare("UPDATE local_meta SET value = ? WHERE key = 'catalog_revision'")
      .run(String(updated.revision));
    return updated;
  });
}

function withCatalogTransaction<T>(
  database: ReturnType<typeof openLocalPosDatabase>,
  callback: () => T,
): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function listLocalPosCatalog(database = openLocalPosDatabase()): CommerceCatalog {
  const categories = database
    .prepare('SELECT data_json FROM local_categories ORDER BY sort_order, id')
    .all() as CatalogRow[];
  const products = database
    .prepare('SELECT data_json FROM local_products ORDER BY id')
    .all() as CatalogRow[];
  const settingRow = database
    .prepare('SELECT data_json FROM local_settings WHERE id = 1')
    .get() as CatalogRow | undefined;
  const revisionRow = database
    .prepare("SELECT value FROM local_meta WHERE key = 'catalog_revision'")
    .get() as { value: string } | undefined;
  if (!settingRow || !revisionRow)
    throw new LocalPosError('Complete the local POS setup before taking orders.', 503, 'setup_required');

  const settings = JSON.parse(settingRow.data_json) as RestaurantSettings;
  const branch: Branch = {
    id: 'barra',
    slug: 'barra',
    name: 'Barra · Kanpur',
    settings,
  };
  return {
    products: products.map((row) => JSON.parse(row.data_json) as Product),
    categories: categories.map((row) => JSON.parse(row.data_json) as Category),
    branches: [branch],
    revision: Number(revisionRow.value),
    mode: 'production',
    allowSimulatedPayments: false,
  };
}
