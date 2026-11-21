import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('local POS orders support kitchen updates, manager edits, payment, and ready locking', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { randomUUID } from 'node:crypto';
    import { openLocalPosDatabase } from './lib/local-pos/database.ts';
    import { createFirstSuperUser, createLocalStaffUser } from './lib/local-pos/auth.ts';
    import { listLocalPosCatalog } from './lib/local-pos/products.ts';
    import { getCartTotals } from './lib/pricing.ts';
    import {
      acknowledgeLocalOrderChange,
      collectLocalPayment,
      createLocalOrder,
      editLocalOrder,
      findLocalCustomerAddress,
      getLocalSalesAnalytics,
      managerMayEditOrder,
      updateLocalOrderStatus,
    } from './lib/local-pos/orders.ts';

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
    const totals = getCartTotals([item], catalog.products, catalog.branches[0].settings, '', 'dine_in');
    const input = {
      branchId: 'barra',
      fulfillment: 'dine_in',
      items: [item],
      customerName: 'Test customer',
      tableLabel: 'Table 8',
      coupon: '',
      expectedRevision: catalog.revision,
      expectedTotal: totals.total,
      expectedRoundOffPolicy: 'nearest_rupee',
      idempotencyKey: randomUUID(),
      payment: null,
      payLaterReason: 'Customer will pay at the counter.',
    };

    const created = createLocalOrder(manager, input, database, '2026-03-10T12:00:00.000Z');
    assert.equal(created.status, 'confirmed');
    assert.equal(created.localPos.cart.length, 1);
    assert.equal(created.localPos.paidAmount, 0);

    const editedItem = { ...item, quantity: 2 };
    const editedTotals = getCartTotals([editedItem], catalog.products, catalog.branches[0].settings, '', 'dine_in');
    const edited = editLocalOrder(manager, created.id, {
      ...input,
      items: [editedItem],
      expectedTotal: editedTotals.total,
      idempotencyKey: randomUUID(),
      expectedOrderVersion: created.version,
    }, database, '2026-03-10T12:01:00.000Z');
    assert.equal(edited.items[0].quantity, 2);
    assert.equal(edited.localPos.changeRevision, 1);
    assert.equal(edited.localPos.acknowledgedRevision, 0);
    assert.equal(managerMayEditOrder(edited), true);

    const acknowledged = acknowledgeLocalOrderChange(kitchen, edited.id, edited.version ?? 1, database);
    assert.equal(acknowledged.localPos.acknowledgedRevision, 1);
    const preparing = updateLocalOrderStatus(kitchen, edited.id, {
      expectedVersion: acknowledged.version,
      status: 'preparing',
    }, database);
    assert.equal(preparing.status, 'preparing');

    const revised = editLocalOrder(manager, preparing.id, {
      ...input,
      items: [{ ...editedItem, quantity: 3 }],
      expectedTotal: getCartTotals(
        [{ ...editedItem, quantity: 3 }],
        catalog.products,
        catalog.branches[0].settings,
        '',
        'dine_in',
      ).total,
      idempotencyKey: randomUUID(),
      expectedOrderVersion: preparing.version,
    }, database);
    assert.equal(revised.localPos.changeRevision, 2);
    const acknowledgedAgain = acknowledgeLocalOrderChange(
      owner,
      revised.id,
      revised.version ?? 1,
      database,
    );
    const ready = updateLocalOrderStatus(owner, revised.id, {
      expectedVersion: acknowledgedAgain.version,
      status: 'ready',
    }, database);
    assert.equal(ready.status, 'ready');
    assert.equal(managerMayEditOrder(ready), false);
    assert.throws(() => editLocalOrder(manager, ready.id, {
      ...input,
      expectedOrderVersion: ready.version,
    }, database), /locked/);

    const payable = createLocalOrder(manager, {
      ...input,
      payment: null,
    }, database, '2026-03-10T12:02:00.000Z');
    const paid = collectLocalPayment(manager, payable.id, payable.version ?? 1, {
      method: 'cash',
      cashTendered: payable.total,
    }, database);
    assert.equal(paid.paymentStatus, 'paid');
    assert.equal(paid.localPos.paidAmount, payable.total);
    assert.equal(paid.localPos.payments[0].method, 'cash');

    const ownerPayable = createLocalOrder(owner, {
      ...input,
      payment: null,
      tableLabel: 'Table 9',
    }, database, '2026-03-10T12:03:00.000Z');
    const ownerPaid = collectLocalPayment(owner, ownerPayable.id, ownerPayable.version ?? 1, {
      method: 'upi',
      upiReference: 'ABCDEF123456',
    }, database);
    assert.equal(ownerPaid.paymentStatus, 'paid');
    assert.equal(ownerPaid.localPos.paidAmount, ownerPayable.total);
    assert.equal(ownerPaid.localPos.payments[0].reference, 'ABCDEF123456');
    assert.throws(
      () => collectLocalPayment(kitchen, ownerPayable.id, ownerPayable.version ?? 1, {
        method: 'cash',
        cashTendered: ownerPayable.total,
      }, database),
      /Kitchen accounts cannot collect payment/,
    );

    const storedSettings = JSON.parse(
      database.prepare('SELECT data_json FROM local_settings WHERE id = 1').get().data_json,
    );
    storedSettings.deliveryEnabled = true;
    storedSettings.temporarilyClosed = false;
    storedSettings.counterAcceptingOrders = true;
    storedSettings.minimumOrder = 0;
    storedSettings.servicePostalCodes = ['208027'];
    database.prepare('UPDATE local_settings SET data_json = ? WHERE id = 1').run(
      JSON.stringify(storedSettings),
    );
    const deliveryCatalog = listLocalPosCatalog(database);
    const deliveryTotals = getCartTotals(
      [item],
      deliveryCatalog.products,
      deliveryCatalog.branches[0].settings,
      '',
      'delivery',
    );
    const delivery = createLocalOrder(manager, {
      ...input,
      fulfillment: 'delivery',
      customerName: 'Phone customer',
      customerPhone: '9876543210',
      deliveryAddress: {
        address: '12 Main Road, Barra',
        locality: 'Barra',
        postalCode: '208027',
        landmark: 'Near the park',
      },
      expectedRevision: deliveryCatalog.revision,
      expectedTotal: deliveryTotals.total,
      idempotencyKey: randomUUID(),
    }, database, '2026-03-10T12:04:00.000Z');
    assert.equal(delivery.fulfillment, 'delivery');
    assert.equal(delivery.customer.phone, '9876543210');
    assert.equal(delivery.customer.postalCode, '208027');
    assert.ok(delivery.deliveryFee >= 0);
    assert.deepEqual(findLocalCustomerAddress('9876543210', database), {
      name: 'Phone customer',
      phone: '9876543210',
      address: '12 Main Road, Barra',
      locality: 'Barra',
      postalCode: '208027',
      landmark: 'Near the park',
      instructions: '',
    });
    assert.equal(findLocalCustomerAddress('9876543211', database), null);
    assert.throws(() => findLocalCustomerAddress('123', database), /valid 10-digit/);
    assert.throws(() => createLocalOrder(manager, {
      ...input,
      fulfillment: 'delivery',
      customerName: 'Phone customer',
      customerPhone: '9876543210',
      deliveryAddress: {
        address: '12 Main Road, Barra',
        locality: 'Barra',
        postalCode: '000000',
      },
      expectedRevision: deliveryCatalog.revision,
      expectedTotal: deliveryTotals.total,
      idempotencyKey: randomUUID(),
    }, database), /outside this branch’s delivery area/);

    const doubledItem = { ...item, id: randomUUID(), quantity: 2 };
    const doubledTotal = getCartTotals(
      [doubledItem],
      catalog.products,
      catalog.branches[0].settings,
      '',
      'dine_in',
    ).total;
    const alreadyPaid = createLocalOrder(manager, {
      ...input,
      items: [doubledItem],
      expectedTotal: doubledTotal,
      idempotencyKey: randomUUID(),
      payment: {
        method: 'cash',
        confirmedReceived: true,
        cashTendered: doubledTotal,
      },
      payLaterReason: undefined,
    }, database, '2026-03-10T12:03:00.000Z');
    assert.throws(() => editLocalOrder(manager, alreadyPaid.id, {
      ...input,
      expectedTotal: totals.total,
      idempotencyKey: randomUUID(),
      expectedOrderVersion: alreadyPaid.version,
    }, database), /less than the amount already collected/);

    const tripledItem = { ...item, id: randomUUID(), quantity: 3 };
    const tripledTotal = getCartTotals(
      [tripledItem],
      catalog.products,
      catalog.branches[0].settings,
      '',
      'dine_in',
    ).total;
    const adjustedPaidOrder = editLocalOrder(manager, alreadyPaid.id, {
      ...input,
      items: [tripledItem],
      expectedTotal: tripledTotal,
      idempotencyKey: randomUUID(),
      expectedOrderVersion: alreadyPaid.version,
    }, database);
    assert.equal(adjustedPaidOrder.paymentStatus, 'pending');
    const balancePaid = collectLocalPayment(
      manager,
      adjustedPaidOrder.id,
      adjustedPaidOrder.version ?? 1,
      { method: 'cash', cashTendered: tripledTotal - doubledTotal },
      database,
    );
    assert.equal(balancePaid.localPos.paidAmount, tripledTotal);
    assert.equal(
      balancePaid.localPos.payments.reduce((sum, payment) => sum + payment.amount, 0),
      tripledTotal,
    );
    const balancePreparing = updateLocalOrderStatus(kitchen, balancePaid.id, {
      expectedVersion: balancePaid.version ?? 1,
      status: 'preparing',
    }, database);
    const balanceAcknowledged = acknowledgeLocalOrderChange(
      kitchen,
      balancePreparing.id,
      balancePreparing.version ?? 1,
      database,
    );
    const balanceReady = updateLocalOrderStatus(kitchen, balanceAcknowledged.id, {
      expectedVersion: balanceAcknowledged.version ?? 1,
      status: 'ready',
    }, database);
    assert.equal(balanceReady.status, 'ready');
    assert.equal(balanceReady.counter?.payLater, false);

    const report = getLocalSalesAnalytics('2026-03-10', '2026-03-10', database);
    assert.equal(report.orderCount, 5);
    assert.equal(report.activeOrderCount, 5);
    assert.equal(report.cancelledOrderCount, 0);
    assert.equal(report.collected, payable.total + ownerPayable.total + tripledTotal);
    assert.equal(report.bestSellers[0].quantity, 9);

    database.close();
  `;
  execFileSync(
    process.execPath,
    ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: process.cwd(), stdio: 'pipe' },
  );
});
