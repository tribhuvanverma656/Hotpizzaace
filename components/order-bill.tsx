'use client';
import { isTestGatewayMode } from '@/lib/payments/method';
import { Fragment, useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import type { Order, OrderTax } from '@/types';
import { money } from '@/lib/utils';
import { hasProcessedRefund } from '@/lib/pricing';
import { publicBusinessIdentity, getPublicBranchRegistration } from '@/lib/business-identity';
import { printBill, ReceiptTooLongError, type BillPaper } from '@/lib/receipt-print';
import styles from './order-bill.module.css';

export function GstBreakup({ tax, detail = false }: { tax?: OrderTax; detail?: boolean }) {
  if (tax?.version === 2) {
    const groups = tax.groups ?? [];
    if (detail)
      return (
        <>
          <div className="summary-row">
            <span>Total taxable value</span>
            <b>{money(tax.taxableValue)}</b>
          </div>
          {groups.map((group) => (
            <Fragment key={`${group.pricing}-${group.rateBps}-${group.code}`}>
              <div className="summary-row">
                <span>
                  HSN / SAC {group.code} · GST {group.rateBps / 100}% ·{' '}
                  {group.pricing === 'inclusive' ? 'included in price' : 'added to price'}
                </span>
                <b>{money(group.taxableValue)} taxable</b>
              </div>
              <div className="summary-row">
                <span>CGST ({group.rateBps / 200}%)</span>
                <b>{money(group.cgst)}</b>
              </div>
              <div className="summary-row">
                <span>SGST ({group.rateBps / 200}%)</span>
                <b>{money(group.sgst)}</b>
              </div>
            </Fragment>
          ))}
          <div className="summary-row">
            <span>Total GST, including tax within MRP</span>
            <b>{money(tax.total)}</b>
          </div>
        </>
      );
    const added = groups.filter((group) => group.pricing === 'exclusive');
    return (
      <>
        <div className="summary-row">
          <span>CGST added</span>
          <b>{money(added.reduce((sum, group) => sum + group.cgst, 0))}</b>
        </div>
        <div className="summary-row">
          <span>SGST added</span>
          <b>{money(added.reduce((sum, group) => sum + group.sgst, 0))}</b>
        </div>
        <div className="summary-row">
          <span>GST included in MRP</span>
          <b>{money(tax.includedTotal ?? 0)}</b>
        </div>
      </>
    );
  }
  return tax ? (
    <>
      <div className="summary-row">
        <span>Taxable value</span>
        <b>{money(tax.taxableValue)}</b>
      </div>
      <div className="summary-row">
        <span>CGST (2.5%)</span>
        <b>{money(tax.cgst)}</b>
      </div>
      <div className="summary-row">
        <span>SGST (2.5%)</span>
        <b>{money(tax.sgst)}</b>
      </div>
    </>
  ) : null;
}

/** All monetary values and registrations come from the immutable order snapshot when present. */
export function OrderBill({ order }: { order: Order }) {
  const bill = useRef<HTMLElement>(null);
  const printInFlight = useRef(false);
  const [paper, setPaper] = useState<BillPaper>('58mm');
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');
  const print = async () => {
    if (!bill.current || printInFlight.current) return;
    printInFlight.current = true;
    setPrinting(true);
    setPrintError('');
    try {
      await printBill(bill.current, paper);
    } catch (cause) {
      setPrintError(
        cause instanceof ReceiptTooLongError
          ? cause.message
          : 'Print preview could not open. Please try again.',
      );
    } finally {
      printInFlight.current = false;
      setPrinting(false);
    }
  };
  const voided = !!order.testVoid;
  const refunded = hasProcessedRefund(order);
  const supplier = order.tax?.supplier;
  const registration = getPublicBranchRegistration(order.branchId ?? '');
  const isTest =
    order.environment === 'development' ||
    order.invoice?.kind === 'test_bill' ||
    order.paymentMode === 'simulation' ||
    isTestGatewayMode(order.paymentMode);
  return (
    <section ref={bill} className={`${styles.bill} hpa-print-bill`} aria-label="Order bill">
      <div className={styles.controls} data-bill-controls>
        <label className={styles.paper}>
          Paper
          <select
            aria-label="Bill paper size"
            value={paper}
            disabled={printing}
            onChange={(event) => setPaper(event.target.value as BillPaper)}
          >
            <option value="58mm">58 mm receipt</option>
            <option value="80mm">80 mm receipt</option>
            <option value="a4">A4 invoice</option>
          </select>
        </label>
        <button
          className="btn btn-outline"
          type="button"
          disabled={printing}
          onClick={() => void print()}
        >
          <Printer size={17} /> {printing ? 'Printing…' : 'Print / save PDF'}
        </button>
        <span className={styles.printHint}>
          {paper === 'a4'
            ? 'Select A4 paper in the print dialog.'
            : `Select ${paper === '80mm' ? '80' : '58'} mm paper in your printer settings. Use 100% scale, no margins, and turn off headers and footers.`}
        </span>
        {printError && (
          <span className={styles.printError} role="alert">
            {printError}
          </span>
        )}
      </div>
      <header className={styles.header}>
        <h2>
          {voided
            ? 'Voided software test'
            : order.invoice?.kind === 'tax_invoice'
              ? 'Tax invoice'
              : isTest
                ? 'Test order bill'
                : 'Order bill'}
        </h2>
        <strong>{supplier?.businessName ?? publicBusinessIdentity.name}</strong>
        <address>
          {supplier?.address ?? order.branchAddress ?? publicBusinessIdentity.address}
        </address>
        <p>
          GSTIN: <b>{supplier?.gstin ?? publicBusinessIdentity.gstin}</b>
        </p>
        {(supplier?.fssaiNumber ?? registration?.fssaiNumber) && (
          <p>
            FSSAI: <b>{supplier?.fssaiNumber ?? registration?.fssaiNumber}</b>
          </p>
        )}
        {supplier && (
          <p>
            {order.tax?.version !== 2 && <>SAC: {supplier.sac} · </>}
            State: {supplier.stateName} ({supplier.stateCode})
          </p>
        )}
      </header>
      <dl className={styles.references}>
        {order.invoice && (
          <>
            <dt>{isTest ? 'Test bill' : 'Invoice'} number</dt>
            <dd>{order.invoice.number}</dd>
          </>
        )}
        <dt>Order reference</dt>
        <dd>{order.number}</dd>
        <dt>{order.invoice ? 'Issued' : 'Ordered'}</dt>
        <dd>
          {new Date(order.invoice?.issuedAt ?? order.createdAt).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
          })}{' '}
          IST
        </dd>
        <dt>Customer</dt>
        <dd>{order.customer.name}</dd>
        {order.counter?.tableLabel && (
          <>
            <dt>Table / reference</dt>
            <dd>{order.counter.tableLabel}</dd>
          </>
        )}
        <dt>Fulfillment</dt>
        <dd>
          {order.fulfillment === 'dine_in'
            ? 'Dine-in / counter'
            : order.fulfillment === 'pickup'
              ? 'Pickup'
              : 'Delivery'}
        </dd>
      </dl>
      {order.fulfillment === 'delivery' && (
        <p>
          {order.customer.address}, {order.customer.locality}, {order.customer.postalCode}
          {order.customer.landmark ? ` · Landmark: ${order.customer.landmark}` : ''}
          {supplier ? ` · ${supplier.stateName} (${supplier.stateCode})` : ''}
        </p>
      )}
      {order.fulfillment === 'delivery' && order.customer.phone && (
        <p>Delivery mobile: {order.customer.phone}</p>
      )}
      <div className={styles.items} data-bill-items>
        {order.items.map((item) => (
          <div key={item.id}>
            <div>
              <strong>
                {item.quantity} × {item.name}
              </strong>
              <small>{item.options.join(' · ')}</small>
              <small>{money(item.unitPrice)} each</small>
              {item.gstInclusive && (
                <small>
                  MRP / GST included · {item.gstInclusive.rateBps / 100}% GST · HSN / SAC{' '}
                  {item.gstInclusive.code}
                </small>
              )}
            </div>
            <b>{money(item.unitPrice * item.quantity)}</b>
          </div>
        ))}
      </div>
      <div className="summary-row">
        <span>Items subtotal</span>
        <b>{money(order.subtotal)}</b>
      </div>
      {order.fulfillment === 'delivery' && (
        <div className="summary-row">
          <span>Delivery charge</span>
          <b>{money(order.deliveryFee)}</b>
        </div>
      )}
      {order.discount > 0 && (
        <div className="summary-row">
          <span>Discount {order.coupon}</span>
          <b>−{money(order.discount)}</b>
        </div>
      )}
      <div data-bill-compact-tax={order.tax?.version === 2 ? 'v2' : undefined}>
        <GstBreakup tax={order.tax} />
      </div>
      {order.roundOff !== undefined && (
        <div className="summary-row">
          <span>Round off</span>
          <b>{`${order.roundOff > 0 ? '+' : ''}${money(order.roundOff)}`}</b>
        </div>
      )}
      <div className="summary-total">
        <span>
          {refunded || order.refundSyncPending ? 'Original bill total' : 'Total'}{' '}
          {order.tax ? 'including GST' : ''}
        </span>
        <strong>{money(order.total)}</strong>
      </div>
      {order.tax?.version === 2 && (
        <div aria-label="Invoice tax breakdown">
          <p className={styles.notice} data-bill-notice>
            <strong>Tax breakdown</strong> · GST within MRP appears in this breakdown and is not an
            additional charge.
          </p>
          <GstBreakup tax={order.tax} detail />
        </div>
      )}
      <p className={styles.status} data-bill-status>
        Payment:{' '}
        {voided
          ? 'No money received — software test removed'
          : order.refundSyncPending
            ? `Refund needs reconciliation${isTest ? ' · test payment' : ''}`
            : refunded
              ? `${order.refund!.status === 'full' ? 'Refunded' : 'Partial refund'}${isTest ? ' · test payment' : ''}`
              : order.paymentMode === 'counter_manual'
                ? order.paymentStatus === 'paid'
                  ? `${order.settlement?.method === 'upi' ? 'Direct UPI' : 'Cash'} received${isTest ? ' · TEST' : ''}`
                  : 'Unpaid · pay later'
                : order.paymentStatus === 'paid'
                  ? isTest
                    ? 'Captured · test payment'
                    : 'Captured'
                  : order.paymentStatus === 'simulated_paid'
                    ? 'Simulated · no real payment'
                    : order.paymentStatus.replaceAll('_', ' ')}
      </p>
      {!voided && order.settlement?.method === 'cash' && (
        <p>
          Cash tendered: {money(order.settlement.cashTendered ?? 0)} · Change:{' '}
          {money(order.settlement.change ?? 0)}
        </p>
      )}
      {!voided && order.settlement?.method === 'upi' && order.settlement.upiReference && (
        <p>UPI reference: {order.settlement.upiReference}</p>
      )}
      {order.paymentReviewRequired && !refunded && !order.refundSyncPending && (
        <p>
          Payment requires restaurant review. This receipt does not confirm fulfillment or a refund.
        </p>
      )}
      <p className={styles.notice} data-bill-notice>
        {voided
          ? 'VOIDED — No payment was received. Original invoice details are retained for audit; this record is excluded from orders and sales reports.'
          : isTest
            ? 'TEST DOCUMENT — Development record. No real payment or food order. Not a tax invoice.'
            : !order.invoice
              ? 'Provisional order bill. The tax invoice is issued when the restaurant marks this order ready.'
              : 'Original for recipient · Electronically generated.'}
      </p>
      {!order.tax && (
        <p className={styles.notice} data-bill-notice>
          This older order has no recorded GST breakup. Its original total has been preserved.
        </p>
      )}
      {(refunded || order.refundSyncPending) && !voided && (
        <section aria-label="Payment refund record" data-bill-refund>
          <h3>{isTest ? 'Test payment refund record' : 'Payment refund record'}</h3>
          <p>
            Original bill: {order.invoice?.number ?? order.number}. Its items, GST and total are
            unchanged. This refund record is separate from the original bill and is not a tax credit
            note.
          </p>
          {order.refundSyncPending && (
            <p>
              Refund details need reconciliation. The final refund balance is not confirmed yet.
            </p>
          )}
          {refunded && (
            <div className="summary-row">
              <span>{order.refundSyncPending ? 'Confirmed processed refunds' : 'Refunded'}</span>
              <b>{money(order.refund!.amount)}</b>
            </div>
          )}
          <div className="summary-row">
            <span>Net payment retained</span>
            <b>
              {order.refundSyncPending
                ? 'Awaiting reconciliation'
                : money(Math.max(0, order.total - order.refund!.amount))}
            </b>
          </div>
          {order.refund?.entries.map((entry) => (
            <p key={entry.id}>
              <strong>{entry.id}</strong> · {money(entry.amount)} ·{' '}
              {entry.timestampSource === 'provider_event' ? 'Processed' : 'Verified'}{' '}
              {new Date(entry.processedAt).toLocaleString('en-IN', {
                timeZone: 'Asia/Kolkata',
              })}{' '}
              IST
            </p>
          ))}
        </section>
      )}
    </section>
  );
}
