'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, RefreshCw, IndianRupee, ShoppingBag, Wallet, CircleAlert } from 'lucide-react';
import { useAdminStore } from './use-admin-store';
import { useCustomerAuth } from '../customer-auth-provider';
import { commerceRequest } from '@/lib/commerce/client';
import { money } from '@/lib/utils';
import {
  buildSalesReport,
  istDate,
  parseReportRequest,
  salesCsv,
  salesExportFilename,
  toSalesExportRow,
  type SalesExportResponse,
  type SalesExportRow,
  type SalesReport,
  type SalesSummaryResponse,
} from '@/lib/analytics';
import styles from './analytics.module.css';

function initialRange() {
  const to = istDate(new Date());
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}
const channelNames = {
  dine_in: 'Dine-in / counter',
  delivery: 'Website delivery',
  pickup: 'Website pickup',
} as const;
const errorMessage = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'The sales report could not be read. Please try again.';

function validateSummary(
  result: SalesSummaryResponse,
  branchId: string,
  from: string,
  to: string,
): SalesReport {
  const report = result.summary;
  if (
    result.complete !== true ||
    !report ||
    report.branchId !== branchId ||
    report.from !== from ||
    report.to !== to ||
    !report.totals ||
    !report.channels ||
    !Array.isArray(report.days) ||
    !report.collections ||
    !report.gatewayCohort ||
    report.gatewayCohort.scope !== 'orders_placed_in_range' ||
    !report.gatewayRefunds ||
    report.gatewayRefunds.dateBasis !== 'refund_entry_processed_at' ||
    [
      report.gatewayCohort.grossCaptured,
      report.gatewayCohort.refunded,
      report.gatewayCohort.orders,
      report.gatewayCohort.unreconciledOrders,
      report.gatewayRefunds.amount,
      report.gatewayRefunds.entries,
      report.gatewayRefunds.orders,
      report.gatewayRefunds.verifiedAtAmount,
      ...report.days.map((day) => day.refunds),
    ].some((value) => !Number.isSafeInteger(value) || value < 0) ||
    report.gatewayCohort.refunded > report.gatewayCohort.grossCaptured ||
    report.gatewayCohort.unreconciledOrders > report.gatewayCohort.orders ||
    (report.gatewayCohort.unreconciledOrders > 0
      ? report.gatewayCohort.netRetained !== null
      : report.gatewayCohort.netRetained === null ||
        !Number.isSafeInteger(report.gatewayCohort.netRetained) ||
        report.gatewayCohort.netRetained < 0 ||
        report.gatewayCohort.grossCaptured - report.gatewayCohort.refunded !==
          report.gatewayCohort.netRetained) ||
    report.gatewayRefunds.verifiedAtAmount > report.gatewayRefunds.amount ||
    !Number.isFinite(Date.parse(result.snapshotAt))
  )
    throw new Error('The report is incomplete. Please reload before using these figures.');
  return report;
}

export function SalesAnalytics() {
  const { shared, orders, adminBranchId, branches } = useAdminStore();
  const auth = useCustomerAuth();
  const [selection, setSelection] = useState(initialRange);
  const [range, setRange] = useState(initialRange);
  const [refresh, setRefresh] = useState(0);
  const [state, setState] = useState<{
    key: string;
    report: SalesReport;
    snapshotAt: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const requestKey = `${auth.user?.id ?? 'demo'}:${adminBranchId}:${range.from}:${range.to}:${shared.mode ?? 'unknown'}:${shared.enabled ? String(shared.admin) : 'demo'}`;
  const identity = useRef(requestKey);
  const exportingRef = useRef(false);
  useLayoutEffect(() => {
    identity.current = requestKey;
  }, [requestKey]);
  const branchName =
    branches.find((branch) => branch.id === adminBranchId)?.name ?? 'Selected branch';
  const demoOrders = useRef(orders);
  useLayoutEffect(() => {
    demoOrders.current = orders;
  }, [orders]);
  const report = state?.key === requestKey ? state.report : null;
  const unappliedDates = selection.from !== range.from || selection.to !== range.to;
  useEffect(
    () => () => {
      identity.current = 'unmounted';
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    const key = requestKey;
    let active = true;
    setLoading(true);
    setError(null);
    setExportStatus('');
    const request = {
      branchId: adminBranchId,
      from: range.from,
      to: range.to,
      kind: 'summary' as const,
    };
    async function load() {
      try {
        parseReportRequest(request);
        if (shared.enabled && (!shared.admin || shared.adminLoading)) return;
        const result: SalesSummaryResponse = shared.enabled
          ? await commerceRequest<SalesSummaryResponse>('admin/reports', {
              method: 'POST',
              body: request,
              signal: controller.signal,
            })
          : {
              summary: buildSalesReport(demoOrders.current, {
                ...range,
                branchId: adminBranchId,
                mode: 'development',
              }),
              complete: true,
              snapshotAt: new Date().toISOString(),
            };
        const summary = validateSummary(result, adminBranchId, range.from, range.to);
        if (active && identity.current === key)
          setState({ key, report: summary, snapshotAt: result.snapshotAt });
      } catch (cause) {
        if (active && identity.current === key && !controller.signal.aborted) {
          setState(null);
          setError(errorMessage(cause));
        }
      } finally {
        if (active && identity.current === key) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    requestKey,
    adminBranchId,
    range,
    refresh,
    shared.enabled,
    shared.admin,
    shared.adminLoading,
  ]);

  async function download() {
    if (exportingRef.current || !report) return;
    const key = requestKey;
    exportingRef.current = true;
    setExporting(true);
    setExportStatus('Preparing your CSV…');
    try {
      const rows: SalesExportRow[] = [];
      if (!shared.enabled) {
        for (const order of demoOrders.current) {
          const row = toSalesExportRow(order, 'development', range);
          if (
            row.branchId === adminBranchId &&
            (row.placedInRange || row.completedInRange || row.collectionInRange)
          )
            rows.push(row);
        }
      } else {
        let cursor: string | undefined;
        let snapshotAt: string | undefined;
        const cursors = new Set<string>();
        for (let page = 0; ; page++) {
          if (page >= 200)
            throw new Error('This export is too large. Download a shorter date range.');
          const result = await commerceRequest<SalesExportResponse>('admin/reports', {
            method: 'POST',
            body: {
              branchId: adminBranchId,
              ...range,
              kind: 'export',
              ...(cursor ? { cursor } : {}),
              ...(snapshotAt ? { snapshotAt } : {}),
            },
          });
          if (identity.current !== key) return;
          if (
            !Array.isArray(result.rows) ||
            typeof result.complete !== 'boolean' ||
            (result.nextCursor !== null && typeof result.nextCursor !== 'string') ||
            !Number.isFinite(Date.parse(result.snapshotAt))
          )
            throw new Error('The download is incomplete. Please start a new export.');
          if (snapshotAt && result.snapshotAt !== snapshotAt)
            throw new Error('The report changed while downloading. Please start a new export.');
          snapshotAt = result.snapshotAt;
          if (result.rows.some((row) => row.branchId !== adminBranchId))
            throw new Error('The export contains a different branch. Please contact the owner.');
          rows.push(...result.rows);
          if (rows.length > 100_000)
            throw new Error('This export is too large. Download a shorter date range.');
          setExportStatus(`Preparing ${rows.length} records…`);
          if (!result.nextCursor) {
            if (!result.complete)
              throw new Error(
                'Some records are missing. No file was downloaded; choose a shorter date range.',
              );
            break;
          }
          if (result.complete || cursors.has(result.nextCursor))
            throw new Error('The download page is invalid. Please start a new export.');
          cursors.add(result.nextCursor);
          cursor = result.nextCursor;
        }
      }
      if (identity.current !== key) return;
      const url = URL.createObjectURL(
        new Blob([salesCsv(rows)], { type: 'text/csv;charset=utf-8;' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = salesExportFilename(adminBranchId, range.from, range.to);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus(`Downloaded ${rows.length} records. Your database records were kept.`);
    } catch (cause) {
      if (identity.current === key) setExportStatus(errorMessage(cause));
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="sales-report-title">
      <div className={styles.heading}>
        <div>
          <p className="eyebrow">BRANCH SALES & COLLECTIONS</p>
          <h2 id="sales-report-title">Know how your restaurant is doing.</h2>
          <p>{branchName} · All dates use India Standard Time.</p>
        </div>
        <button
          type="button"
          className="btn btn-outline"
          disabled={loading || exporting}
          onClick={() => setRefresh((value) => value + 1)}
          aria-label="Refresh sales report"
        >
          <RefreshCw size={17} /> Refresh
        </button>
      </div>
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          try {
            parseReportRequest({ ...selection, branchId: adminBranchId, kind: 'summary' });
            setRange({ ...selection });
          } catch (cause) {
            setError(errorMessage(cause));
          }
        }}
      >
        <label>
          From
          <input
            type="date"
            required
            value={selection.from}
            onChange={(event) =>
              setSelection((current) => ({ ...current, from: event.target.value }))
            }
          />
        </label>
        <label>
          To
          <input
            type="date"
            required
            value={selection.to}
            min={selection.from}
            onChange={(event) =>
              setSelection((current) => ({ ...current, to: event.target.value }))
            }
          />
        </label>
        <button className="btn btn-dark" disabled={loading || exporting}>
          View report
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={loading || exporting}
          onClick={() => {
            const today = istDate(new Date());
            setSelection({ from: today, to: today });
            setRange({ from: today, to: today });
          }}
        >
          Today
        </button>
        <button
          type="button"
          className={`btn btn-primary ${styles.download}`}
          disabled={!report || loading || exporting || unappliedDates}
          onClick={() => void download()}
        >
          <Download size={17} />
          {exporting ? 'Preparing CSV…' : 'Download sales CSV'}
        </button>
      </form>
      <p className={styles.copyNote}>
        Download saves a copy. It never deletes orders, bills or payments from your database. Export
        up to 31 days at a time.
      </p>
      {unappliedDates && (
        <p className={styles.copyNote}>
          Select “View report” to apply these dates before downloading.
        </p>
      )}
      {exportStatus && (
        <p className={styles.exportStatus} role="status">
          {exportStatus}
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          <CircleAlert size={18} />
          {error}
        </p>
      )}
      {loading && (
        <p className={styles.loading} role="status">
          Loading the complete date range…
        </p>
      )}
      {!loading && report && (
        <>
          <p className={styles.snapshot}>
            Report period: {report.from} to {report.to} · {branchName}
          </p>
          {report.mode === 'development' && (
            <p className={styles.testNotice}>
              TEST REPORT · These figures do not represent real collections.
            </p>
          )}
          <div className={styles.metrics}>
            {[
              {
                label: 'Sales excluding GST',
                value: money(report.totals.salesExGst),
                note: `${report.totals.completedOrders} paid and fulfilled orders`,
                Icon: IndianRupee,
              },
              {
                label: 'Orders placed',
                value: String(report.totals.placedOrders),
                note: 'All order states in the selected dates',
                Icon: ShoppingBag,
              },
              {
                label: 'Counter collections',
                value: money(report.collections.total),
                note: 'By the time staff confirmed receipt',
                Icon: Wallet,
              },
              {
                label: 'Unpaid dine-in bills',
                value: money(report.totals.unpaidCounterAmount),
                note: `${report.totals.unpaidCounterOrders} open bills from these dates`,
                Icon: CircleAlert,
              },
            ].map(({ label, value, note, Icon }) => (
              <div className={styles.metric} key={label}>
                <span>
                  <Icon size={18} />
                  {label}
                </span>
                <strong>{value}</strong>
                <small>{note}</small>
              </div>
            ))}
          </div>
          <div className={styles.channels}>
            {(Object.keys(channelNames) as Array<keyof typeof channelNames>).map((channel) => {
              const data = report.channels[channel];
              return (
                <article className={styles.channel} key={channel}>
                  <h3>{channelNames[channel]}</h3>
                  <strong>{money(data.salesExGst)}</strong>
                  <p>
                    {data.completedOrders} paid, fulfilled · {data.placedOrders} placed
                  </p>
                  <dl>
                    <div>
                      <dt>Food sales after discount</dt>
                      <dd>{money(data.foodSales)}</dd>
                    </div>
                    <div>
                      <dt>Delivery fees</dt>
                      <dd>{money(data.deliveryFees)}</dd>
                    </div>
                    <div>
                      <dt>CGST + SGST</dt>
                      <dd>{money(data.cgst + data.sgst)}</dd>
                    </div>
                    <div>
                      <dt>Average sale, excluding GST</dt>
                      <dd>{money(data.averageOrderValue)}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
          {report.legacyPlacedSales.completedOrders > 0 && (
            <p className={styles.review}>
              Legacy receipts: {report.legacyPlacedSales.completedOrders} paid, fulfilled orders
              placed in these dates have no completion timestamp (
              {money(report.legacyPlacedSales.salesExGst)} excluding GST). They are shown separately
              and are not included in date-based sales above.
            </p>
          )}
          <div className={styles.details}>
            <div className={styles.breakdown}>
              <h3>Sales breakdown</h3>
              <dl>
                <div>
                  <dt>Food subtotal</dt>
                  <dd>{money(report.totals.foodSubtotal)}</dd>
                </div>
                <div>
                  <dt>Discounts</dt>
                  <dd>−{money(report.totals.discounts)}</dd>
                </div>
                <div>
                  <dt>Delivery fees</dt>
                  <dd>{money(report.totals.deliveryFees)}</dd>
                </div>
                <div>
                  <dt>Sales excluding GST</dt>
                  <dd>{money(report.totals.salesExGst)}</dd>
                </div>
                <div>
                  <dt>CGST</dt>
                  <dd>{money(report.totals.cgst)}</dd>
                </div>
                <div>
                  <dt>SGST</dt>
                  <dd>{money(report.totals.sgst)}</dd>
                </div>
                <div>
                  <dt>Round off (included in sales)</dt>
                  <dd>{money(report.totals.roundOff ?? 0)}</dd>
                </div>
                <div className={styles.total}>
                  <dt>Sales including GST</dt>
                  <dd>{money(report.totals.salesInclGst)}</dd>
                </div>
              </dl>
            </div>
            <div className={styles.breakdown}>
              <h3>Counter payment receipts</h3>
              <dl>
                <div>
                  <dt>Cash received</dt>
                  <dd>{money(report.collections.cash)}</dd>
                </div>
                <div>
                  <dt>Direct merchant UPI received</dt>
                  <dd>{money(report.collections.directUpi)}</dd>
                </div>
                <div className={styles.total}>
                  <dt>Total confirmed collections</dt>
                  <dd>{money(report.collections.total)}</dd>
                </div>
              </dl>
              <p>
                Receipt totals include GST and can differ from fulfilled sales. The customer pays
                your existing merchant QR; staff must confirm the actual credit.
              </p>
              {report.collections.reviewOrders > 0 && (
                <p className={styles.review}>
                  {report.collections.reviewOrders} cancelled or review-required receipts (
                  {money(report.collections.reviewAmount)}) need reconciliation and are excluded
                  above.
                </p>
              )}
            </div>
          </div>
          <div className={styles.details}>
            <div className={styles.breakdown}>
              <h3>Razorpay receipt balances</h3>
              <dl>
                <div>
                  <dt>Gross captured</dt>
                  <dd>{money(report.gatewayCohort.grossCaptured)}</dd>
                </div>
                <div>
                  <dt>Known processed refunds</dt>
                  <dd>−{money(report.gatewayCohort.refunded)}</dd>
                </div>
                <div className={styles.total}>
                  <dt>Net retained before gateway fees</dt>
                  <dd>
                    {report.gatewayCohort.netRetained === null
                      ? 'Needs reconciliation'
                      : money(report.gatewayCohort.netRetained)}
                  </dd>
                </div>
              </dl>
              <p>
                Cumulative balances for {report.gatewayCohort.orders} orders placed from{' '}
                {report.from} to {report.to}, as of this report snapshot. These figures include GST.
                They are not payments received or bank settlements during this period; capture dates
                are not recorded in this report.
              </p>
              {report.gatewayCohort.unreconciledOrders > 0 && (
                <p className={styles.review}>
                  {report.gatewayCohort.unreconciledOrders} orders have provider-confirmed refunds
                  whose details still need verification. Net retained is unavailable until they are
                  reconciled; known refund entries remain listed separately.
                </p>
              )}
            </div>
            <div className={styles.breakdown}>
              <h3>Refunds recorded in this period</h3>
              <dl>
                <div className={styles.total}>
                  <dt>Known processed refunds including GST</dt>
                  <dd>{money(report.gatewayRefunds.amount)}</dd>
                </div>
                <div>
                  <dt>Refund entries</dt>
                  <dd>{report.gatewayRefunds.entries}</dd>
                </div>
                <div>
                  <dt>Orders refunded</dt>
                  <dd>{report.gatewayRefunds.orders}</dd>
                </div>
              </dl>
              <p>
                Each processed refund uses its provider event timestamp where available, otherwise
                the time it was verified. Refunds from orders placed on earlier dates are included.
                Original bills and their GST figures are preserved.
              </p>
              {report.gatewayRefunds.verifiedAtAmount > 0 && (
                <p className={styles.review}>
                  {money(report.gatewayRefunds.verifiedAtAmount)} uses the verification time because
                  a provider event timestamp was unavailable.
                </p>
              )}
            </div>
          </div>
          <div className={styles.daily}>
            <h3>Day by day</h3>
            <div className={styles.tableScroll}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date · IST</th>
                    <th scope="col">Paid, fulfilled</th>
                    <th scope="col">Sales excl. GST</th>
                    <th scope="col">Counter receipts</th>
                    <th scope="col">Known processed refunds</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.map((day) => (
                    <tr key={day.date}>
                      <td>{day.date}</td>
                      <td>{day.completedOrders}</td>
                      <td>{money(day.salesExGst)}</td>
                      <td>{money(day.collections)}</td>
                      <td>{money(day.refunds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <details className={styles.definition}>
            <summary>How these figures are calculated</summary>
            Sales use the food completion date in the selected range and the latest saved payment
            status. Orders placed and open balances use their placement date. Paid, fulfilled legacy
            receipts without a completion date are disclosed separately. Dine-in must be served or
            closed; delivery must be delivered; pickup must be collected. Cancelled, unpaid and
            refunded and review-required orders contribute no sales. Razorpay gross capture, refunds
            and net retained are disclosed separately and do not revise original invoice values.
            Counter receipts use their actual staff-confirmed payment date. Website payment
            settlement is not a counter collection.{' '}
            {report.undatedOnlinePaidOrders > 0 &&
              `${report.undatedOnlinePaidOrders} paid website orders have no payment receipt timestamp in this report.`}{' '}
            {report.excludedTestOrders > 0 &&
              `${report.excludedTestOrders} orders from the other environment were excluded.`}
          </details>
          <p className={styles.snapshot}>
            Updated{' '}
            {new Date(state!.snapshotAt).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata',
              dateStyle: 'medium',
              timeStyle: 'short',
            })}{' '}
            IST · CSV excludes customer names, addresses and phone numbers.
          </p>
        </>
      )}
    </section>
  );
}
