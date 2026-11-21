import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, Fragment } from 'react';
import type { KitchenTicket } from '../lib/kitchen-staff';

const require = createRequire(import.meta.url);
function compiled(path: string, pathname = '/kitchen') {
  const result = buildSync({
    entryPoints: [path],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'next/navigation', 'next/dynamic', '*.css'],
  });
  const output = { exports: {} as Record<string, unknown> };
  const fixtureRequire = (name: string) =>
    name === 'next/navigation'
      ? { usePathname: () => pathname, useRouter: () => ({ replace() {} }) }
      : name === 'next/dynamic'
        ? { __esModule: true, default: () => 'customer-provider-boundary' }
        : name.endsWith('.css')
          ? {}
          : require(name);
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    fixtureRequire,
    output,
    output.exports,
  );
  return output.exports;
}

test('every kitchen route bypasses customer Auth, addresses and commerce providers', () => {
  for (const path of ['/kitchen', '/kitchen/login', '/kitchen/api/session']) {
    const { ApplicationProviders } = compiled('components/application-providers.tsx', path) as {
      ApplicationProviders: (props: { children: string; commerceEnabled: boolean }) => {
        type: unknown;
        props: { children: unknown };
      };
    };
    const element = ApplicationProviders({ children: 'chef-only', commerceEnabled: true });
    assert.equal(element.type, Fragment);
    assert.equal(element.props.children, 'chef-only');
  }
  for (const path of ['/', '/admin/settings', '/account/profile', '/kitchenette']) {
    const { ApplicationProviders } = compiled('components/application-providers.tsx', path) as {
      ApplicationProviders: (props: { children: string; commerceEnabled: boolean }) => {
        type: unknown;
      };
    };
    assert.equal(
      ApplicationProviders({ children: 'normal-page', commerceEnabled: true }).type,
      'customer-provider-boundary',
    );
  }
});

test('chef board shows compact preparation choices and keeps payment actions out', () => {
  const { ChefTicketBoard } = compiled('components/kitchen/queue.tsx') as {
    ChefTicketBoard: React.ComponentType<{
      tickets: KitchenTicket[];
      busy: string | null;
      blocked: boolean;
      now: number;
      onUpdate: () => void;
    }>;
  };
  const ticket: KitchenTicket = {
    id: 'qa',
    number: 'HPA-301026-0001',
    branchId: 'barra',
    branchName: 'Barra',
    createdAt: '2026-10-30T16:00:00Z',
    version: 1,
    status: 'confirmed',
    fulfillment: 'dine_in',
    channel: 'counter',
    items: [{ name: 'Paneer pizza', quantity: 2, options: ['Small', 'Thin crust'], notes: '' }],
    payLater: true,
    testOrder: true,
  };
  const markup = renderToStaticMarkup(
    createElement(ChefTicketBoard, {
      tickets: [ticket, { ...ticket, id: 'next', number: 'HPA-301026-0002', status: 'preparing' }],
      busy: null,
      blocked: false,
      now: Date.parse('2026-10-30T16:05:00Z'),
      onUpdate() {},
    }),
  );
  for (const text of [
    'Paneer pizza',
    'Thin crust',
    'Start preparing',
    'Mark ready',
    'Payment still due',
    'TEST',
  ])
    assert.ok(markup.includes(text), text);
  for (const text of ['Collect payment', 'Cash received', 'UPI', 'GST', 'Customer', '₹', 'href='])
    assert.equal(markup.includes(text), false, text);
  const offline = renderToStaticMarkup(
    createElement(ChefTicketBoard, {
      tickets: [ticket],
      busy: null,
      blocked: true,
      now: Date.parse(ticket.createdAt),
      onUpdate() {},
    }),
  );
  assert.match(offline, /disabled=""/);
});
