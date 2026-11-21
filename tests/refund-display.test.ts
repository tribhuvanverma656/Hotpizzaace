import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { initialBranches, initialOrders } from '../lib/data';
import { calculateRestaurantGst } from '../lib/billing';
import { commerceRequest } from '../lib/commerce/client';
import type { Order } from '../types';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = build({
  absWorkingDir: repositoryRoot,
  tsconfig: resolve(repositoryRoot, 'tsconfig.json'),
  stdin: {
    contents:
      'export {OrderBill} from "./components/order-bill"; export {PaymentPill} from "./components/admin/shared"; export {OrderDetail} from "./components/order-detail"; export {OrderDetailPanel as AdminOrderDetail} from "./components/admin/orders";',
    resolveDir: repositoryRoot,
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  plugins: [
    {
      name: 'refund-render-context',
      setup(plugin) {
        plugin.onResolve({ filter: /^react$/ }, (args) =>
          args.importer.endsWith('/components/admin/orders.tsx')
            ? { path: 'hooks', namespace: 'refund-fixture' }
            : { path: 'react', external: true },
        );
        for (const [filter, path] of [
          [/^@\/lib\/store$/, 'store'],
          [/shared-commerce-provider$/, 'shared'],
          [/use-admin-store$/, 'admin'],
          [/payments\/(razorpay-payment|online-payment)$/, 'payment'],
          [/\.module\.css$/, 'styles'],
          [/^next\/link$/, 'link'],
          [/^next\/navigation$/, 'navigation'],
          [/^sonner$/, 'toast'],
        ] as const)
          plugin.onResolve({ filter }, () => ({ path, namespace: 'refund-fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'refund-fixture' }, ({ path }) => ({
          resolveDir: repositoryRoot,
          contents: {
            store: 'export function useDemoStore(selector) {return selector(fixture.store)}',
            shared: 'export function useSharedCommerce() {return fixture.shared}',
            admin:
              'export function useAdminStore() {return {...fixture.store,shared:fixture.shared}}',
            payment:
              'import {createElement} from "react"; export function RazorpayPayment(){return createElement("button",null,"Pay with Razorpay")} export const OnlinePayment = RazorpayPayment;',
            styles: 'export default new Proxy({}, {get:(_,key)=>String(key)})',
            link: 'import {createElement} from "react"; export default function Link(props){return createElement("a",props)}',
            navigation: 'export function useParams(){return {id:fixture.store.orders[0].id}}',
            hooks:
              'import * as React from "react"; export {useEffect,useRef} from "react"; export const useState = (...args) => (fixture.hooks ?? React).useState(...args);',
            toast:
              'const notify = (kind) => (message) => fixture.toasts.push({kind,message}); export const toast = Object.assign(notify("notice"), {success:notify("success"),error:notify("error")});',
          }[path]!,
        }));
      },
    },
  ],
});

async function renderer(order: Order) {
  const state = {
    store: { branches: initialBranches, orders: [order] },
    shared: {
      enabled: true,
      mode: order.environment,
      allowSimulatedPayments: false,
      refreshAdmin: async () => {
        state.refreshes += 1;
      },
    },
    refreshes: 0,
    toasts: [] as { kind: string; message: string }[],
    hooks: undefined as
      undefined | { useState: (initial: unknown) => [unknown, (next: unknown) => void] },
  };
  type Component = (props: {
    order: Order;
    confirmation?: boolean;
    mutate?: typeof mutate;
  }) => ReturnType<typeof createElement>;
  const mutate = async (path: string, options: Parameters<typeof commerceRequest>[1]) => {
    const result = await commerceRequest<{ order: Order }>(path, options);
    await state.shared.refreshAdmin();
    return result.order;
  };
  const output = {
    exports: {} as Record<
      'OrderBill' | 'PaymentPill' | 'OrderDetail' | 'AdminOrderDetail',
      Component
    >,
  };
  new Function('require', 'module', 'exports', 'fixture', (await bundle).outputFiles[0].text)(
    createRequire(import.meta.url),
    output,
    output.exports,
    state,
  );
  const render = (component: keyof typeof output.exports) =>
    renderToStaticMarkup(
      createElement(output.exports[component], { order, confirmation: true, mutate }),
    );
  return Object.assign(render, {
    state,
    interactive: () => {
      const slots: unknown[] = [];
      let position = 0;
      state.hooks = {
        useState: (initial) => {
          const index = position++;
          if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
          return [
            slots[index],
            (next) => {
              slots[index] = typeof next === 'function' ? next(slots[index]) : next;
            },
          ];
        },
      };
      return () => {
        position = 0;
        return output.exports.AdminOrderDetail({ order, mutate });
      };
    },
  });
}

type InteractiveElement = ReactElement<Record<string, unknown>>;
function refundButton(tree: unknown): InteractiveElement | undefined {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const result = refundButton(child);
      if (result) return result;
    }
  } else if (tree && typeof tree === 'object' && 'props' in tree) {
    const node = tree as InteractiveElement;
    if (
      node.type === 'button' &&
      ['Refresh refund status', 'Checking refund status…'].includes(String(node.props.children))
    )
      return node;
    return refundButton(node.props.children);
  }
}

function captured(): Order {
  const original = structuredClone(initialOrders[0]);
  return {
    ...original,
    branchId: 'barra',
    fulfillment: 'pickup',
    customer: { ...original.customer, name: 'Fictional Refund QA', phone: '9000000001' },
    items: [{ ...original.items[0], name: 'QA Pizza', unitPrice: 21000, quantity: 1 }],
    subtotal: 21000,
    discount: 0,
    deliveryFee: 0,
    tax: calculateRestaurantGst(21000, {
      businessName: 'HOT PIZZA ACE',
      address: 'ME 346, Barra 2, Kanpur 208027',
      gstin: '09ANCPV1491R1Z3',
      fssaiNumber: '12721045000614',
      stateName: 'Uttar Pradesh',
      stateCode: '09',
      sac: '996331',
      cgstRate: 2.5,
      sgstRate: 2.5,
    }),
    environment: 'production',
    paymentMode: 'razorpay_live',
    paymentMethod: 'card',
    paymentStatus: 'paid',
    status: 'pending',
    total: 22050,
    invoice: { number: 'QA-ORIGINAL-1', issuedAt: '2026-10-29T05:00:00Z', kind: 'tax_invoice' },
  };
}

async function preview(name: string, html: string) {
  const destination = process.env.HPA_REFUND_UI_PREVIEW_DIR;
  if (!destination) return;
  const directory = resolve(destination);
  assert.ok(directory.startsWith('/private/tmp/'));
  const [globalStyles, billStyles] = await Promise.all([
    readFile(resolve(repositoryRoot, 'app/globals.css'), 'utf8'),
    readFile(resolve(repositoryRoot, 'components/order-bill.module.css'), 'utf8'),
  ]);
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, `${name}.html`),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Refund QA preview</title><style>${globalStyles.replace("@import 'tailwindcss';", '')}\n${billStyles}\nbody{padding:24px}main{max-width:1180px;margin:auto} @media(max-width:600px){body{padding:12px}}</style></head><body><main><p>FICTIONAL QA PREVIEW — no payment or live order</p>${html}</main></body></html>`,
  );
}

test('bill shows the frozen customer-favour adjustment and leaves historical paise totals unchanged', async () => {
  const legacy = captured();
  const original = structuredClone(legacy);
  const historic = (await renderer(legacy))('OrderBill');
  assert.match(historic, /₹220\.50/);
  assert.doesNotMatch(historic, /Round off/);
  const rounded = { ...legacy, roundOff: -50, total: 22000 };
  const bill = (await renderer(rounded))('OrderBill');
  assert.match(bill, /Round off<\/span><b>-₹0\.50<\/b>/);
  assert.match(bill, /CGST \(2\.5%\)<\/span><b>₹5\.25<\/b>/);
  assert.match(bill, /SGST \(2\.5%\)<\/span><b>₹5\.25<\/b>/);
  assert.match(bill, /<strong>₹220<\/strong>/);
  assert.deepEqual(legacy, original);
});

test('bill displays a positive nearest adjustment without recalculating its frozen GST or receipt', async () => {
  const receipt = {
    ...captured(),
    roundOff: 50,
    roundOffPolicy: 'nearest_rupee' as const,
    total: 22100,
  };
  const saved = structuredClone(receipt);
  const bill = (await renderer(receipt))('OrderBill');
  assert.match(bill, /Round off<\/span><b>\+₹0\.50<\/b>/);
  assert.match(bill, /CGST \(2\.5%\)<\/span><b>₹5\.25<\/b>/);
  assert.match(bill, /SGST \(2\.5%\)<\/span><b>₹5\.25<\/b>/);
  assert.match(bill, /<strong>₹221<\/strong>/);
  assert.deepEqual(receipt, saved);
});

test('refund displays preserve original bill values and show a separate processed refund record without a new-charge action', async () => {
  for (const [amount, label, net] of [
    [5000, 'Partial refund', '₹170.50'],
    [22050, 'Refunded', '₹0'],
  ] as const) {
    const order: Order = {
      ...captured(),
      refund: {
        amount,
        status: amount === 22050 ? 'full' : 'partial',
        entries: [
          {
            id: 'rfnd_QAFixture',
            amount,
            processedAt: '2026-10-30T05:00:00Z',
            timestampSource: 'provider_event',
          },
        ],
      },
    };
    const original = structuredClone(order);
    const render = await renderer(order);
    const pill = render('PaymentPill');
    assert.match(pill, new RegExp(label));
    assert.doesNotMatch(pill, /payment-paid/);
    const bill = render('OrderBill');
    assert.match(bill, /Original bill total including GST|Original bill total/);
    assert.match(bill, /₹220\.50/);
    assert.match(bill, /aria-label="Payment refund record"/);
    assert.match(bill, /Original bill: QA-ORIGINAL-1/);
    assert.match(bill, /not a tax\s*credit note/);
    assert.match(bill, /rfnd_QAFixture/);
    assert.match(bill, /Processed/);
    assert.match(bill, /₹5\.25/);
    assert.match(bill, /09ANCPV1491R1Z3/);
    assert.match(bill, /12721045000614/);
    assert.ok(bill.includes(net));
    const customer = render('OrderDetail');
    assert.match(customer, /Do not pay again/);
    assert.match(customer, /Fulfillment is paused for restaurant review/);
    assert.doesNotMatch(customer, /Pay with Razorpay|Simulate a successful retry/);
    const admin = render('AdminOrderDetail');
    assert.match(admin, /Net payment retained/);
    assert.match(admin, /Fulfillment is paused for payment review/);
    assert.match(admin, /Refresh refund status/);
    assert.doesNotMatch(admin, /<button[^>]*>Confirmed<\/button>/);
    assert.deepEqual(order, original);
    await preview(amount === 22050 ? 'full-refund' : 'partial-refund', customer);
  }
});

test('verification fallback timestamps are labeled verified and test refunds never claim real money', async () => {
  const order: Order = {
    ...captured(),
    environment: 'development',
    paymentMode: 'razorpay_test',
    invoice: { number: 'QA-TEST-1', issuedAt: '2026-10-29T05:00:00Z', kind: 'test_bill' },
    refund: {
      amount: 22050,
      status: 'full',
      entries: [
        {
          id: 'rfnd_QATest',
          amount: 22050,
          processedAt: '2026-10-30T06:00:00Z',
          timestampSource: 'verified_at',
        },
      ],
    },
  };
  const render = await renderer(order);
  assert.match(render('OrderBill'), /Test payment refund record/);
  assert.match(render('OrderBill'), /Verified/);
  assert.match(render('OrderBill'), /No real payment or food order/);
  assert.match(render('PaymentPill'), /Refunded · test/);
  assert.match(render('OrderDetail'), /in Test Mode/);
});

test('unrefunded Razorpay and manual counter receipts retain their existing behavior', async () => {
  const render = await renderer(captured());
  assert.match(render('OrderDetail'), /Pay with Razorpay/);
  assert.doesNotMatch(render('OrderBill'), /Payment refund record|Original bill total/);
  for (const method of ['cash', 'upi'] as const) {
    const counter: Order = {
      ...captured(),
      channel: 'counter',
      paymentMode: 'counter_manual',
      paymentMethod: method,
      settlement: {
        source: 'staff',
        method,
        amount: 22050,
        confirmedBy: 'qa-owner',
        confirmedAt: '2026-10-29T05:00:00Z',
      },
    };
    const manual = await renderer(counter);
    assert.match(manual('OrderBill'), method === 'cash' ? /Cash received/ : /Direct UPI received/);
    assert.doesNotMatch(manual('AdminOrderDetail'), /Refresh refund status/);
  }
});

test('incomplete refund synchronization keeps original gross but never presents a final retained balance or payment retry', async () => {
  for (const hasConfirmedPartial of [false, true]) {
    const order: Order = {
      ...captured(),
      refundSyncPending: true,
      paymentReviewRequired: true,
      ...(hasConfirmedPartial
        ? {
            refund: {
              amount: 5000,
              status: 'partial' as const,
              entries: [
                {
                  id: 'rfnd_QAConfirmed',
                  amount: 5000,
                  processedAt: '2026-10-30T05:00:00Z',
                  timestampSource: 'provider_event' as const,
                },
              ],
            },
          }
        : {}),
    };
    const original = structuredClone(order);
    const render = await renderer(order);
    assert.match(render('PaymentPill'), /Refund needs reconciliation/);
    assert.doesNotMatch(render('PaymentPill'), /payment-paid/);
    for (const component of ['OrderBill', 'OrderDetail', 'AdminOrderDetail'] as const) {
      const html = render(component);
      assert.match(html, /Awaiting reconciliation/);
      assert.doesNotMatch(html, /Net payment retained(?:<\/span>|:)\s*<(?:b|strong)>\s*₹/);
      assert.doesNotMatch(html, /₹170\.50/);
      assert.doesNotMatch(html, /Pay with Razorpay|Simulate a successful retry/);
      assert.match(html, /₹220\.50/);
      if (hasConfirmedPartial) {
        assert.match(html, /Confirmed processed refunds/);
        assert.match(html, /₹50/);
      }
    }
    assert.match(render('OrderBill'), /Original bill total including GST/);
    assert.match(render('OrderDetail'), /Updating refund status/);
    assert.match(render('AdminOrderDetail'), /Refresh refund status/);
    assert.deepEqual(order, original);
    await preview(
      hasConfirmedPartial ? 'partial-refund-sync-pending' : 'refund-sync-pending',
      render('OrderDetail'),
    );
  }
});

test('refund refresh button sends real JSON through commerceRequest and recovers its loading state after success or failure', async () => {
  const order = captured();
  const original = structuredClone(order);
  const render = await renderer(order);
  const view = render.interactive();
  const originalFetch = globalThis.fetch;
  const requests: { url: string; options: RequestInit }[] = [];
  let respond: ((response: Response) => void) | undefined;
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options: options ?? {} });
    return new Promise<Response>((resolve) => {
      respond = resolve;
    });
  };
  try {
    for (const succeeds of [true, false]) {
      const button = refundButton(view());
      assert.ok(button, 'The captured Razorpay order must expose refund refresh.');
      assert.equal(button.props.disabled, false);
      const refreshing = (button.props.onClick as () => Promise<void>)();
      assert.equal(refundButton(view())?.props.disabled, true);
      assert.equal(refundButton(view())?.props.children, 'Checking refund status…');
      const request = requests.at(-1)!;
      assert.equal(
        request.url,
        `/api/commerce/admin/orders/${encodeURIComponent(order.id)}/payment/reconcile`,
      );
      assert.equal(request.options.method, 'POST');
      assert.equal(request.options.credentials, 'same-origin');
      assert.equal(request.options.cache, 'no-store');
      const headers = new Headers(request.options.headers);
      assert.equal(headers.get('Accept'), 'application/json');
      assert.equal(headers.get('Content-Type'), 'application/json');
      assert.equal(request.options.body, '{}');
      assert.deepEqual(JSON.parse(String(request.options.body)), {});
      assert.ok(respond);
      respond(
        succeeds
          ? Response.json({ order })
          : Response.json({ error: 'Refund history is temporarily unavailable.' }, { status: 503 }),
      );
      await refreshing;
      assert.equal(refundButton(view())?.props.disabled, false);
      assert.equal(refundButton(view())?.props.children, 'Refresh refund status');
      assert.equal(render.state.refreshes, 1, 'Only a successful check refreshes the admin data.');
      assert.deepEqual(
        render.state.toasts.at(-1),
        succeeds
          ? { kind: 'success', message: 'Refund status checked. No new refund was issued.' }
          : { kind: 'error', message: 'Refund history is temporarily unavailable.' },
      );
    }
    assert.equal(requests.length, 2, 'Each click performs one reconciliation request.');
    assert.deepEqual(order, original, 'Refreshing must not mutate the frozen bill locally.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
