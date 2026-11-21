import assert from 'node:assert/strict';
import test from 'node:test';
import { startVisiblePolling, type VisiblePollingEnvironment } from '../lib/visible-polling';

class Events {
  listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function browser(initialVisibility = 'visible') {
  const document = Object.assign(new Events(), { visibilityState: initialVisibility });
  const window = new Events();
  const timers = new Map<number, { callback: () => void; interval: number; next: number }>();
  let time = 0;
  let nextId = 0;
  const environment: VisiblePollingEnvironment = {
    document,
    window,
    now: () => time,
    setInterval: (callback, interval) => {
      timers.set(++nextId, { callback, interval, next: time + interval });
      return nextId;
    },
    clearInterval: (id) => {
      timers.delete(id as number);
    },
  };
  return {
    environment,
    document,
    window,
    timers,
    visibility(value: string) {
      document.visibilityState = value;
      document.emit('visibilitychange');
    },
    async advance(milliseconds: number) {
      const end = time + milliseconds;
      while (true) {
        const next = Math.min(...[...timers.values()].map((timer) => timer.next));
        if (next > end) break;
        time = next;
        for (const timer of timers.values()) {
          if (timer.next !== next) continue;
          timer.next += timer.interval;
          timer.callback();
        }
        await settled();
      }
      time = end;
    },
  };
}

const settled = async () => {
  for (let turn = 0; turn < 4; turn++) await Promise.resolve();
};

test('visible polling keeps the operational cadence, skips hidden reads and catches up on return', async () => {
  const page = browser();
  const reads: number[] = [];
  const stop = startVisiblePolling(
    { refresh: () => void reads.push(page.environment.now()), intervalMs: 10_000 },
    page.environment,
  );
  assert.deepEqual(reads, [0]);
  await settled();
  await page.advance(10_000);
  assert.deepEqual(reads, [0, 10_000]);
  page.visibility('hidden');
  page.window.emit('focus');
  await page.advance(60_000);
  assert.equal(reads.length, 2);
  page.visibility('visible');
  await settled();
  page.window.emit('focus');
  assert.deepEqual(reads, [0, 10_000, 70_000], 'Return events should produce one immediate read.');
  await page.advance(10_000);
  assert.equal(reads.at(-1), 80_000);
  stop();
});

test('initial hidden pages wait until visible and coalesce focus before visibilitychange', async () => {
  const page = browser('hidden');
  let reads = 0;
  const stop = startVisiblePolling(
    { refresh: () => void reads++, intervalMs: 10_000 },
    page.environment,
  );
  await page.advance(10_000);
  assert.equal(reads, 0);
  page.document.visibilityState = 'visible';
  page.window.emit('focus');
  await settled();
  page.document.emit('visibilitychange');
  assert.equal(reads, 1);
  stop();
});

test('slow reads never overlap or build a backlog of background refreshes', async () => {
  const page = browser();
  let reads = 0;
  let finish: (() => void) | undefined;
  const stop = startVisiblePolling(
    {
      intervalMs: 10_000,
      refresh: () => {
        reads++;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    },
    page.environment,
  );
  await page.advance(40_000);
  page.visibility('hidden');
  page.visibility('visible');
  page.window.emit('focus');
  assert.equal(reads, 1);
  finish!();
  await settled();
  assert.equal(reads, 1, 'Finishing a slow read must not release a queued request burst.');
  await page.advance(10_000);
  assert.equal(reads, 2);
  stop();
  finish!();
  await settled();
  page.visibility('hidden');
  page.visibility('visible');
  await page.advance(60_000);
  assert.equal(reads, 2);
  assert.equal(page.timers.size, 0);
  assert.equal(page.document.listeners.get('visibilitychange')?.size, 0);
  assert.equal(page.window.listeners.get('focus')?.size, 0);
});

test('mutation guards defer scheduled reads while explicit refresh remains available', async () => {
  const page = browser();
  let mutating = true;
  let reads = 0;
  const refresh = () => void reads++;
  const stop = startVisiblePolling(
    { refresh, intervalMs: 10_000, canRefresh: () => !mutating },
    page.environment,
  );
  await page.advance(10_000);
  page.visibility('hidden');
  page.visibility('visible');
  assert.equal(reads, 0);
  refresh();
  assert.equal(reads, 1, 'A mutation completion can explicitly obtain authoritative state.');
  mutating = false;
  await page.advance(10_000);
  assert.equal(reads, 2);
  stop();
});

test('scheduled failures release the read lock and delayed mode avoids redundant initial reads', async () => {
  const page = browser();
  let reads = 0;
  const stop = startVisiblePolling(
    {
      immediate: false,
      intervalMs: 10_000,
      refresh: () => {
        reads++;
        if (reads === 1) return Promise.reject(new Error('offline'));
        if (reads === 2) throw new Error('unavailable');
      },
    },
    page.environment,
  );
  assert.equal(reads, 0);
  await page.advance(30_000);
  assert.equal(reads, 3);
  stop();
});

test('rapid hide and return still refreshes immediately without a duplicate focus read', async () => {
  const page = browser();
  let reads = 0;
  const stop = startVisiblePolling(
    { refresh: () => void reads++, intervalMs: 10_000 },
    page.environment,
  );
  await settled();
  await page.advance(100);
  page.visibility('hidden');
  page.visibility('visible');
  await settled();
  page.window.emit('focus');
  assert.equal(reads, 2, 'A real visibility return must bypass the foreground event debounce.');
  stop();
});
