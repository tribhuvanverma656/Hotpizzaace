'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  ChefHat,
  CircleAlert,
  Clock3,
  ReceiptText,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { LocalPosAccountMenu } from './account-menu';
import { LocalPosRoleTabs } from './role-tabs';
import { money } from '@/lib/utils';
import type { Order } from '@/types';
import type { LocalRole, LocalUser } from '@/lib/local-pos/database';
import { LocalPosSidebar } from './sidebar';
import styles from './dashboard.module.css';

type DashboardOrder = Order & {
  localPos: {
    businessDate: string;
    paidAmount: number;
    payments: { id: string; method: 'cash' | 'upi'; amount: number }[];
  };
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'The local POS request failed.');
  return result;
}

export function LocalDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<LocalUser | null>(null);
  const [orders, setOrders] = useState<DashboardOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [switchingRole, setSwitchingRole] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const session = await getJson<{ user: LocalUser | null }>('/api/local-pos/session');
      if (!session.user || !['super_user', 'pos_manager', 'kitchen'].includes(session.user.role)) {
        setUser(null);
        setOrders([]);
        return;
      }
      setUser(session.user);
      const result = await getJson<{ orders: DashboardOrder[] }>('/api/local-pos/orders');
      if (!Array.isArray(result.orders)) throw new Error('The local POS returned an invalid order list.');
      setOrders(result.orders);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The dashboard could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  async function switchRole(role: LocalRole) {
    if (role === user?.role || switchingRole) return;
    setSwitchingRole(true);
    setError('');
    try {
      const response = await fetch('/api/local-pos/logout', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error ?? 'Could not change account role.');
      }
      router.push(`/local-pos?role=${role}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change account role.');
      setSwitchingRole(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!user) return;
    const interval = window.setInterval(() => {
      void getJson<{ orders: DashboardOrder[] }>('/api/local-pos/orders')
        .then((result) => setOrders(result.orders))
        .catch((cause) =>
          setError(cause instanceof Error ? cause.message : 'Orders could not be refreshed.'),
        );
    }, 5000);
    return () => window.clearInterval(interval);
  }, [user]);

  const readyOrders = useMemo(
    () => orders.filter((order) => order.status === 'ready'),
    [orders],
  );
  const preparingOrders = useMemo(
    () => orders.filter((order) => ['confirmed', 'preparing'].includes(order.status)),
    [orders],
  );
  const billedTotal = useMemo(
    () =>
      orders
        .filter((order) => !['cancelled', 'rejected'].includes(order.status))
        .reduce((sum, order) => sum + order.total, 0),
    [orders],
  );
  const collectedTotal = useMemo(
    () =>
      orders.reduce(
        (sum, order) => sum + order.localPos.paidAmount,
        0,
      ),
    [orders],
  );

  if (loading && !user)
    return <main className={styles.statePage}><div className={styles.spinner} />Loading dashboard…</main>;
  if (!user)
    return (
      <main className={styles.statePage}>
        <h1>POS sign-in required</h1>
        <p>Sign in to view the local restaurant dashboard.</p>
        <Link href="/local-pos">Go to POS sign in</Link>
      </main>
    );

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Link href="/local-pos/dashboard" aria-label="Local POS dashboard">
            <Image src="/brand/hot-pizza-ace.gif" alt="" width={1806} height={1440} unoptimized />
          </Link>
          <div><strong>HOT PIZZA ACE</strong><span>LOCAL POS · BARRA</span></div>
        </div>
        <div className={styles.topActions}>
          <span className={styles.connection}><i /> Local database</span>
          <LocalPosRoleTabs
            currentRole={user.role}
            onSelect={(role) => void switchRole(role)}
            disabled={switchingRole}
          />
          <LocalPosAccountMenu user={user} />
          {user.role === 'super_user' && <Link href="/local-pos/analytics">Insights</Link>}
          <Link href="/local-pos">Team access</Link>
        </div>
      </header>
      <div className={styles.layout}>
        <LocalPosSidebar role={user.role} active="dashboard" />
        <section className={styles.content}>
          <div className={styles.heading}>
            <div>
              <p>RESTAURANT OPERATIONS</p>
              <h1>Dashboard</h1>
              <span>Today’s activity · business day ends at 3 AM</span>
            </div>
            <button onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          </div>
          {error && <p className={styles.error} role="alert"><CircleAlert size={16} />{error}</p>}
          <section className={styles.metrics} aria-label="Today's order summary">
            <Metric icon={<ReceiptText size={18} />} label="Orders today" value={String(orders.length)} />
            <Metric icon={<ChefHat size={18} />} label="In kitchen" value={String(preparingOrders.length)} />
            <Metric icon={<Clock3 size={18} />} label="Ready to serve" value={String(readyOrders.length)} />
            {user.role === 'super_user' && (
              <>
                <Metric icon={<TrendingUp size={18} />} label="Billed today" value={money(billedTotal)} />
                <Metric icon={<BarChart3 size={18} />} label="Collected today" value={money(collectedTotal)} />
              </>
            )}
          </section>
          <div className={styles.columns}>
            <section className={styles.panel}>
              <div className={styles.panelHeading}>
                <div><h2>Recent orders</h2><p>Updates automatically</p></div>
                <Link href={
                  user.role === 'kitchen'
                    ? '/local-pos/kitchen'
                    : user.role === 'pos_manager' || user.role === 'super_user'
                    ? '/local-pos/orders'
                    : '/local-pos/register'
                }>
                  View orders <ArrowRight size={14} />
                </Link>
              </div>
              <div className={styles.orders}>
                {orders.slice(0, 8).map((order) => (
                  <div className={styles.orderRow} key={order.id}>
                    <div className={styles.orderIdentity}>
                      <strong>{order.number}</strong>
                      <span>{order.counter?.tableLabel || order.customer.name}</span>
                    </div>
                    <span className={`${styles.status} ${order.status === 'ready' ? styles.statusReady : ''}`}>
                      {order.status}
                    </span>
                    {user.role === 'super_user' && <b>{money(order.total)}</b>}
                  </div>
                ))}
                {!orders.length && !loading && <p className={styles.empty}>New orders will appear here.</p>}
              </div>
            </section>
            <section className={styles.shortcuts}>
              <div className={styles.panelHeading}><div><h2>Quick access</h2><p>Switch between workspaces</p></div></div>
              {user.role !== 'kitchen' && (
                <Link href="/local-pos/register">
                  <ReceiptText size={18} /><span><b>Open POS register</b><small>Create bills and manage orders</small></span><ArrowRight size={15} />
                </Link>
              )}
              {user.role !== 'kitchen' && (
                <Link href="/local-pos/menu">
                  <ChefHat size={18} /><span><b>Menu &amp; products</b><small>Update prices, options and availability</small></span><ArrowRight size={15} />
                </Link>
              )}
              {user.role !== 'kitchen' && (
                <Link href="/local-pos/register">
                  <ReceiptText size={18} /><span><b>Order history</b><small>Browse past bills by business date</small></span><ArrowRight size={15} />
                </Link>
              )}
              <Link href={user.role === 'kitchen' ? '/local-pos/kitchen' : '/local-pos/orders'}>
                <ChefHat size={18} /><span><b>{user.role === 'kitchen' ? 'Kitchen display' : 'Order dashboard'}</b><small>{user.role === 'super_user' ? 'View and manage all orders, including preparation status' : 'View live orders and update preparation status'}</small></span><ArrowRight size={15} />
              </Link>
              {user.role === 'super_user' && (
                <Link href="/local-pos/settings">
                  <ReceiptText size={18} /><span><b>Restaurant settings</b><small>Delivery area, charges and GST profile</small></span><ArrowRight size={15} />
                </Link>
              )}
              {user.role === 'super_user' && (
                <Link href="/local-pos/analytics">
                  <BarChart3 size={18} /><span><b>Sales insights</b><small>Sales, payments and best sellers</small></span><ArrowRight size={15} />
                </Link>
              )}
              {user.role !== 'kitchen' && (
                <Link href="/local-pos">
                  <TrendingUp size={18} /><span><b>Team access</b><small>Manage staff accounts</small></span><ArrowRight size={15} />
                </Link>
              )}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <article className={styles.metric}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
