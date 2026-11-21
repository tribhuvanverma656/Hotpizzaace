import assert from 'node:assert/strict';
import test from 'node:test';
import { printBill, ReceiptTooLongError } from '../lib/receipt-print';

function printFixture() {
  let nextTask = 0;
  let focusRestored = 0;
  let printCalls = 0;
  let printError: Error | undefined;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const animationFrames = new Map<number, () => void>();
  const parentWindow = Object.assign(new EventTarget(), {
    setTimeout(callback: () => void, delay: number) {
      const id = ++nextTask;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    requestAnimationFrame(callback: () => void) {
      const id = ++nextTask;
      animationFrames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id: number) {
      animationFrames.delete(id);
    },
  });

  class PrintFrame {
    dataset: Record<string, string> = {};
    style = { cssText: '' };
    title = '';
    srcdoc = '';
    isConnected = false;
    onload: (() => Promise<void>) | null = null;
    onerror: (() => void) | null = null;
    media = Object.assign(new EventTarget(), { matches: false });
    pageStyles: { textContent: string }[] = [];
    contentDocument = {
      fonts: { ready: Promise.resolve() },
      body: { scrollHeight: 440 },
      createElement: () => ({ textContent: '' }),
      head: { append: (style: { textContent: string }) => this.pageStyles.push(style) },
    };
    contentWindow = Object.assign(new EventTarget(), {
      focus() {},
      matchMedia: () => this.media,
      print() {
        printCalls += 1;
        if (printError) throw printError;
      },
    });
    setAttribute() {}
    remove() {
      this.isConnected = false;
    }
  }

  const frames: PrintFrame[] = [];
  let controlsRemoved = false;
  const parentDocument = {
    defaultView: parentWindow,
    activeElement: {
      isConnected: true,
      focus() {
        focusRestored += 1;
      },
    },
    createElement() {
      const frame = new PrintFrame();
      frames.push(frame);
      return frame;
    },
    body: {
      innerHTML: '<main>Private dashboard that must not print</main>',
      append(frame: PrintFrame) {
        frame.isConnected = true;
      },
    },
  };
  const element = {
    ownerDocument: parentDocument,
    cloneNode() {
      return {
        querySelectorAll() {
          return [
            {
              remove() {
                controlsRemoved = true;
              },
            },
          ];
        },
        get outerHTML() {
          return `<section><header>Saved receipt</header>${controlsRemoved ? '' : '<button>Print</button>'}</section>`;
        },
      };
    },
  } as unknown as HTMLElement;

  return {
    element,
    frames,
    timers,
    parentWindow,
    get printCalls() {
      return printCalls;
    },
    get focusRestored() {
      return focusRestored;
    },
    set printError(error: Error | undefined) {
      printError = error;
    },
    flushLayout() {
      for (const [id, callback] of animationFrames) {
        animationFrames.delete(id);
        callback();
      }
    },
    runTimers(delay: number) {
      for (const [id, task] of [...timers]) {
        if (task.delay !== delay) continue;
        timers.delete(id);
        task.callback();
      }
    },
  };
}

test('58 mm printing isolates the receipt and sizes paper to content, then cleans up on dismissal', async () => {
  const fixture = printFixture();
  const pending = printBill(fixture.element, '58mm');
  const frame = fixture.frames[0];
  assert.match(frame.srcdoc, /width: 58mm/);
  assert.match(frame.srcdoc, /padding: 2mm 5mm/);
  assert.match(frame.srcdoc, /Saved receipt/);
  assert.doesNotMatch(frame.srcdoc, /Private dashboard|<button>/);
  await frame.onload!();
  fixture.flushLayout();
  assert.equal(fixture.printCalls, 1);
  assert.equal(frame.isConnected, true);
  const height = Number(frame.pageStyles[0].textContent.match(/58mm (\d+)mm/)?.[1]);
  assert.ok(height > 30 && height < 297, 'a short receipt must not feed a full A4 page');
  await assert.rejects(printBill(fixture.element, '58mm'), /already open/);
  assert.equal(frame.isConnected, true, 'a second click must not delete the active print source');
  frame.contentWindow.dispatchEvent(new Event('afterprint'));
  await pending;
  assert.equal(frame.isConnected, false);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.focusRestored, 1);
});

test('A4 remains available without custom receipt-height sizing', async () => {
  const fixture = printFixture();
  const pending = printBill(fixture.element, 'a4');
  const frame = fixture.frames[0];
  await frame.onload!();
  fixture.flushLayout();
  assert.match(frame.srcdoc, /size: A4/);
  assert.match(frame.srcdoc, /width: 210mm/);
  assert.equal(frame.pageStyles.length, 0);
  frame.contentWindow.dispatchEvent(new Event('afterprint'));
  await pending;
});

test('the largest supported thermal receipt retains its full measured height', async () => {
  const fixture = printFixture();
  const pending = printBill(fixture.element, '58mm');
  const frame = fixture.frames[0];
  // The page includes a 2 mm feed tolerance; the next pixel exceeds 3000 mm.
  frame.contentDocument.body.scrollHeight = Math.floor(((3000 - 2) * 96) / 25.4);
  await frame.onload!();
  fixture.flushLayout();
  assert.match(frame.pageStyles[0].textContent, /size: 58mm 3000mm/);
  assert.equal(fixture.printCalls, 1);
  frame.contentWindow.dispatchEvent(new Event('afterprint'));
  await pending;
  assert.equal(frame.isConnected, false);
  assert.equal(fixture.timers.size, 0);
});

test('an oversized thermal bill stops before printing and releases the frame for A4 and short receipts', async () => {
  const fixture = printFixture();
  const oversizedHeight = Math.floor(((3000 - 2) * 96) / 25.4) + 1;
  const rejected = assert.rejects(printBill(fixture.element, '58mm'), (error) => {
    assert.ok(error instanceof ReceiptTooLongError);
    assert.match(error.message, /too long.*58 mm.*Choose A4 invoice/);
    return true;
  });
  const oversized = fixture.frames[0];
  oversized.contentDocument.body.scrollHeight = oversizedHeight;
  await oversized.onload!();
  fixture.flushLayout();
  await rejected;
  assert.equal(fixture.printCalls, 0);
  assert.equal(oversized.isConnected, false);
  assert.equal(oversized.pageStyles.length, 0, 'do not clamp or paginate the thermal page');
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.focusRestored, 1);

  const a4 = printBill(fixture.element, 'a4');
  const a4Frame = fixture.frames[1];
  a4Frame.contentDocument.body.scrollHeight = oversizedHeight;
  await a4Frame.onload!();
  fixture.flushLayout();
  assert.equal(fixture.printCalls, 1);
  assert.match(a4Frame.srcdoc, /size: A4/);
  a4Frame.contentWindow.dispatchEvent(new Event('afterprint'));
  await a4;

  const short = printBill(fixture.element, '58mm');
  const shortFrame = fixture.frames[2];
  await shortFrame.onload!();
  fixture.flushLayout();
  assert.equal(fixture.printCalls, 2);
  shortFrame.contentWindow.dispatchEvent(new Event('afterprint'));
  await short;
  assert.equal(
    fixture.frames.every((frame) => !frame.isConnected),
    true,
  );
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.focusRestored, 3);
});

test('a print exception removes the frame and permits a fresh attempt', async () => {
  const fixture = printFixture();
  fixture.printError = new Error('Printing unavailable');
  const failed = assert.rejects(printBill(fixture.element, '58mm'), /Printing unavailable/);
  await fixture.frames[0].onload!();
  fixture.flushLayout();
  await failed;
  assert.equal(fixture.frames[0].isConnected, false);
  assert.equal(fixture.timers.size, 0);
  fixture.printError = undefined;
  const retry = printBill(fixture.element, '58mm');
  await fixture.frames[1].onload!();
  fixture.flushLayout();
  fixture.frames[1].contentWindow.dispatchEvent(new Event('afterprint'));
  await retry;
  assert.equal(fixture.printCalls, 2);
});

test('load failures and stalled fonts reject without leaving an active frame', async () => {
  const fixture = printFixture();
  const failed = assert.rejects(printBill(fixture.element, '58mm'), /could not load/);
  fixture.frames[0].onerror!();
  await failed;
  const timedOut = assert.rejects(printBill(fixture.element, '58mm'), /too long/);
  const frame = fixture.frames[1];
  let finishFonts!: () => void;
  frame.contentDocument.fonts.ready = new Promise<void>((resolve) => {
    finishFonts = resolve;
  });
  const loading = frame.onload!();
  fixture.runTimers(15_000);
  await timedOut;
  finishFonts();
  await loading;
  fixture.flushLayout();
  assert.equal(frame.isConnected, false);
  assert.equal(fixture.printCalls, 0);
  assert.equal(fixture.timers.size, 0);
});

test('fallback cleanup waits while print media is active and releases a closed preview', async () => {
  const fixture = printFixture();
  const pending = printBill(fixture.element, '58mm');
  const frame = fixture.frames[0];
  await frame.onload!();
  fixture.flushLayout();
  frame.media.matches = true;
  fixture.runTimers(60_000);
  assert.equal(frame.isConnected, true);
  frame.media.matches = false;
  fixture.runTimers(60_000);
  await pending;
  assert.equal(frame.isConnected, false);
  assert.equal(fixture.timers.size, 0);
});

test('focus returning after cancellation cleans up without requiring afterprint', async () => {
  const fixture = printFixture();
  const pending = printBill(fixture.element, '58mm');
  const frame = fixture.frames[0];
  await frame.onload!();
  fixture.flushLayout();
  fixture.parentWindow.dispatchEvent(new Event('focus'));
  fixture.runTimers(0);
  await pending;
  assert.equal(frame.isConnected, false);
  assert.equal(fixture.focusRestored, 1);
  assert.equal(fixture.timers.size, 0);
});

for (const paper of ['58mm', '80mm'] as const) {
  test(`${paper} uses its own sheet width and rejects oversized receipts`, async () => {
    const fixture = printFixture();
    const pending = printBill(fixture.element, paper);
    const frame = fixture.frames[0];
    assert.ok(frame.srcdoc.includes(`width: ${paper}`));
    assert.ok(frame.style.cssText.includes(`width:${paper}`));
    if (paper === '80mm') {
      assert.match(frame.srcdoc, /padding: 2mm 4mm/);
      assert.match(frame.srcdoc, /font: 12px/);
      assert.doesNotMatch(frame.srcdoc, /58mm/);
    }
    await frame.onload!();
    fixture.flushLayout();
    assert.ok(frame.pageStyles[0].textContent.includes(`size: ${paper} 119mm`));
    frame.contentWindow.dispatchEvent(new Event('afterprint'));
    await pending;

    const rejected = assert.rejects(printBill(fixture.element, paper), (error) => {
      assert.ok(error instanceof ReceiptTooLongError);
      assert.ok(error.message.includes(`${paper.slice(0, 2)} mm`));
      return true;
    });
    fixture.frames[1].contentDocument.body.scrollHeight = 12000;
    await fixture.frames[1].onload!();
    await rejected;
    assert.equal(fixture.printCalls, 1);
    assert.equal(fixture.frames[1].isConnected, false);
  });
}
