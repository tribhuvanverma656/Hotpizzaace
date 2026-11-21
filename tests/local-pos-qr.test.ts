import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('local QR menu, idempotent ordering, QR rotation, and manager status updates work offline', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { randomUUID } from 'node:crypto';
    import { openLocalPosDatabase } from './lib/local-pos/database.ts';
    import { createFirstSuperUser, createLocalStaffUser } from './lib/local-pos/auth.ts';
    import { listLocalPosCatalog } from './lib/local-pos/products.ts';
    import { listLocalOrders, updateLocalOrderStatus } from './lib/local-pos/orders.ts';
    import { createClientUuid } from './lib/client-uuid.ts';
    import {
      createLocalQrOrder,
      getLocalQrMenu,
      getLocalQrState,
      setLocalQrState,
    } from './lib/local-pos/qr-ordering.ts';

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
    const catalog = listLocalPosCatalog(database);
    const product = catalog.products.find((entry) => entry.available && !entry.archived);
    assert.ok(product);
    const item = {
      id: randomUUID(),
      productId: product.id,
      ...(product.sizes[0] ? { sizeId: product.sizes[0].id } : {}),
      ...(product.crusts[0] ? { crustId: product.crusts[0].id } : {}),
      toppingIds: [],
      quantity: 1,
      notes: '',
    };
    assert.match(createClientUuid(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);

    assert.deepEqual(getLocalQrState(database), { enabled: false, token: null });
    const enabled = setLocalQrState('enable', database);
    assert.equal(enabled.enabled, true);
    assert.match(enabled.token, /^[a-f0-9]{64}$/);
    const menu = getLocalQrMenu(enabled.token, database);
    assert.equal(menu.revision, catalog.revision);
    assert.equal(menu.products.some((entry) => entry.id === product.id), true);
    assert.equal(Object.hasOwn(menu.settings, 'phone'), false);

    const body = {
      items: [item],
      customerName: 'QR Guest',
      tableLabel: 'Table 4',
      expectedRevision: menu.revision,
      idempotencyKey: randomUUID(),
    };
    const order = createLocalQrOrder(enabled.token, body, database, '2026-03-10T12:00:00.000Z');
    assert.equal(order.status, 'confirmed');
    assert.equal(order.counter?.entry, 'table_qr');
    assert.equal(order.counter?.tableLabel, 'Table 4');
    assert.equal(order.paymentStatus, 'pending');
    assert.equal(order.localPos.paidAmount, 0);
    assert.equal(createLocalQrOrder(enabled.token, body, database).id, order.id);
    assert.equal(
      database.prepare('SELECT COUNT(*) AS count FROM local_qr_submissions').get().count,
      1,
    );
    assert.equal(listLocalOrders(order.localPos.businessDate, database)[0].id, order.id);

    const preparing = updateLocalOrderStatus(
      owner,
      order.id,
      { expectedVersion: order.version, status: 'preparing' },
      database,
    );
    const ready = updateLocalOrderStatus(
      manager,
      order.id,
      { expectedVersion: preparing.version, status: 'ready' },
      database,
    );
    assert.equal(ready.status, 'ready');

    const rotated = setLocalQrState('rotate', database);
    assert.notEqual(rotated.token, enabled.token);
    assert.throws(() => getLocalQrMenu(enabled.token, database), /QR is unavailable/);
    assert.equal(getLocalQrMenu(rotated.token, database).acceptingOrders, true);
    assert.deepEqual(setLocalQrState('disable', database), { enabled: false, token: null });
    assert.throws(() => getLocalQrMenu(rotated.token, database), /QR is unavailable/);
    database.close();
  `;
  execFileSync(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: process.cwd(), stdio: 'pipe' },
  );
});
