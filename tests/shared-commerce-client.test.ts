import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cartMatchesPlacedOrder,
  commerceRequest,
  CommerceError,
  orderConfirmationHref,
  orderTrackingHref,
} from '../lib/commerce/client';
import type { CartItem, Order } from '../types';

const order = {
  id: 'order-123',
  branchId: 'barra',
  items: [{ id: 'line-1', productId: 'simple-cheese', quantity: 2 }],
} as Order;
const cart: CartItem[] = [
  { id: 'line-1', productId: 'simple-cheese', quantity: 2, toppingIds: [], notes: '' },
];

test('private tracking tokens survive confirmation navigation without accepting external links', () => {
  const privateOrder = {
    ...order,
    trackingUrl: '/track-order?order=order-123&access=private-token',
  };
  assert.equal(orderTrackingHref(privateOrder), privateOrder.trackingUrl);
  assert.equal(
    orderConfirmationHref(privateOrder),
    '/order-success?id=order-123&access=private-token',
  );
  assert.equal(
    orderTrackingHref({
      ...order,
      trackingUrl: 'https://external.example/track-order?access=secret',
    }),
    '/track-order?order=order-123',
  );
  assert.equal(
    orderTrackingHref({ ...order, trackingUrl: '//external.example/track-order?access=secret' }),
    '/track-order?order=order-123',
  );
  assert.equal(
    orderConfirmationHref({ ...order, trackingUrl: 'javascript:alert(1)' }),
    '/order-success?id=order-123',
  );
});

test('completing an order only clears the cart that was actually submitted', () => {
  assert.equal(cartMatchesPlacedOrder(cart, order, 'barra'), true);
  assert.equal(cartMatchesPlacedOrder(cart, order, 'other-branch'), false);
  assert.equal(cartMatchesPlacedOrder([{ ...cart[0], quantity: 3 }], order, 'barra'), false);
  assert.equal(
    cartMatchesPlacedOrder([{ ...cart[0], id: 'new-customisation' }], order, 'barra'),
    false,
  );
  assert.equal(
    cartMatchesPlacedOrder([...cart, { ...cart[0], id: 'new-line' }], order, 'barra'),
    false,
  );
  assert.equal(
    cartMatchesPlacedOrder([{ ...cart[0], productId: 'different-pizza' }], order, 'barra'),
    false,
  );
});

test('shared requests send server sessions with no-store and do not accept local storage identity', async () => {
  const original = globalThis.fetch;
  const calls: { path: unknown; options?: RequestInit }[] = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return new Response(JSON.stringify({ orders: [] }), { status: 200 });
  };
  try {
    assert.deepEqual(await commerceRequest('orders'), { orders: [] });
    assert.equal(calls[0].path, '/api/commerce/orders');
    assert.equal(calls[0].options?.credentials, 'same-origin');
    assert.equal(calls[0].options?.cache, 'no-store');
    assert.equal(calls[0].options?.body, undefined);
    assert.equal(new Headers(calls[0].options?.headers).get('Authorization'), null);
    await commerceRequest('orders', {
      method: 'POST',
      body: { items: cart, idempotencyKey: 'stable-key' },
    });
    assert.equal(calls[1].options?.method, 'POST');
    assert.equal(new Headers(calls[1].options?.headers).get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(calls[1].options?.body as string), {
      items: cart,
      idempotencyKey: 'stable-key',
    });
  } finally {
    globalThis.fetch = original;
  }
});

test('shared request errors are explicit and never turn into a successful demo result', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({ error: 'Cash orders are currently disabled.', code: 'cash_disabled' }),
        {
          status: 409,
        },
      );
    await assert.rejects(
      () => commerceRequest('orders', { method: 'POST', body: {} }),
      (error) =>
        error instanceof CommerceError &&
        error.status === 409 &&
        error.code === 'cash_disabled' &&
        error.message === 'Cash orders are currently disabled.',
    );
    globalThis.fetch = async () => new Response('offline', { status: 503 });
    await assert.rejects(
      () => commerceRequest('orders'),
      (error) => error instanceof CommerceError && error.status === 503,
    );
    globalThis.fetch = async () => new Response('null', { status: 200 });
    await assert.rejects(
      () => commerceRequest('orders'),
      (error) => error instanceof CommerceError && error.status === 502,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('first guest order retries only the explicit nonce bootstrap response once, preserving idempotency', async () => {
  const original = globalThis.fetch;
  const calls: RequestInit[] = [];
  const body = { idempotencyKey: 'same-key', items: cart };
  try {
    globalThis.fetch = async (_path, options) => {
      calls.push(options!);
      return calls.length === 1
        ? new Response(JSON.stringify({ code: 'guest_session_initialized' }), { status: 409 })
        : new Response(JSON.stringify({ order }), { status: 200 });
    };
    assert.deepEqual(await commerceRequest('orders', { method: 'POST', body }), { order });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body, calls[1].body);
    calls.length = 0;
    globalThis.fetch = async (_path, options) => {
      calls.push(options!);
      return new Response(JSON.stringify({ code: 'guest_session_initialized' }), { status: 409 });
    };
    await assert.rejects(() => commerceRequest('orders', { method: 'POST', body }), CommerceError);
    assert.equal(calls.length, 2);
    calls.length = 0;
    globalThis.fetch = async (_path, options) => {
      calls.push(options!);
      return new Response(JSON.stringify({ code: 'revision_conflict' }), { status: 409 });
    };
    await assert.rejects(() => commerceRequest('orders', { method: 'POST', body }), CommerceError);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

function stallUntilAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}
test('a component cancellation signal does not remove the 20-second deadline on a stalled kitchen read', async (t) => {
  const original = globalThis.fetch;
  const component = new AbortController();
  const deadline = new AbortController();
  const timeout = t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 20_000);
    return deadline.signal;
  });
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = (_path, options) => {
    requestSignal = options?.signal as AbortSignal;
    return stallUntilAborted(requestSignal);
  };
  const pending = commerceRequest('admin/kitchen/barra', { signal: component.signal });
  void pending.catch(() => {});
  try {
    assert.equal(timeout.mock.callCount(), 1);
    assert.ok(requestSignal);
    assert.notEqual(requestSignal, component.signal);
    const reason = new DOMException('The restaurant request timed out.', 'TimeoutError');
    deadline.abort(reason);
    await assert.rejects(pending, (cause) => cause === reason);
    assert.equal(requestSignal.aborted, true);
    assert.equal(component.signal.aborted, false);
  } finally {
    component.abort();
    await pending.catch(() => {});
    globalThis.fetch = original;
  }
});

test('explicit component cancellation aborts a pending request with its original reason', async (t) => {
  const original = globalThis.fetch;
  const component = new AbortController();
  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => deadline.signal);
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = (_path, options) => {
    requestSignal = options?.signal as AbortSignal;
    return stallUntilAborted(requestSignal);
  };
  const pending = commerceRequest('admin/kitchen/barra', { signal: component.signal });
  try {
    const reason = new DOMException('Kitchen branch changed.', 'AbortError');
    component.abort(reason);
    await assert.rejects(pending, (cause) => cause === reason);
    assert.equal(requestSignal?.aborted, true);
    assert.equal(deadline.signal.aborted, false);
  } finally {
    component.abort();
    await pending.catch(() => {});
    globalThis.fetch = original;
  }
});

test('an already cancelled request never fetches or retries', async (t) => {
  const original = globalThis.fetch;
  const component = new AbortController();
  const reason = new DOMException('Page was closed.', 'AbortError');
  component.abort(reason);
  t.mock.method(AbortSignal, 'timeout', () => new AbortController().signal);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ orders: [] }), { status: 200 });
  };
  try {
    await assert.rejects(
      commerceRequest('admin/kitchen/barra', { signal: component.signal }),
      (cause) => cause === reason,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('a cancelled response body preserves cancellation instead of a false malformed-response error', async (t) => {
  const original = globalThis.fetch;
  const component = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => new AbortController().signal);
  const reason = new DOMException('Kitchen branch changed.', 'AbortError');
  globalThis.fetch = async (_path, options) => {
    const response = new Response('', { status: 200 });
    response.json = async () => {
      component.abort(reason);
      return stallUntilAborted(options?.signal as AbortSignal);
    };
    return response;
  };
  try {
    await assert.rejects(
      commerceRequest('admin/kitchen/barra', { signal: component.signal }),
      (cause) => cause === reason,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('nonce bootstrap retry shares the original deadline and cannot continue after cancellation', async (t) => {
  const original = globalThis.fetch;
  const component = new AbortController();
  const deadline = new AbortController();
  const timeout = t.mock.method(AbortSignal, 'timeout', () => deadline.signal);
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_path, options) => {
    calls.push(options!);
    return calls.length === 1
      ? new Response(JSON.stringify({ code: 'guest_session_initialized' }), { status: 409 })
      : new Response(JSON.stringify({ order }), { status: 200 });
  };
  try {
    assert.deepEqual(
      await commerceRequest('orders', {
        method: 'POST',
        body: { idempotencyKey: 'stable-key' },
        signal: component.signal,
      }),
      { order },
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal, calls[1].signal);
    assert.equal(timeout.mock.callCount(), 1);
    const reason = new DOMException('Checkout was closed.', 'AbortError');
    calls.length = 0;
    globalThis.fetch = async (_path, options) => {
      calls.push(options!);
      component.abort(reason);
      return new Response(JSON.stringify({ code: 'guest_session_initialized' }), { status: 409 });
    };
    await assert.rejects(
      commerceRequest('orders', {
        method: 'POST',
        body: { idempotencyKey: 'stable-key' },
        signal: component.signal,
      }),
      (cause) => cause === reason,
    );
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('caller cancellation and deadlines work when AbortSignal.any is unavailable in supported Safari', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalAny = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
  const component = new AbortController();
  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', () => deadline.signal);
  Object.defineProperty(AbortSignal, 'any', { configurable: true, value: undefined });
  globalThis.fetch = (_path, options) => stallUntilAborted(options?.signal as AbortSignal);
  const pending = commerceRequest('admin/kitchen/barra', { signal: component.signal });
  void pending.catch(() => {});
  try {
    const reason = new DOMException('The restaurant request timed out.', 'TimeoutError');
    deadline.abort(reason);
    await assert.rejects(pending, (cause) => cause === reason);
    assert.equal(component.signal.aborted, false);
  } finally {
    component.abort();
    await pending.catch(() => {});
    globalThis.fetch = originalFetch;
    if (originalAny) Object.defineProperty(AbortSignal, 'any', originalAny);
    else Reflect.deleteProperty(AbortSignal, 'any');
  }
});

test('composed request listeners are removed after success, cancellation, timeout and network errors', async (t) => {
  for (const outcome of ['success', 'cancel', 'timeout', 'network'] as const) {
    await t.test(outcome, async (context) => {
      const originalFetch = globalThis.fetch;
      const component = new AbortController();
      const deadline = new AbortController();
      context.mock.method(AbortSignal, 'timeout', () => deadline.signal);
      const tracked = [component.signal, deadline.signal].map((source) => ({
        added: context.mock.method(source, 'addEventListener'),
        removed: context.mock.method(source, 'removeEventListener'),
      }));
      let requestSignal: AbortSignal | undefined;
      const reason = new DOMException(
        outcome,
        outcome === 'timeout' ? 'TimeoutError' : 'AbortError',
      );
      globalThis.fetch = async (_path, options) => {
        requestSignal = options?.signal as AbortSignal;
        if (outcome === 'success') return new Response(JSON.stringify({ orders: [] }));
        if (outcome === 'network') throw reason;
        return stallUntilAborted(requestSignal);
      };
      const pending = commerceRequest('admin/kitchen/barra', { signal: component.signal });
      try {
        if (outcome === 'success') assert.deepEqual(await pending, { orders: [] });
        else {
          if (outcome === 'cancel') component.abort(reason);
          if (outcome === 'timeout') deadline.abort(reason);
          await assert.rejects(pending, (cause) => cause === reason);
        }
        for (const { added, removed } of tracked) {
          const attached = added.mock.calls.filter((call) => call.arguments[0] === 'abort');
          const detached = removed.mock.calls.filter((call) => call.arguments[0] === 'abort');
          assert.equal(attached.length, 1);
          assert.equal(detached.length, 1);
          assert.equal(detached[0].arguments[1], attached[0].arguments[1]);
        }
        if (outcome === 'success') {
          // A later component unmount/deadline cannot retain or cancel a finished request.
          component.abort();
          deadline.abort();
          assert.equal(requestSignal?.aborted, false);
        }
      } finally {
        component.abort();
        await pending.catch(() => {});
        globalThis.fetch = originalFetch;
      }
    });
  }
});
