import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { initialBranches, initialCategories, initialProducts } from '../lib/data';
import { parseCounterOrderRequest, priceCounterOrder, settleCounterOrder } from '../lib/counter';
import type { Order } from '../types';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = build({
  absWorkingDir: repositoryRoot,
  tsconfig: resolve(repositoryRoot, 'tsconfig.json'),
  entryPoints: [resolve(repositoryRoot, 'components/admin/counter.tsx')],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'counter-render-context',
      setup(plugin) {
        plugin.onResolve({ filter: /^react$/ }, (args) =>
          args.importer.endsWith('/components/admin/counter.tsx')
            ? { path: 'hooks', namespace: 'counter-fixture' }
            : { path: 'react', external: true },
        );
        plugin.onResolve({ filter: /^@\/lib\/commerce\/client$/ }, () => ({
          path: 'commerce',
          namespace: 'counter-fixture',
        }));
        plugin.onResolve({ filter: /^\.\/use-admin-store$/ }, () => ({
          path: 'store',
          namespace: 'counter-fixture',
        }));
        plugin.onResolve({ filter: /^@\/lib\/counter-draft$/ }, () => ({
          path: 'draft',
          namespace: 'counter-fixture',
        }));
        plugin.onResolve({ filter: /^\.\/table-request-queue$/ }, () => ({
          path: 'queue',
          namespace: 'counter-fixture',
        }));
        plugin.onResolve({ filter: /\.module\.css$/ }, () => ({
          path: 'styles',
          namespace: 'counter-fixture',
        }));
        plugin.onResolve({ filter: /^@radix-ui\/react-dialog$/ }, () => ({
          path: 'dialog',
          namespace: 'counter-fixture',
        }));
        plugin.onLoad({ filter: /.*/, namespace: 'counter-fixture' }, ({ path }) => ({
          resolveDir: repositoryRoot,
          contents: {
            store: 'export function useAdminStore() { return fixture.store; }',
            hooks: `import * as React from 'react';
              export const useState = (...args) => (fixture.hooks ?? React).useState(...args);
              export const useRef = (...args) => (fixture.hooks ?? React).useRef(...args);
              export const useEffect = (...args) => (fixture.hooks ?? React).useEffect(...args);
              export const useCallback = (...args) => (fixture.hooks ?? React).useCallback(...args);`,
            commerce: `export class CommerceError extends Error {
              constructor(message, status, code) { super(message); this.status = status; this.code = code; }
            }
            fixture.makeCommerceError = (...args) => new CommerceError(...args);
            export async function commerceRequest(path, options) { return fixture.commerce(path, options); }`,
            draft:
              'export function readCounterDraft(key) { return fixture.drafts.get(key); } export function writeCounterDraft(key, value) { fixture.drafts.set(key, value); }',
            queue: 'export function TableRequestQueue() { return null; }',
            styles: 'export default new Proxy({}, { get: (_, key) => String(key) });',
            dialog:
              'import { createElement } from "react"; export const Root = ({children}) => children; export const Portal = Root; export const Overlay = () => null; export const Content = ({children}) => createElement("section", {role:"dialog"}, children); export const Title = ({children}) => createElement("h2", null, children); export const Description = ({children}) => createElement("p", null, children); export const Close = ({children, disabled}) => createElement("button", {disabled}, children);',
          }[path]!,
        }));
      },
    },
  ],
});

/** Render the real bill/payment UI with isolated store, QR queue and server-rendered portals. */
async function fixture(fulfillment: 'dine_in' | 'delivery') {
  const product = structuredClone(initialProducts.find((item) => item.slug === 'french-fries')!);
  product.price = 8500;
  const branch = structuredClone(initialBranches[0]);
  branch.settings = {
    ...branch.settings,
    counterAcceptingOrders: true,
    acceptingOrders: false,
    temporarilyClosed: false,
    paymentMethods: [],
    deliveryEnabled: true,
    servicePostalCodes: ['208027'],
    deliveryFee: 4900,
    freeDeliveryThreshold: 25000,
    minimumOrder: 19900,
    billing: {
      businessName: 'HOT PIZZA ACE',
      address: 'Fictional QA address',
      gstin: '09ANCPV1491R1Z3',
      fssaiNumber: '12721045000614',
      stateName: 'Uttar Pradesh',
      stateCode: '09',
      sac: '996331',
      cgstRate: 2.5,
      sgstRate: 2.5,
    },
  };
  const draft = {
    fulfillment,
    cart: [{ id: 'qa-line', productId: product.id, quantity: 2, toppingIds: [], notes: '' }],
    customerName: 'Fictional delivery guest',
    customerPhone: '9876543210',
    deliveryAddress: {
      address: 'QA house 12, Fictional Street',
      locality: 'Barra',
      postalCode: '208027',
      landmark: 'Fictional landmark',
    },
    tableLabel: '',
    selected: null as Order | null,
    collecting: false,
  };
  const state = {
    hooks: undefined as
      | undefined
      | {
          useState: (initial: unknown) => unknown;
          useRef: (initial: unknown) => unknown;
          useEffect: (effect: () => void | (() => void)) => void;
          useCallback: (callback: unknown) => unknown;
        },
    commerce: (async () => ({}) as unknown) as (
      path: string,
      options?: { body?: unknown; signal?: AbortSignal },
    ) => Promise<unknown>,
    makeCommerceError: (() => new Error()) as (
      message: string,
      status: number,
      code: string,
    ) => Error,
    drafts: new Map<string, unknown>([[`qa-owner:${branch.id}`, draft]]),
    store: {
      products: [product],
      categories: initialCategories,
      branches: [branch],
      adminBranchId: branch.id,
      shared: {
        enabled: true,
        ready: true,
        admin: true,
        error: '',
        mode: 'development',
        user: { id: 'qa-owner' },
        refreshAdmin: async () => {},
        refresh: async () => {},
      },
    },
  };
  const compiled = await bundle;
  type OrderCardsProps = {
    orders: Order[];
    disabled: boolean;
    onOpen: (order: Order, collectPayment: boolean) => void;
  };
  const counterModule = {
    exports: {} as {
      CounterPage: () => ReturnType<typeof createElement>;
      CounterOrderCards: (props: OrderCardsProps) => ReactElement;
    },
  };
  const browser = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let now = 0;
  let timerId = 0;
  const timers = new Map<number, { callback: () => void; interval: number; due: number }>();
  const advance = (milliseconds: number) => {
    const end = now + milliseconds;
    for (;;) {
      const due = Math.min(...[...timers.values()].map((timer) => timer.due));
      if (due > end) break;
      now = due;
      for (const timer of timers.values())
        if (timer.due === due) {
          timer.due += timer.interval;
          timer.callback();
        }
    }
    now = end;
  };
  new Function(
    'require',
    'module',
    'exports',
    'fixture',
    'window',
    'document',
    'setInterval',
    'clearInterval',
    'Date',
    compiled.outputFiles[0].text,
  )(
    createRequire(import.meta.url),
    counterModule,
    counterModule.exports,
    state,
    browser,
    document,
    (callback: () => void, interval: number) => {
      const id = ++timerId;
      timers.set(id, { callback, interval, due: now + interval });
      return id;
    },
    (id: number) => timers.delete(id),
    class extends Date {
      static now() {
        return now;
      }
    },
  );
  return {
    branch,
    draft,
    state,
    browser,
    document,
    advance,
    timerCount: () => timers.size,
    render: () => renderToStaticMarkup(createElement(counterModule.exports.CounterPage)),
    cards: counterModule.exports.CounterOrderCards,
    interactive: () => {
      // Evaluate the real workspace event handlers with persistent hook slots.
      // Child payment/bill components remain real React elements so tests can
      // submit their public callbacks without mounting a browser or duplicating logic.
      const slots: unknown[] = [];
      let position = 0;
      let firstRender = true;
      const effects: (() => void | (() => void))[] = [];
      const slot = (initial: () => unknown) => {
        const index = position++;
        if (!(index in slots)) slots[index] = initial();
        return index;
      };
      state.hooks = {
        useState: (initial) => {
          const index = slot(() => (typeof initial === 'function' ? initial() : initial));
          return [
            slots[index],
            (next: unknown) => {
              slots[index] = typeof next === 'function' ? next(slots[index]) : next;
            },
          ];
        },
        useRef: (initial) => slots[slot(() => ({ current: initial }))],
        useEffect: (effect) => {
          if (firstRender) effects.push(effect);
        },
        useCallback: (callback) => callback,
      };
      const render = () => {
        position = 0;
        const page = counterModule.exports.CounterPage();
        const workspace = (page.type as (props: unknown) => ReactElement)(page.props);
        firstRender = false;
        return workspace;
      };
      return Object.assign(render, { mount: () => effects.map((effect) => effect()) });
    },
    renderCards: (orders: Order[], disabled = false) =>
      renderToStaticMarkup(
        createElement(counterModule.exports.CounterOrderCards, {
          orders,
          disabled,
          onOpen: () => {},
        }),
      ),
  };
}
function paymentDisabled(html: string) {
  const payment = html.match(/<fieldset class="payment"[^>]*>/)?.[0];
  assert.ok(payment, 'The counter must show its normal cash/direct UPI controls.');
  return payment.includes('disabled');
}
async function writePreview(name: string, html: string) {
  const destination = process.env.HPA_COUNTER_UI_PREVIEW_DIR;
  if (!destination) return;
  const directory = resolve(destination);
  assert.ok(directory.startsWith('/private/tmp/'), 'Preview output must stay in private tmp.');
  const [globalStyles, counterStyles] = await Promise.all([
    readFile(resolve(repositoryRoot, 'app/globals.css'), 'utf8'),
    readFile(resolve(repositoryRoot, 'components/admin/counter.module.css'), 'utf8'),
  ]);
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, `${name}.html`),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Counter UI preview</title><style>${globalStyles.replace("@import 'tailwindcss';", '')}\n${counterStyles}\nbody{padding:24px} @media(max-width:600px){body{padding:12px}}</style></head><body>${html}</body></html>`,
  );
}

test('staff home delivery exposes required contact/address and payable delivery/GST before payment while website checkout is paused', async () => {
  const counter = await fixture('delivery');
  const html = counter.render();
  assert.match(html, /Delivery details/);
  assert.match(html, /Complete address/);
  assert.match(html, /Locality/);
  assert.match(html, /PIN code/);
  assert.match(html, /Landmark/);
  assert.match(html, /Delivery fee<\/span><b>₹49<\/b>/);
  assert.match(html, /Total including GST<\/span><strong>₹230<\/strong>/);
  assert.match(html, /Round off<\/span><b>\+₹0\.04<\/b>/);
  assert.equal(paymentDisabled(html), false);
  assert.doesNotMatch(html, /<img\b/);
  await writePreview('delivery-ready', html);
  if (process.env.HPA_COUNTER_UI_PREVIEW_DIR) {
    counter.draft.deliveryAddress.postalCode = '999999';
    await writePreview('delivery-outside-area', counter.render());
    await writePreview('dine-in', (await fixture('dine_in')).render());
  }
});

test('invalid home-delivery details, disabled delivery and minimum totals prevent recording cash or UPI', async () => {
  const counter = await fixture('delivery');
  for (const [key, value] of [
    ['address', 'Short'],
    ['locality', ''],
    ['postalCode', '999999'],
  ]) {
    const previous =
      counter.draft.deliveryAddress[key as keyof typeof counter.draft.deliveryAddress];
    Object.assign(counter.draft.deliveryAddress, { [key]: value });
    assert.equal(paymentDisabled(counter.render()), true, key);
    Object.assign(counter.draft.deliveryAddress, { [key]: previous });
  }
  counter.draft.customerName = '';
  assert.equal(paymentDisabled(counter.render()), true);
  counter.draft.customerName = 'Fictional delivery guest';
  counter.draft.customerPhone = '1234567890';
  assert.equal(paymentDisabled(counter.render()), true);
  counter.draft.customerPhone = '9876543210';
  counter.branch.settings.deliveryEnabled = false;
  assert.match(counter.render(), /Home delivery is disabled/);
  assert.equal(paymentDisabled(counter.render()), true);
  counter.branch.settings.deliveryEnabled = true;
  counter.branch.settings.minimumOrder = 23100;
  assert.match(counter.render(), /Add ₹1/);
  assert.equal(paymentDisabled(counter.render()), true);
  counter.branch.settings.minimumOrder = 23000;
  assert.equal(paymentDisabled(counter.render()), false);
});

test('dine-in remains fast with optional customer details and no delivery fee, address or minimum', async () => {
  const counter = await fixture('dine_in');
  counter.draft.customerName = '';
  counter.draft.customerPhone = '';
  counter.branch.settings.deliveryEnabled = false;
  counter.branch.settings.minimumOrder = 999999;
  const html = counter.render();
  assert.match(html, /Customer details · optional/);
  assert.doesNotMatch(html, /Complete address|QA house 12|Delivery fee<\/span>/);
  assert.match(html, /Total including GST<\/span><strong>₹179<\/strong>/);
  assert.equal(paymentDisabled(html), false);
});

test('delivery contact draft is recovered only for its owner and branch', async () => {
  const counter = await fixture('delivery');
  assert.match(counter.render(), /QA house 12/);
  counter.state.store.shared.user.id = 'another-owner';
  assert.doesNotMatch(counter.render(), /QA house 12|Fictional delivery guest|9876543210/);
  counter.state.store.shared.user.id = 'qa-owner';
  counter.state.store.adminBranchId = 'another-branch';
  counter.state.store.branches.push({ ...counter.branch, id: 'another-branch' });
  assert.doesNotMatch(counter.render(), /QA house 12|Fictional delivery guest|9876543210/);
});

test('delivery order details show contact/address and require a verified full payment for dispatch and completion', async () => {
  const counter = await fixture('delivery');
  const order = priceCounterOrder(
    parseCounterOrderRequest({
      branchId: counter.branch.id,
      fulfillment: 'delivery',
      customerName: counter.draft.customerName,
      customerPhone: counter.draft.customerPhone,
      deliveryAddress: counter.draft.deliveryAddress,
      items: counter.draft.cart,
      coupon: '',
      expectedRevision: 1,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      payment: { method: 'cash', confirmedReceived: true, cashTendered: 23000 },
    }),
    {
      products: counter.state.store.products,
      categories: counter.state.store.categories,
      branches: [counter.branch],
      mode: 'development',
      revision: 1,
    },
    '33333333-3333-4333-8333-333333333333',
    '2026-10-27T12:00:00Z',
    '11111111-1111-4111-8111-111111111111',
  );
  counter.draft.selected = { ...order, status: 'ready' };
  const paid = counter.render();
  const button = (html: string, label: string) => {
    const found = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find((item) =>
      item[0].includes(label),
    );
    assert.ok(found, label);
    return found[0];
  };
  assert.match(paid, /Order delivery address/);
  assert.match(paid, /tel:\+919876543210/);
  assert.match(paid, /QA house 12, Fictional Street/);
  assert.doesNotMatch(button(paid, 'Mark out for delivery'), /disabled/);
  assert.doesNotMatch(paid, /Mark served|Close paid order/);
  const settlement = counter.draft.selected.settlement;
  counter.draft.selected.settlement = undefined;
  assert.match(button(counter.render(), 'Mark out for delivery'), /disabled/);
  counter.draft.selected.settlement = settlement;
  counter.draft.selected.paymentStatus = 'pending';
  assert.match(button(counter.render(), 'Mark out for delivery'), /disabled/);
  counter.draft.selected.status = 'out_for_delivery';
  assert.match(button(counter.render(), 'Mark delivered'), /disabled/);
  counter.draft.selected.paymentStatus = 'paid';
  assert.doesNotMatch(button(counter.render(), 'Mark delivered'), /disabled/);
});

function unpaidDineInOrder(counter: Awaited<ReturnType<typeof fixture>>) {
  return priceCounterOrder(
    parseCounterOrderRequest({
      branchId: counter.branch.id,
      fulfillment: 'dine_in',
      tableLabel: 'QA table 4',
      items: counter.draft.cart,
      coupon: '',
      expectedRevision: 1,
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      payment: null,
      payLaterReason: 'Pay after the meal',
    }),
    {
      products: counter.state.store.products,
      categories: counter.state.store.categories,
      branches: [counter.branch],
      mode: 'development',
      revision: 1,
    },
    '33333333-3333-4333-8333-333333333333',
    '2026-10-27T12:00:00Z',
    '11111111-1111-4111-8111-111111111111',
  );
}

function findButton(html: string, label: string) {
  const found = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find((item) =>
    item[0].includes(label),
  );
  assert.ok(found, label);
  return found[0];
}

test('pay-later cards expose collection before and after service and open payment controls without marking paid', async () => {
  const counter = await fixture('dine_in');
  const unpaid = unpaidDineInOrder(counter);
  for (const status of ['confirmed', 'preparing', 'ready', 'served'] as const) {
    const order = { ...unpaid, status };
    const html = counter.renderCards([order]);
    assert.match(html, /UNPAID/);
    assert.match(html, /QA table 4/);
    assert.match(html, /27 Oct/);
    assert.doesNotMatch(findButton(html, 'Collect payment for'), /disabled/);
    let opened: { order: Order; collectPayment: boolean } | undefined;
    const cards = counter.cards({
      orders: [order],
      disabled: false,
      onOpen: (selected, collectPayment) => {
        opened = { order: selected, collectPayment };
      },
    });
    const article = (cards.props as { children: ReactElement[] }).children[0];
    const collect = (article.props as { children: ReactElement[] }).children[1];
    (collect.props as { onClick: () => void }).onClick();
    assert.deepEqual(opened, { order, collectPayment: true });
    assert.equal(order.paymentStatus, 'pending');
    assert.equal(order.settlement, undefined);
  }
  assert.match(findButton(counter.renderCards([unpaid], true), 'Collect payment for'), /disabled/);
});

test('pay-later collection opens cash and merchant UPI controls after preparing, ready or served while unpaid closing stays blocked', async () => {
  const counter = await fixture('dine_in');
  const unpaid = unpaidDineInOrder(counter);
  counter.draft.collecting = true;
  for (const status of ['preparing', 'ready', 'served'] as const) {
    counter.draft.selected = { ...unpaid, status };
    const html = counter.render();
    const dialog = html.slice(html.indexOf('role="dialog"'));
    assert.match(html, /Filter counter bills/);
    assert.match(html, /Awaiting payment/);
    assert.match(html, /Search counter bills/);
    assert.match(dialog, /UNPAID · ₹179 due/);
    assert.match(dialog, /UPI · merchant QR/);
    assert.match(dialog, /Cash received.*Save payment.*₹179/);
    assert.doesNotMatch(dialog, /Payment recorded|Payment is already recorded/);
    if (status === 'served') assert.match(findButton(dialog, 'Close paid order'), /disabled/);
  }
  await writePreview('pay-later-served', counter.render());
});

test('paid, cancelled, closed, removed or review-required bills do not offer another payment and paid flags cannot enable closing', async () => {
  const counter = await fixture('dine_in');
  const unpaid = unpaidDineInOrder(counter);
  for (const change of [
    { status: 'cancelled' as const },
    { status: 'closed' as const },
    { paymentStatus: 'paid' as const },
    { channel: 'website' as const },
    { paymentReviewRequired: true },
    {
      testVoid: {
        kind: 'no_money_software_test' as const,
        recordedAt: unpaid.createdAt,
        reason: 'QA',
      },
    },
  ])
    assert.doesNotMatch(counter.renderCards([{ ...unpaid, ...change }]), /Collect payment for/);
  counter.draft.collecting = true;
  counter.draft.selected = { ...unpaid, status: 'served', paymentStatus: 'paid' };
  const dialog = counter.render().slice(counter.render().indexOf('role="dialog"'));
  assert.match(findButton(dialog, 'Close paid order'), /disabled/);
  assert.doesNotMatch(dialog, /Save payment/);
});

type WorkspaceElement = ReactElement<Record<string, unknown>>;
function findControl(
  element: unknown,
  predicate: (props: Record<string, unknown>) => boolean,
): WorkspaceElement | undefined {
  if (Array.isArray(element)) {
    for (const child of element) {
      const found = findControl(child, predicate);
      if (found) return found;
    }
  } else if (element && typeof element === 'object' && 'props' in element) {
    const node = element as WorkspaceElement;
    if (predicate(node.props)) return node;
    return findControl(node.props.children, predicate);
  }
}
const finishRequests = () => new Promise<void>((resolve) => setImmediate(resolve));

test('kitchen version changes release a rejected settlement for a fresh explicit confirmation using the latest version', async () => {
  const counter = await fixture('dine_in');
  const original = unpaidDineInOrder(counter);
  const current = { ...original, status: 'served' as const, version: original.version + 2 };
  const payment = {
    method: 'cash' as const,
    confirmedReceived: true as const,
    cashTendered: original.total,
  };
  const paid = settleCounterOrder(current, payment, 'qa-owner', '2026-10-27T13:00:00Z');
  counter.draft.selected = original;
  counter.draft.collecting = true;
  const attempts: { expectedVersion: number; idempotencyKey: string }[] = [];
  counter.state.commerce = async (path, options) => {
    if (path.endsWith('/settle')) {
      attempts.push(options?.body as (typeof attempts)[number]);
      if (attempts.length === 1)
        throw counter.state.makeCommerceError('Order changed', 409, 'version_conflict');
      return { order: paid };
    }
    if (path.includes('/awaiting-payment/'))
      return { orders: [], hasMore: false, nextCursor: null };
    if (path.endsWith(original.id)) return { order: current };
    return { orders: [paid], hasMore: false };
  };
  const render = counter.interactive();
  let workspace = render();
  const submit = () => {
    const controls = findControl(workspace, (props) => props.label === 'Save payment');
    assert.ok(controls, 'The staff member must explicitly confirm received payment.');
    (controls.props.onPayment as (value: typeof payment) => void)(payment);
  };
  submit();
  await finishRequests();
  workspace = render();
  assert.ok(
    findControl(
      workspace,
      (props) =>
        typeof props.children === 'string' && props.children.includes('Review the latest bill'),
    ),
  );
  assert.equal(attempts.length, 1, 'A version conflict must never automatically retry a payment.');
  assert.equal(
    findControl(workspace, (props) => props.children === 'Retry same payment confirmation'),
    undefined,
  );
  submit();
  await finishRequests();
  workspace = render();
  assert.equal(attempts[0].expectedVersion, original.version);
  assert.equal(attempts[1].expectedVersion, current.version);
  assert.notEqual(attempts[1].idempotencyKey, attempts[0].idempotencyKey);
  assert.ok(
    findControl(
      workspace,
      (props) =>
        props.role === 'status' &&
        Array.isArray(props.children) &&
        props.children.includes(`Payment recorded for ${paid.number}.`),
    ),
  );
});

test('an uncertain payment response preserves its original idempotency request and never confirms an unpaid recovery', async () => {
  const counter = await fixture('dine_in');
  const unpaid = unpaidDineInOrder(counter);
  const payment = {
    method: 'cash' as const,
    confirmedReceived: true as const,
    cashTendered: unpaid.total,
  };
  const paid = settleCounterOrder(unpaid, payment, 'qa-owner', '2026-10-27T13:00:00Z');
  counter.draft.selected = unpaid;
  counter.draft.collecting = true;
  const attempts: unknown[] = [];
  counter.state.commerce = async (path, options) => {
    if (path.endsWith('/settle')) {
      attempts.push(options?.body);
      if (attempts.length === 1) throw new Error('Connection lost');
      return { order: paid };
    }
    if (path.includes('/awaiting-payment/'))
      return { orders: [], hasMore: false, nextCursor: null };
    if (path.endsWith(unpaid.id)) return { order: unpaid };
    return { orders: [paid], hasMore: false };
  };
  const render = counter.interactive();
  let workspace = render();
  const controls = findControl(workspace, (props) => props.label === 'Save payment');
  assert.ok(controls);
  (controls.props.onPayment as (value: typeof payment) => void)(payment);
  await finishRequests();
  workspace = render();
  assert.equal(
    findControl(workspace, (props) => props.label === 'Save payment'),
    undefined,
  );
  assert.equal(
    findControl(
      workspace,
      (props) =>
        props.role === 'status' &&
        Array.isArray(props.children) &&
        props.children.some(
          (child) => typeof child === 'string' && child.startsWith('Payment recorded for'),
        ),
    ),
    undefined,
  );
  const retry = findControl(
    workspace,
    (props) => props.children === 'Retry same payment confirmation',
  );
  assert.ok(retry);
  (retry.props.onClick as () => void)();
  await finishRequests();
  assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[1], attempts[0]);
  workspace = render();
  assert.ok(
    findControl(
      workspace,
      (props) =>
        props.role === 'status' &&
        Array.isArray(props.children) &&
        props.children.includes(`Payment recorded for ${paid.number}.`),
    ),
  );
});

test('counter polling is single-flight and pauses after three loaded unpaid pages while manual refresh preserves the loaded list', async () => {
  const counter = await fixture('dine_in');
  const unpaid = unpaidDineInOrder(counter);
  let cleanups: (void | (() => void))[] = [];
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let waiting = true;
  const requests: string[] = [];
  counter.state.commerce = async (path) => {
    requests.push(path);
    if (waiting) await pending;
    if (!path.includes('/awaiting-payment/')) return { orders: [], hasMore: false };
    const cursor = path.split('/').at(-1);
    const page = cursor === 'start' ? 1 : Number(cursor?.split('_')[1]);
    return {
      orders: [{ ...unpaid, id: `qa-unpaid-${page}`, number: `QA-${page}` }],
      hasMore: page < 4,
      nextCursor: page < 4 ? `page_${page + 1}` : null,
    };
  };
  const render = counter.interactive();
  let workspace = render();
  try {
    cleanups = render.mount();
    assert.equal(counter.timerCount(), 1);
    counter.advance(50000);
    assert.equal(requests.length, 2, 'Slow requests must not start overlapping polling chains.');
    waiting = false;
    release!();
    await finishRequests();
    counter.advance(9999);
    assert.equal(requests.length, 2, 'The next automatic read waits for its ten-second interval.');
    counter.advance(1);
    await finishRequests();
    assert.equal(requests.length, 4);
    counter.document.visibilityState = 'hidden';
    counter.document.dispatchEvent(new Event('visibilitychange'));
    counter.advance(60000);
    counter.browser.dispatchEvent(new Event('focus'));
    await finishRequests();
    assert.equal(requests.length, 4, 'Hidden counter tabs must not read bills.');
    counter.document.visibilityState = 'visible';
    counter.document.dispatchEvent(new Event('visibilitychange'));
    counter.browser.dispatchEvent(new Event('focus'));
    await finishRequests();
    assert.equal(requests.length, 6, 'Returning to the counter starts one fresh list read.');
    workspace = render();
    for (let page = 2; page <= 4; page++) {
      const more = findControl(
        workspace,
        (props) => props.children === 'Load more awaiting payment',
      );
      assert.ok(more);
      (more.props.onClick as () => void)();
      await finishRequests();
      workspace = render();
    }
    assert.ok(
      findControl(
        workspace,
        (props) =>
          props.role === 'status' &&
          typeof props.children === 'string' &&
          props.children.includes('Automatic updates are paused'),
      ),
    );
    const beforePoll = requests.length;
    counter.advance(10000);
    await finishRequests();
    assert.equal(
      requests.length,
      beforePoll,
      'Automatic refresh must stay bounded after older pages are loaded.',
    );
    const refresh = findControl(
      workspace,
      (props) => Array.isArray(props.children) && props.children.includes('Refresh'),
    );
    assert.ok(refresh);
    (refresh.props.onClick as () => void)();
    await finishRequests();
    workspace = render();
    const cards = findControl(workspace, (props) => Array.isArray(props.orders));
    assert.ok(cards);
    assert.deepEqual(
      (cards.props.orders as Order[]).map((order) => order.id),
      ['qa-unpaid-1', 'qa-unpaid-2', 'qa-unpaid-3', 'qa-unpaid-4'],
    );
    assert.equal(
      requests.length - beforePoll,
      5,
      'Manual refresh must reload every previously loaded page plus recent orders.',
    );
  } finally {
    release?.();
    for (const cleanup of cleanups) if (cleanup) cleanup();
  }
  const afterUnmount = requests.length;
  counter.advance(10000);
  counter.browser.dispatchEvent(new Event('focus'));
  await finishRequests();
  assert.equal(counter.timerCount(), 0);
  assert.equal(requests.length, afterUnmount, 'Unmounted counters cannot restart list reads.');
});

test('settlement aborts obsolete list reads and its replacement refresh publishes the paid bill', async () => {
  const counter = await fixture('dine_in');
  const unpaid = unpaidDineInOrder(counter);
  const payment = {
    method: 'cash' as const,
    confirmedReceived: true as const,
    cashTendered: unpaid.total,
  };
  const paid = settleCounterOrder(unpaid, payment, 'qa-owner', '2026-10-27T13:00:00Z');
  counter.draft.selected = unpaid;
  counter.draft.collecting = true;
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const originalSignals: AbortSignal[] = [];
  let listReads = 0;
  counter.state.commerce = async (path, options) => {
    if (path.endsWith('/settle')) return { order: paid };
    const outstanding = path.includes('/awaiting-payment/');
    if (++listReads <= 2) {
      assert.ok(options?.signal);
      originalSignals.push(options.signal);
      await pending;
      return outstanding
        ? { orders: [unpaid], hasMore: false, nextCursor: null }
        : { orders: [unpaid], hasMore: false };
    }
    return outstanding
      ? { orders: [], hasMore: false, nextCursor: null }
      : { orders: [paid], hasMore: false };
  };
  const render = counter.interactive();
  let workspace = render();
  let cleanups: (void | (() => void))[] = [];
  try {
    cleanups = render.mount();
    const controls = findControl(workspace, (props) => props.label === 'Save payment');
    assert.ok(controls);
    (controls.props.onPayment as (value: typeof payment) => void)(payment);
    await finishRequests();
    assert.equal(
      listReads,
      4,
      'The mutation must start its replacement refresh while old reads are unresolved.',
    );
    assert.ok(originalSignals.every((signal) => signal.aborted));
    release!();
    await finishRequests();
    workspace = render();
    const cards = findControl(workspace, (props) => Array.isArray(props.orders));
    assert.ok(cards);
    assert.deepEqual(
      cards.props.orders,
      [paid],
      'A late unpaid response must never overwrite the confirmed paid order.',
    );
  } finally {
    release?.();
    for (const cleanup of cleanups) if (cleanup) cleanup();
  }
});

test('a newer paid snapshot wins over a simultaneous stale unpaid page in cards, payment queue and selected bill', async () => {
  const counter = await fixture('dine_in');
  const unpaid = unpaidDineInOrder(counter);
  const paid = settleCounterOrder(
    unpaid,
    { method: 'cash', confirmedReceived: true, cashTendered: unpaid.total },
    'qa-owner',
    '2026-10-27T13:00:00Z',
  );
  counter.draft.selected = unpaid;
  counter.draft.collecting = true;
  counter.state.commerce = async (path) =>
    path.includes('/awaiting-payment/')
      ? { orders: [unpaid], hasMore: false, nextCursor: null }
      : { orders: [paid], hasMore: false };
  const render = counter.interactive();
  let workspace = render();
  let cleanups: (void | (() => void))[] = [];
  try {
    cleanups = render.mount();
    await finishRequests();
    workspace = render();
    const cards = findControl(workspace, (props) => Array.isArray(props.orders));
    assert.ok(cards);
    assert.deepEqual(cards.props.orders, [paid]);
    assert.equal(
      findControl(workspace, (props) => props.label === 'Save payment'),
      undefined,
    );
    const shortcut = findControl(workspace, (props) => props.className === 'paymentShortcut');
    assert.ok(shortcut);
    (shortcut.props.onClick as () => void)();
    workspace = render();
    const unpaidCards = findControl(workspace, (props) => Array.isArray(props.orders));
    assert.ok(unpaidCards);
    assert.deepEqual(unpaidCards.props.orders, []);
  } finally {
    for (const cleanup of cleanups) if (cleanup) cleanup();
  }
});
