import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = new URL(process.env.COMMERCE_SMOKE_BASE_URL || 'http://localhost:3001');
const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
const allowed = [
  'https://hotpizzaace-development.onrender.com',
  'https://hotpizzaace.onrender.com',
];
if ((!local || origin.protocol !== 'http:') && !allowed.includes(origin.origin))
  throw new Error('Use a local preview or the named Hot Pizza Ace Render services.');
if (origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash)
  throw new Error('Use an origin without credentials, path or query.');

const fixtureTag = 'HPA-COMMERCE-QA';
const allowTestOrders = process.env.COMMERCE_SMOKE_ALLOW_TEST_ORDERS === fixtureTag;
const createdIds = [];
let passed = 0;
let skipped = 0;
process.on('exit', (code) => {
  if (code !== 0 && createdIds.length) console.log(JSON.stringify({ testOrderIds: createdIds }));
});
function ok(label) {
  passed++;
  console.log(`PASS ${label}`);
}
function skip(label) {
  skipped++;
  console.log(`SKIP ${label}`);
}
function client() {
  const jar = new Map();
  return async (
    path,
    { method = 'GET', body, sendOrigin = true, cookie = true, headers = {} } = {},
  ) => {
    const response = await fetch(new URL(`/api/commerce/${path}`, origin), {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: {
        ...(method !== 'GET'
          ? { 'Content-Type': 'application/json', ...(sendOrigin ? { Origin: origin.origin } : {}) }
          : {}),
        ...(cookie && jar.size
          ? { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; ') }
          : {}),
        ...headers,
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';', 1)[0];
      const index = pair.indexOf('=');
      if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
    }
    const json = await response.json();
    assert.match(
      response.headers.get('cache-control') || '',
      /no-store/,
      'Commerce responses must never be cached.',
    );
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    return { response, status: response.status, json };
  };
}
const first = client();
const second = client();
const menu = await first('catalog');
assert.equal(menu.status, 200);
assert.equal(
  menu.json.mode,
  'development',
  'Refuse smoke mutations against a production commerce database.',
);
assert.ok(Array.isArray(menu.json.products) && menu.json.products.length);
assert.ok(Array.isArray(menu.json.branches) && menu.json.branches.length);
assert.equal(
  menu.response.headers.getSetCookie().some((value) => value.startsWith('hpa_guest_session=')),
  false,
);
ok('shared development catalog loads without creating a competing guest nonce');
const catalog = menu.json;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (supabaseUrl && publishableKey) {
  const api = new URL(supabaseUrl);
  if (
    api.protocol !== 'https:' ||
    !api.hostname.endsWith('.supabase.co') ||
    !publishableKey.startsWith('sb_publishable_')
  )
    throw new Error(
      'Direct-access probes require a Supabase project URL and public publishable key.',
    );
  for (const table of ['hpa_orders', 'hpa_admin_memberships', 'hpa_branches']) {
    const result = await fetch(new URL(`/rest/v1/${table}?select=*&limit=1`, api), {
      headers: { apikey: publishableKey },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    });
    assert.ok(
      [401, 403, 404].includes(result.status),
      'Publishable clients must not read protected commerce tables.',
    );
  }
  const rpc = await fetch(new URL('/rest/v1/rpc/hpa_catalog_snapshot', api), {
    method: 'POST',
    headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  assert.ok(
    [401, 403, 404].includes(rpc.status),
    'Publishable clients must not call internal transaction RPCs.',
  );
  ok('publishable key cannot read protected tables or call internal RPCs');
} else
  skip('direct publishable access probes need the two NEXT_PUBLIC_SUPABASE environment values');

function checkout(branch, paymentMethod = 'cash') {
  const product = catalog.products.find(
    (product) =>
      product.available &&
      !product.archived &&
      catalog.categories.some(
        (category) => category.id === product.categoryId && !category.archived,
      ),
  );
  assert.ok(product, 'The catalog needs an available item for API tests.');
  const size = product.sizes[0];
  const crust = product.crusts[0];
  const unitPrice =
    (size?.price ?? product.price) +
    (crust ? ((size && crust.sizePrices?.[size.id]) ?? crust.price) : 0);
  const fulfillment = branch.settings.pickupEnabled ? 'pickup' : 'delivery';
  let quantity = 1;
  let deliveryFee = 0;
  for (; quantity <= 20; quantity++) {
    const subtotal = unitPrice * quantity;
    deliveryFee =
      fulfillment === 'delivery' &&
      !(
        branch.settings.freeDeliveryThreshold != null &&
        subtotal >= branch.settings.freeDeliveryThreshold
      )
        ? branch.settings.deliveryFee
        : 0;
    if (fulfillment === 'pickup' || subtotal + deliveryFee >= branch.settings.minimumOrder) break;
  }
  assert.ok(quantity <= 20, 'The fixture order must satisfy the configured minimum.');
  return {
    branchId: branch.id,
    items: [
      {
        id: 'qa-cart-line',
        productId: product.id,
        ...(size ? { sizeId: size.id } : {}),
        ...(crust ? { crustId: crust.id } : {}),
        toppingIds: [],
        quantity,
        notes: `${fixtureTag}: do not prepare`,
      },
    ],
    customer: {
      name: `${fixtureTag} Test`,
      phone: '9999999999',
      address: 'Development test address, no delivery',
      locality: 'Development test',
      postalCode: branch.settings.servicePostalCodes[0] || '208027',
      landmark: '',
      instructions: 'DEVELOPMENT API TEST ONLY. DO NOT PREPARE OR DISPATCH.',
    },
    fulfillment,
    paymentMethod,
    coupon: '',
    idempotencyKey: `qa-${randomUUID()}`,
  };
}
const selectedBranch =
  catalog.branches.find((branch) => branch.id === process.env.COMMERCE_SMOKE_BRANCH_ID) ||
  catalog.branches[0];
if (process.env.COMMERCE_SMOKE_BRANCH_ID)
  assert.equal(
    selectedBranch.id,
    process.env.COMMERCE_SMOKE_BRANCH_ID,
    'Requested QA branch not found.',
  );

// Missing nonce must stop before any order insert, then return one HttpOnly browser nonce.
const initialize = await first('orders', { method: 'POST', body: checkout(selectedBranch) });
assert.equal(initialize.status, 409);
assert.equal(initialize.json.code, 'guest_session_initialized');
const guestCookie = initialize.response.headers
  .getSetCookie()
  .find((value) => value.startsWith('hpa_guest_session='));
assert.ok(guestCookie);
assert.match(guestCookie, /HttpOnly/i);
assert.match(guestCookie, /SameSite=Lax/i);
if (origin.protocol === 'https:') assert.match(guestCookie, /Secure/i);
ok('first checkout initializes a private nonce before placing any order');
for (const visit of [first, second]) {
  const session = await visit('session');
  assert.equal(session.status, 200);
  assert.equal(session.json.shared, true);
  assert.equal(session.json.admin, false);
  assert.equal(session.json.user, null);
}
ok('separate anonymous browsers have no administrator or customer identity');
for (const [label, options] of [
  ['missing Origin', { sendOrigin: false }],
  ['foreign Origin', { headers: { Origin: 'https://invalid.example' } }],
  ['cross-site mutation', { headers: { 'Sec-Fetch-Site': 'cross-site' } }],
]) {
  const result = await first('orders', {
    method: 'POST',
    body: checkout(selectedBranch),
    ...options,
  });
  assert.equal(result.status, 403);
  ok(`${label} is blocked before ordering`);
}
for (const path of ['admin/snapshot']) {
  const result = await second(path);
  assert.equal(result.status, 403);
}
const adminMutation = await second('admin/mutate', {
  method: 'POST',
  body: {
    action: 'setPaymentMethodEnabled',
    args: ['cash', true, selectedBranch.id],
    expectedRevision: catalog.revision,
  },
});
assert.equal(adminMutation.status, 403);
ok('anonymous users cannot read the dashboard or mutate restaurant settings');
const oversized = await first('orders', {
  method: 'POST',
  body: JSON.stringify({ notes: 'x'.repeat(66_000) }),
});
assert.equal(oversized.status, 413);
ok('oversized payload is rejected');

let policyCases = 0;
let testedPaused = false;
let testedCashDisabled = false;
for (const branch of catalog.branches) {
  if ((!branch.settings.acceptingOrders || branch.settings.temporarilyClosed) && !testedPaused) {
    const result = await first('orders', { method: 'POST', body: checkout(branch) });
    assert.equal(result.status, 400);
    assert.match(result.json.error, /not accepting orders/i);
    policyCases++;
    testedPaused = true;
    ok('server blocks new orders for a paused kitchen');
  } else if (
    branch.settings.acceptingOrders &&
    !branch.settings.temporarilyClosed &&
    !branch.settings.paymentMethods.includes('cash') &&
    !testedCashDisabled
  ) {
    const result = await first('orders', { method: 'POST', body: checkout(branch) });
    assert.equal(result.status, 400);
    assert.match(result.json.error, /payment method.*unavailable/i);
    policyCases++;
    testedCashDisabled = true;
    ok('server blocks COD when restaurant settings disable it');
  }
}
if (!policyCases) skip('no closed or COD-disabled fixture branch is currently configured');
for (const [field, value] of [
  ['total', 1],
  ['userId', randomUUID()],
  ['paymentStatus', 'simulated_paid'],
]) {
  const result = await first('orders', {
    method: 'POST',
    body: { ...checkout(selectedBranch), [field]: value },
  });
  assert.equal(result.status, 400);
  ok(`untrusted ${field} cannot be injected`);
}

if (!allowTestOrders)
  skip(`order-writing scenarios require COMMERCE_SMOKE_ALLOW_TEST_ORDERS=${fixtureTag}`);
else {
  assert.equal(selectedBranch.settings.acceptingOrders, true);
  assert.equal(selectedBranch.settings.temporarilyClosed, false);
  const method = selectedBranch.settings.paymentMethods.includes('cash')
    ? 'cash'
    : selectedBranch.settings.paymentMethods[0];
  const request = checkout(selectedBranch, method);
  const placed = await first('orders', { method: 'POST', body: request });
  assert.equal(placed.status, 201, `Order was not created (${placed.json.code}).`);
  const order = placed.json.order;
  createdIds.push(order.id);
  assert.equal(order.status, 'pending');
  assert.equal(order.version, 1);
  assert.equal(order.paymentStatus, method === 'cash' ? 'pending' : 'initiated');
  assert.equal(order.paymentMode, 'simulation');
  assert.match(order.accessToken, /^[a-f0-9]{64}$/);
  assert.ok(order.trackingUrl.includes(order.accessToken));
  assert.equal(order.total, order.subtotal + order.deliveryFee - order.discount);
  assert.equal(
    'user_id' in order || 'guest_session_hash' in order || 'tracking_token_hash' in order,
    false,
  );
  ok('guest order is server-priced and returns a private tracking capability');
  const replay = await first('orders', { method: 'POST', body: request });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.order.id, order.id);
  assert.equal(replay.json.order.accessToken, order.accessToken);
  ok('same checkout key replays exactly one order and tracking link');
  const conflict = await first('orders', {
    method: 'POST',
    body: { ...request, items: [{ ...request.items[0], notes: 'changed request' }] },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.code, 'idempotency_conflict');
  ok('changed payload cannot reuse an existing checkout key');
  const own = await first('orders');
  assert.ok(
    own.json.orders.some((candidate) => candidate.id === order.id && candidate.trackingUrl),
  );
  const other = await second('orders');
  assert.equal(
    other.json.orders.some((candidate) => candidate.id === order.id),
    false,
  );
  assert.equal((await second(`orders/${order.id}`)).status, 404);
  assert.equal((await second(`orders/${order.id}?access=${'0'.repeat(64)}`)).status, 404);
  assert.equal((await second(`orders/${order.id}?access=${order.accessToken}`)).status, 200);
  ok('another browser sees only the shared tracking link, never the customer order list');
  const forbiddenStatus = await second(`orders/${order.id}?access=${order.accessToken}`, {
    method: 'PATCH',
    body: { status: 'confirmed', expectedVersion: 1 },
  });
  assert.equal(forbiddenStatus.status, 403);
  const forbiddenPayment = await second(`orders/${order.id}/payment?access=${order.accessToken}`, {
    method: 'POST',
    body: { outcome: 'success', expectedVersion: 1 },
  });
  assert.equal(forbiddenPayment.status, 404);
  ok('tracking capability cannot change payment or kitchen status');
  if (method === 'cash') {
    const cash = await first(`orders/${order.id}/payment`, {
      method: 'POST',
      body: { outcome: 'cash_collected', expectedVersion: 1 },
    });
    assert.equal(cash.status, 403);
    ok('customer cannot mark cash collected');
  } else {
    const paid = await first(`orders/${order.id}/payment`, {
      method: 'POST',
      body: { outcome: 'success', expectedVersion: 1 },
    });
    assert.equal(paid.status, 200);
    assert.equal(paid.json.order.paymentStatus, 'simulated_paid');
    const stale = await first(`orders/${order.id}/payment`, {
      method: 'POST',
      body: { outcome: 'failed', expectedVersion: 1 },
    });
    assert.equal(stale.status, 409);
    ok('demo payment is versioned and cannot be overwritten by stale requests');
  }

  // A separate nonce keeps fixture validation below the per-browser create rate limit.
  const fulfillmentClient = client();
  assert.equal((await fulfillmentClient('session')).status, 200);
  const available = catalog.products.filter(
    (product) =>
      product.available &&
      !product.archived &&
      catalog.categories.some(
        (category) => category.id === product.categoryId && !category.archived,
      ),
  );
  const priced = available
    .map((product) => {
      const size = product.sizes[0];
      const crust = product.crusts[0];
      return {
        price:
          (size?.price ?? product.price) +
          (crust ? ((size && crust.sizePrices?.[size.id]) ?? crust.price) : 0),
        line: {
          id: `qa-${product.id}`,
          productId: product.id,
          ...(size ? { sizeId: size.id } : {}),
          ...(crust ? { crustId: crust.id } : {}),
          toppingIds: [],
          quantity: 1,
          notes: `${fixtureTag}: do not prepare`,
        },
      };
    })
    .filter((candidate) => candidate.price > 0)
    .sort((a, b) => a.price - b.price);
  const low = priced[0];
  assert.ok(low, 'The QA catalog must contain a nonzero-price item.');
  const fresh = (fulfillment, items) => ({
    ...checkout(selectedBranch, method),
    fulfillment,
    items,
    idempotencyKey: `qa-${randomUUID()}`,
  });
  if (selectedBranch.settings.pickupEnabled && low.price < selectedBranch.settings.minimumOrder) {
    const pickup = await fulfillmentClient('orders', {
      method: 'POST',
      body: fresh('pickup', [low.line]),
    });
    assert.equal(pickup.status, 201);
    createdIds.push(pickup.json.order.id);
    assert.equal(pickup.json.order.subtotal, low.price);
    assert.equal(pickup.json.order.deliveryFee, 0);
    assert.equal(pickup.json.order.total, low.price);
    ok('pickup below the delivery minimum succeeds without a delivery charge');
  } else skip('low-value pickup needs pickup enabled and an item below the configured minimum');
  if (selectedBranch.settings.deliveryEnabled) {
    const validDelivery = fresh('delivery', request.items);
    const outsidePIN = ['999999', '100000', '100001'].find(
      (pin) => !selectedBranch.settings.servicePostalCodes.includes(pin),
    );
    assert.ok(outsidePIN);
    const outside = await fulfillmentClient('orders', {
      method: 'POST',
      body: { ...validDelivery, customer: { ...validDelivery.customer, postalCode: outsidePIN } },
    });
    assert.equal(outside.status, 400);
    assert.match(outside.json.error, /outside our delivery area/i);
    ok('server rejects a valid-looking PIN outside the selected branch delivery area');
    const lowFee =
      selectedBranch.settings.freeDeliveryThreshold != null &&
      low.price >= selectedBranch.settings.freeDeliveryThreshold
        ? 0
        : selectedBranch.settings.deliveryFee;
    if (low.price + lowFee < selectedBranch.settings.minimumOrder) {
      const underMinimum = await fulfillmentClient('orders', {
        method: 'POST',
        body: fresh('delivery', [low.line]),
      });
      assert.equal(underMinimum.status, 400);
      assert.match(underMinimum.json.error, /minimum order total/i);
      ok('delivery below the payable-total minimum is blocked on the server');
    } else
      skip(
        'below-minimum delivery needs an item whose subtotal plus fee is below the configured minimum',
      );
    let targetLines;
    for (const firstItem of priced) {
      if (17000 % firstItem.price === 0 && 17000 / firstItem.price <= 20) {
        targetLines = [{ ...firstItem.line, quantity: 17000 / firstItem.price }];
        break;
      }
      const secondItem = priced.find(
        (candidate) =>
          candidate.line.productId !== firstItem.line.productId &&
          firstItem.price + candidate.price === 17000,
      );
      if (secondItem) {
        targetLines = [firstItem.line, secondItem.line];
        break;
      }
    }
    if (
      targetLines &&
      selectedBranch.settings.deliveryFee === 4900 &&
      selectedBranch.settings.minimumOrder === 19900 &&
      (selectedBranch.settings.freeDeliveryThreshold == null ||
        selectedBranch.settings.freeDeliveryThreshold > 17000)
    ) {
      const delivery = await fulfillmentClient('orders', {
        method: 'POST',
        body: fresh('delivery', targetLines),
      });
      assert.equal(delivery.status, 201);
      createdIds.push(delivery.json.order.id);
      assert.equal(delivery.json.order.subtotal, 17000);
      assert.equal(delivery.json.order.deliveryFee, 4900);
      assert.equal(delivery.json.order.total, 21900);
      ok('₹170 food plus ₹49 delivery is accepted against the ₹199 payable-total minimum');
    } else skip('exact ₹219 delivery needs ₹170 of current menu items, ₹49 fee, and ₹199 minimum');
  } else skip('PIN and delivery minimum checks need a delivery-enabled QA branch');
}
console.log(JSON.stringify({ passed, skipped, testOrderIds: createdIds }));
