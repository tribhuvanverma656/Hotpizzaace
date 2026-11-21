type PollingEventTarget = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export type VisiblePollingEnvironment = {
  document: PollingEventTarget & { readonly visibilityState: string };
  window: PollingEventTarget;
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(timer: unknown): void;
  now(): number;
};

type VisiblePollingOptions = {
  refresh: () => void | Promise<unknown>;
  intervalMs: number;
  immediate?: boolean;
  canRefresh?: () => boolean;
};

/** Schedule reads only while visible; explicit user actions keep their own refresh path. */
export function startVisiblePolling(
  { refresh, intervalMs, immediate = true, canRefresh }: VisiblePollingOptions,
  environment: VisiblePollingEnvironment = {
    document,
    window,
    setInterval: (callback, delay) => setInterval(callback, delay),
    clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
    now: () => Date.now(),
  },
): () => void {
  let active = true;
  let running = false;
  let visible = environment.document.visibilityState === 'visible';
  let lastStarted = -Infinity;
  const run = (resumed = false) => {
    if (
      !active ||
      environment.document.visibilityState !== 'visible' ||
      running ||
      (canRefresh && !canRefresh()) ||
      (!resumed && environment.now() - lastStarted < Math.min(1000, intervalMs))
    )
      return;
    running = true;
    lastStarted = environment.now();
    // Refresh owners report their own errors and invalidate/abort reads during cleanup.
    // A failed scheduled read must not leave the poller locked or reject an event handler.
    try {
      void Promise.resolve(refresh())
        .catch(() => {})
        .finally(() => {
          running = false;
        });
    } catch {
      running = false;
    }
  };
  const foreground = () => {
    const nextVisible = environment.document.visibilityState === 'visible';
    const resumed = nextVisible && !visible;
    visible = nextVisible;
    if (nextVisible) run(resumed);
  };
  environment.document.addEventListener('visibilitychange', foreground);
  environment.window.addEventListener('focus', foreground);
  const timer = environment.setInterval(() => run(), intervalMs);
  if (immediate) run();
  return () => {
    active = false;
    environment.clearInterval(timer);
    environment.document.removeEventListener('visibilitychange', foreground);
    environment.window.removeEventListener('focus', foreground);
  };
}
