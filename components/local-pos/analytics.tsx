'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Banknote, CalendarDays, ChartNoAxesCombined, CircleAlert, CreditCard, ReceiptText, RefreshCw, TrendingUp } from 'lucide-react';
import { money } from '@/lib/utils';
import { LocalPosSidebar } from '@/components/local-pos/sidebar';
import styles from './analytics.module.css';

type Summary = {
  from: string;
  to: string;
  orderCount: number;
  activeOrderCount: number;
  cancelledOrderCount: number;
  sales: number;
  collected: number;
  outstanding: number;
  averageBill: number;
  paymentTotals: { cash: number; upi: number };
  daily: { date: string; orders: number; sales: number; collected: number }[];
  bestSellers: { productId: string; name: string; quantity: number; sales: number }[];
};

async function loadSummary(from: string, to: string): Promise<Summary> {
  const response = await fetch(
    `/api/local-pos/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { credentials: 'same-origin', cache: 'no-store' },
  );
  const result = (await response.json()) as Summary & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'Sales analytics could not be loaded.');
  if (!Array.isArray(result.daily) || !Array.isArray(result.bestSellers))
    throw new Error('The local POS returned invalid analytics.');
  return result;
}

function localDate(daysAgo = 0): string {
  const date = new Date(Date.now() + 330 * 60_000 - 180 * 60_000);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export function LocalAnalytics() {
  const [from, setFrom] = useState(() => localDate(29));
  const [to, setTo] = useState(() => localDate());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSummary(await loadSummary(from, to));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sales analytics could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const maxSales = useMemo(
    () => Math.max(1, ...(summary?.daily.map((day) => day.sales) ?? [])),
    [summary],
  );

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Link href="/local-pos/register" aria-label="Back to register"><Image src="/brand/hot-pizza-ace.gif" alt="" width={1806} height={1440} unoptimized /></Link>
          <div><strong>HOT PIZZA ACE</strong><span>SUPER USER · SALES INSIGHTS</span></div>
        </div>
        <Link className={styles.back} href="/local-pos/dashboard"><ArrowLeft size={16} /> Dashboard</Link>
      </header>
      <div className={styles.workspace}>
        <LocalPosSidebar role="super_user" active="analytics" />
        <div className={styles.analyticsMain}>
          <section className={styles.content}>
        <div className={styles.heading}>
          <div>
            <p>OWNER REPORTING</p>
            <h1>Sales insights</h1>
            <span>Order totals follow the 3 AM business-day cutoff. Only the Super User can view this report.</span>
          </div>
          <div className={styles.filters}>
            <label>From <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>To <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
            <button onClick={() => void reload()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          </div>
        </div>
        {error && <p className={styles.error} role="alert"><CircleAlert size={16} />{error}</p>}
        <section className={styles.metrics} aria-label="Sales totals">
          <Metric icon={<TrendingUp size={18} />} label="Billed sales" value={money(summary?.sales ?? 0)} />
          <Metric icon={<ReceiptText size={18} />} label="Orders" value={String(summary?.activeOrderCount ?? 0)} detail={`${summary?.cancelledOrderCount ?? 0} cancelled`} />
          <Metric icon={<Banknote size={18} />} label="Collected" value={money(summary?.collected ?? 0)} detail={`${money(summary?.outstanding ?? 0)} outstanding`} />
          <Metric icon={<ChartNoAxesCombined size={18} />} label="Average bill" value={money(summary?.averageBill ?? 0)} />
        </section>
        <div className={styles.reportGrid}>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>Sales by business day</h2><p>Final order total, INR</p></div><CalendarDays size={18} /></div>
            {loading ? <p className={styles.empty}>Loading report…</p> : summary?.daily.length ? (
              <div className={styles.chart}>
                {summary.daily.map((day) => (
                  <div className={styles.chartRow} key={day.date}>
                    <time>{new Date(`${day.date}T12:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</time>
                    <div className={styles.track}><span style={{ width: `${Math.max(3, (day.sales / maxSales) * 100)}%` }} /></div>
                    <strong>{money(day.sales)}</strong>
                  </div>
                ))}
              </div>
            ) : <p className={styles.empty}>No orders found for this period.</p>}
          </section>
          <section className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>Payment mix</h2><p>Recorded payments received</p></div><CreditCard size={18} /></div>
            <div className={styles.paymentRows}>
              <div><span><i className={styles.cashDot} /> Cash</span><strong>{money(summary?.paymentTotals.cash ?? 0)}</strong></div>
              <div><span><i className={styles.upiDot} /> External UPI</span><strong>{money(summary?.paymentTotals.upi ?? 0)}</strong></div>
              <div className={styles.paymentTotal}><span>Total collected</span><strong>{money(summary?.collected ?? 0)}</strong></div>
            </div>
          </section>
          <section className={`${styles.panel} ${styles.bestSellers}`}>
            <div className={styles.panelHeading}><div><h2>Best sellers</h2><p>Ranked by quantity sold</p></div><TrendingUp size={18} /></div>
            {summary?.bestSellers.length ? (
              <div className={styles.tableWrap}>
                <table>
                  <thead><tr><th>Item</th><th>Qty</th><th>Item sales</th></tr></thead>
                  <tbody>{summary.bestSellers.map((item, index) => (
                    <tr key={item.productId}>
                      <td><span className={styles.rank}>{index + 1}</span>{item.name}</td>
                      <td>{item.quantity}</td>
                      <td>{money(item.sales)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <p className={styles.empty}>Best sellers will appear when orders are placed.</p>}
          </section>
        </div>
        {error && <button className={styles.retry} onClick={() => void reload()}>Retry report</button>}
          </section>
          <footer className={styles.footer}>Private local report · stored on this POS computer</footer>
        </div>
      </div>
    </main>
  );
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) {
  return (
    <article className={styles.metric}>
      <div className={styles.metricIcon}>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}
