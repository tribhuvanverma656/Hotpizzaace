export type BillPaper = '58mm' | '80mm' | 'a4';

export class ReceiptTooLongError extends Error {
  constructor(paper: '58mm' | '80mm' = '58mm') {
    super(
      `This bill is too long for a ${paper === '80mm' ? '80' : '58'} mm receipt. Choose A4 invoice to print it.`,
    );
    this.name = 'ReceiptTooLongError';
  }
}

const activeFrames = new WeakMap<Document, HTMLIFrameElement>();
const PREVIEW_LOAD_TIMEOUT_MS = 15_000;
const PRINT_CLEANUP_TIMEOUT_MS = 60_000;
const MAX_THERMAL_RECEIPT_HEIGHT_MM = 3000;

function printStyles(paper: BillPaper): string {
  const compact = paper !== 'a4';
  const width = paper === 'a4' ? '210mm' : paper;
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 0; color: #000; background: #fff; }
    body {
      width: ${width};
      padding: ${paper === '80mm' ? '2mm 4mm' : compact ? '2mm 5mm' : '12mm'};
      font: ${paper === '80mm' ? '12px' : compact ? '10px' : '13px'}/1.25 Arial, sans-serif;
      overflow-wrap: anywhere;
    }
    section { margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; }
    header {
      text-align: center;
      border-bottom: 1px dashed #000;
      padding-bottom: ${compact ? '1.5mm' : '5mm'};
      break-inside: avoid;
    }
    h2 { font-size: ${compact ? '11px' : '21px'}; margin: 0 0 ${compact ? '1mm' : '5mm'}; }
    header > strong { display: block; font-size: ${compact ? '14px' : '22px'}; }
    address { font-style: normal; margin: 1mm 0; line-height: 1.25; }
    p { margin: ${compact ? '.7mm' : '2mm'} 0; }
    h3 { font-size: inherit; margin: 2mm 0 1mm; break-after: avoid; }
    dl {
      display: grid;
      grid-template-columns: ${compact ? '17mm minmax(0, 1fr)' : 'auto minmax(0, 1fr)'};
      gap: .7mm 1.5mm;
      margin: 2mm 0;
    }
    dt, dd { margin: 0; min-width: 0; }
    dd { text-align: right; }
    [data-bill-items] {
      border-top: 1px dashed #000;
      border-bottom: 1px dashed #000;
      margin: 2mm 0;
      padding: 1mm 0;
    }
    [data-bill-items] > div {
      display: flex;
      justify-content: space-between;
      gap: 2mm;
      padding: 1mm 0;
      break-inside: avoid;
    }
    [data-bill-items] > div > div { min-width: 0; }
    [data-bill-items] > div > b { flex: none; white-space: nowrap; }
    small {
      display: block;
      font-size: ${paper === '58mm' ? '9px' : '11px'};
      line-height: 1.2;
      margin: .5mm 0 0;
    }
    small:empty { display: none; }
    .summary-row, .summary-total {
      display: flex;
      justify-content: space-between;
      gap: 2mm;
      margin: 1mm 0;
      break-inside: avoid;
    }
    .summary-row > span, .summary-total > span { min-width: 0; }
    .summary-row > b { flex: none; text-align: right; white-space: nowrap; }
    .summary-total {
      border-top: 1px dashed #000;
      padding-top: 1.5mm;
      font-size: ${compact ? '12px' : '18px'};
      font-weight: bold;
    }
    .summary-total > strong { flex: none; white-space: nowrap; }
    [data-bill-notice] {
      font-size: ${compact ? '8px' : '11px'};
      line-height: 1.2;
      margin-top: 1.5mm;
    }
    [data-bill-status] { font-weight: bold; border-top: 1px dashed #000; padding-top: 1mm; }
    [data-bill-refund] { border-top: 1px dashed #000; margin-top: 2mm; padding-top: 1mm; }
    ${compact ? '[data-bill-compact-tax="v2"] { display: none; }' : ''}
    @page { size: ${compact ? `${width} 297mm` : 'A4'}; margin: 0; }
  `;
}

/** Print an isolated bill document so dashboard layout cannot create blank receipt pages. */
export function printBill(element: HTMLElement, paper: BillPaper): Promise<void> {
  const parentDocument = element.ownerDocument;
  const view = parentDocument.defaultView;
  if (!view) return Promise.reject(new Error('The print preview could not open.'));
  const parentWindow: Window = view;
  if (activeFrames.get(parentDocument)?.isConnected)
    return Promise.reject(new Error('Another bill print preview is already open.'));

  const copy = element.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll('[data-bill-controls],button,script,iframe,input,select,style,link')
    .forEach((node) => node.remove());
  const compact = paper !== 'a4';
  const width = compact ? paper : '210mm';
  const frame = parentDocument.createElement('iframe');
  frame.dataset.hpaPrintFrame = 'true';
  frame.title = 'Bill print preview';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${width};height:1px;border:0;`;
  activeFrames.set(parentDocument, frame);

  return new Promise((resolve, reject) => {
    const previousFocus = parentDocument.activeElement as HTMLElement | null;
    let finished = false;
    let loaded = false;
    let printStarted = false;
    let layoutFrame: number | undefined;
    let printWindow: Window | null = null;
    let printMedia: MediaQueryList | undefined;
    let cleanupTimer: number | undefined;
    const loadTimer = parentWindow.setTimeout(
      () => finish(new Error('The print preview took too long to open. Please try again.')),
      PREVIEW_LOAD_TIMEOUT_MS,
    );

    function finish(cause?: unknown) {
      if (finished) return;
      finished = true;
      parentWindow.clearTimeout(loadTimer);
      parentWindow.clearTimeout(cleanupTimer);
      if (layoutFrame !== undefined) parentWindow.cancelAnimationFrame(layoutFrame);
      parentWindow.removeEventListener('focus', onFocus);
      printWindow?.removeEventListener('afterprint', onAfterPrint);
      printWindow?.removeEventListener('focus', onFocus);
      printMedia?.removeEventListener('change', onPrintMediaChange);
      frame.onload = null;
      frame.onerror = null;
      frame.remove();
      if (activeFrames.get(parentDocument) === frame) activeFrames.delete(parentDocument);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      if (cause) reject(cause);
      else resolve();
    }

    function onAfterPrint() {
      finish();
    }

    function onPrintMediaChange(event: MediaQueryListEvent) {
      if (!event.matches) finish();
    }

    function checkCompletion() {
      if (finished || !printStarted) return;
      // A non-blocking print dialog may still be open; never discard its source document.
      if (printMedia?.matches) {
        cleanupTimer = parentWindow.setTimeout(checkCompletion, PRINT_CLEANUP_TIMEOUT_MS);
        return;
      }
      finish();
    }

    function onFocus() {
      // Some browsers omit afterprint on cancellation but return focus to the page.
      parentWindow.setTimeout(checkCompletion, 0);
    }

    frame.onerror = () => finish(new Error('The print preview could not load.'));
    frame.onload = async () => {
      if (loaded || finished) return;
      loaded = true;
      try {
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        if (!doc || !win) throw new Error('The print preview could not open.');
        await doc.fonts.ready;
        if (finished) return;
        if (compact) {
          // Thermal sheets use a safe printable column (48 mm or 72 mm). Measure the content,
          // then add 2 mm feed tolerance instead of feeding a fixed A4-length receipt.
          const measuredHeight = Math.ceil((doc.body.scrollHeight * 25.4) / 96) + 2;
          if (measuredHeight > MAX_THERMAL_RECEIPT_HEIGHT_MM)
            throw new ReceiptTooLongError(paper as '58mm' | '80mm');
          const height = Math.max(30, measuredHeight);
          const page = doc.createElement('style');
          page.textContent = `@page { size: ${width} ${height}mm; margin: 0; }`;
          doc.head.append(page);
        }
        layoutFrame = parentWindow.requestAnimationFrame(() => {
          if (finished) return;
          try {
            printWindow = win;
            printMedia = win.matchMedia('print');
            win.addEventListener('afterprint', onAfterPrint);
            printMedia.addEventListener('change', onPrintMediaChange);
            win.focus();
            printStarted = true;
            parentWindow.clearTimeout(loadTimer);
            parentWindow.addEventListener('focus', onFocus);
            win.addEventListener('focus', onFocus);
            cleanupTimer = parentWindow.setTimeout(checkCompletion, PRINT_CLEANUP_TIMEOUT_MS);
            win.print();
          } catch (cause) {
            finish(cause);
          }
        });
      } catch (cause) {
        finish(cause);
      }
    };
    frame.srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Hot Pizza Ace bill</title><style>${printStyles(paper)}</style></head><body>${copy.outerHTML}</body></html>`;
    try {
      parentDocument.body.append(frame);
    } catch (cause) {
      finish(cause);
    }
  });
}
