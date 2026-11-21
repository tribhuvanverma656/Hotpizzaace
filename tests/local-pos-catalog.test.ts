import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('local catalog edits are validated, revisioned, persistent, and role-protected', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { openLocalPosDatabase } from './lib/local-pos/database.ts';
    import { createFirstSuperUser, createLocalStaffUser } from './lib/local-pos/auth.ts';
    import { listLocalPosCatalog, updateLocalPosCatalog } from './lib/local-pos/products.ts';
    import { LocalPosError } from './lib/local-pos/errors.ts';

    const database = openLocalPosDatabase(':memory:');
    const owner = await createFirstSuperUser({
      username: 'owner',
      displayName: 'Owner',
      password: 'LocalPOS-Owner-Strong-1',
    }, database);
    const manager = await createLocalStaffUser(owner, {
      username: 'manager',
      displayName: 'Manager',
      password: 'LocalPOS-Manager-Strong-1',
      role: 'pos_manager',
    }, database);
    const kitchen = await createLocalStaffUser(manager, {
      username: 'kitchen',
      displayName: 'Kitchen',
      password: 'LocalPOS-Kitchen-Strong-1',
      role: 'kitchen',
    }, database);
    const initial = listLocalPosCatalog(database);
    const product = initial.products[0];
    const changed = { ...product, available: !product.available, price: product.price + 100 };
    const result = updateLocalPosCatalog('pos_manager', {
      expectedRevision: initial.revision,
      action: 'saveProduct',
      args: { product: changed },
    }, database);
    assert.equal(result.revision, initial.revision + 1);
    assert.equal(listLocalPosCatalog(database).products.find((item) => item.id === product.id).price, changed.price);
    assert.throws(() => updateLocalPosCatalog('pos_manager', {
      expectedRevision: initial.revision,
      action: 'saveProduct',
      args: { product: changed },
    }, database), (error) => error instanceof LocalPosError && error.status === 409);

    const category = {
      id: 'phone-orders',
      name: 'Phone Orders',
      slug: 'phone-orders',
      sortOrder: 14,
    };
    const withCategory = updateLocalPosCatalog('pos_manager', {
      expectedRevision: result.revision,
      action: 'saveCategory',
      args: { category },
    }, database);
    assert.ok(withCategory.categories.some((item) => item.id === category.id));
    assert.throws(() => updateLocalPosCatalog('pos_manager', {
      expectedRevision: withCategory.revision,
      action: 'updateSettings',
      args: { branchId: 'barra', settings: withCategory.branches[0].settings },
    }, database), (error) => error instanceof LocalPosError && error.status === 403);
    assert.throws(() => updateLocalPosCatalog('kitchen', {
      expectedRevision: withCategory.revision,
      action: 'saveProduct',
      args: { product: changed },
    }, database), (error) => error instanceof LocalPosError && error.status === 403);
    database.close();
  `;
  execFileSync(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: process.cwd(), stdio: 'pipe' },
  );
});
