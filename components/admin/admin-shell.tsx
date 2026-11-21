'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ShoppingBag,
  Pizza,
  Layers3,
  Users,
  Settings2,
  ArrowUpRight,
  LogOut,
  Menu,
  X,
  Flame,
  ShieldCheck,
  Store,
  ChefHat,
  ReceiptText,
  QrCode,
} from 'lucide-react';
import { attachDemoStoreSync, useDemoStore } from '@/lib/store';
import { toast } from 'sonner';
import { useSharedCommerce } from '@/components/shared-commerce-provider';
import { useCustomerAuth } from '@/components/customer-auth-provider';
import { RestaurantLogo } from '@/components/restaurant-logo';
import branchStyles from '@/components/admin/admin-branches.module.css';
import { safeAdminNext } from '@/lib/auth/google';
import { OrderSoundToggle, useOrderChime } from '@/components/order-sound';
import { websiteOrderAlertIds } from '@/lib/order-alerts';
import { QrRequestNotice } from './qr-request-notice';

const links = [
  { href: '/admin/dashboard', label: 'Overview', icon: BarChart3 },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/admin/kitchen', label: 'Kitchen', icon: ChefHat },
  { href: '/admin/counter', label: 'Dine-in / Counter', icon: ReceiptText },
  { href: '/admin/dine-in-qr', label: 'Scan & order QR', icon: QrCode },
  { href: '/admin/products', label: 'Menu & products', icon: Pizza },
  { href: '/admin/categories', label: 'Categories', icon: Layers3 },
  { href: '/admin/customers', label: 'Customers', icon: Users },
  { href: '/admin/branches', label: 'Branches', icon: Store },
  { href: '/admin/settings', label: 'Restaurant settings', icon: Settings2 },
];
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const {
    hydrated,
    adminSession,
    logout,
    persistenceError,
    branches,
    adminBranchId,
    selectAdminBranch,
  } = useDemoStore();
  const shared = useSharedCommerce();
  const auth = useCustomerAuth();
  const workspaceLabel = !shared.enabled
    ? 'Demo workspace'
    : shared.mode === 'production'
      ? 'Production workspace'
      : shared.mode === 'development'
        ? 'Test workspace'
        : 'Connected workspace';
  const [signingOut, setSigningOut] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const acceptLock = useRef(false);
  const pendingIds = websiteOrderAlertIds(shared.adminOrders);
  const pendingOrders = shared.adminOrders.filter(
    (order) => order.branchId === adminBranchId && pendingIds.includes(order.id),
  );
  // Pending website orders ring on every admin page until accepted.
  const initialOrders = useRef(shared.adminOrders);
  const [snapshotLoaded, setSnapshotLoaded] = useState(shared.adminOrders.length > 0);
  useEffect(() => {
    if (shared.adminOrders !== initialOrders.current) setSnapshotLoaded(true);
  }, [shared.adminOrders]);
  const orderChime = useOrderChime(
    shared.enabled && shared.admin && snapshotLoaded
      ? pendingOrders.map((order) => order.id)
      : null,
    true,
  );
  useEffect(() => {
    void useDemoStore.persist.rehydrate();
    return attachDemoStoreSync();
  }, []);
  useEffect(() => {
    if (pathname === '/admin/login') return;
    if (shared.enabled) {
      if (shared.ready && !shared.adminLoading && !shared.admin)
        router.replace(`/admin/login?next=${encodeURIComponent(safeAdminNext(pathname))}`);
    } else if (hydrated && !adminSession)
      router.replace(`/admin/login?next=${encodeURIComponent(safeAdminNext(pathname))}`);
  }, [
    hydrated,
    adminSession,
    pathname,
    router,
    shared.enabled,
    shared.ready,
    shared.adminLoading,
    shared.admin,
  ]);
  if (pathname === '/admin/login') return <main className="admin-login-shell">{children}</main>;
  if (shared.enabled && !shared.ready && shared.error)
    return (
      <main className="admin-loading">
        <ShieldCheck size={32} />
        <h1>Restaurant connection unavailable</h1>
        <p role="alert">{shared.error}</p>
        <button className="btn btn-primary" onClick={() => void shared.refresh()}>
          Retry connection
        </button>
        <Link href="/admin/login" className="admin-back-link">
          Back to sign in
        </Link>
      </main>
    );
  if (!hydrated || (shared.enabled ? !shared.ready || !shared.admin : !adminSession))
    return (
      <main className="admin-loading">
        <Flame size={32} />
        <p>Opening your restaurant workspace…</p>
      </main>
    );
  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${branchStyles.sidebar} ${mobileOpen ? 'mobile-open' : ''}`}>
        <Link href="/admin/dashboard" className="admin-brand restaurant-admin-brand">
          <RestaurantLogo variant="admin" />
          <small>RESTAURANT WORKSPACE</small>
        </Link>
        <button
          className="admin-mobile-close"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        >
          <X />
        </button>
        <label className={branchStyles.selector}>
          <span>Managing branch</span>
          <select
            aria-label="Managing branch"
            value={adminBranchId}
            onChange={(event) => selectAdminBranch(event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
          <small>Choose the location to manage.</small>
        </label>
        <p className="admin-nav-label">MANAGE YOUR RESTAURANT</p>
        <nav className="admin-nav" aria-label="Restaurant administration">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={pathname.startsWith(href) ? 'active' : ''}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={18} />
              {label}
              {href === '/admin/orders' && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-demo-note">
            <ShieldCheck size={18} />
            <div>
              <strong>{workspaceLabel}</strong>
              <p>
                {!shared.enabled
                  ? 'Changes are saved in this browser. Sample data only.'
                  : shared.mode === 'development'
                    ? 'Test orders appear only in this workspace’s Kitchen. Use the production QR for customers.'
                    : shared.mode === 'production'
                      ? 'Customer orders appear in this workspace’s Kitchen. Test orders stay in the test workspace.'
                      : 'Orders and restaurant settings are shared securely with this workspace.'}
              </p>
            </div>
          </div>
          <Link href="/" className="admin-store-link">
            Visit storefront <ArrowUpRight size={16} />
          </Link>
          <button
            className="admin-logout"
            disabled={signingOut}
            onClick={async () => {
              setSigningOut(true);
              try {
                if (shared.enabled) {
                  await auth.signOut();
                  await shared.refresh();
                }
                logout();
                router.replace('/admin/login');
              } catch (cause) {
                toast.error(cause instanceof Error ? cause.message : 'Unable to sign out.');
              } finally {
                setSigningOut(false);
              }
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      {mobileOpen && (
        <button
          className="admin-sidebar-scrim"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <button
              className="admin-menu-button"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <Menu />
            </button>
            <span className="admin-breadcrumb">
              <span className="admin-breadcrumb-root">
                Workspace <span>/</span>{' '}
              </span>
              {links.find((l) => pathname.startsWith(l.href))?.label || 'Overview'}
            </span>
          </div>
          <div className="admin-user">
            {shared.enabled && (
              <OrderSoundToggle
                className="btn btn-outline btn-sm admin-sound-toggle"
                soundOn={orderChime.soundOn}
                needsTap={orderChime.needsTap}
                onToggle={orderChime.toggle}
              />
            )}
            <span className="badge admin-demo-badge">{workspaceLabel.toUpperCase()}</span>
            <div className="admin-avatar">OA</div>
            <div>
              <strong>Owner account</strong>
              <small>
                {shared.enabled
                  ? auth.user?.email || 'Verified administrator'
                  : 'Demo administrator'}
              </small>
            </div>
          </div>
        </header>
        <div className="admin-page-content">
          {shared.enabled && shared.admin && (
            <QrRequestNotice key={adminBranchId} branchId={adminBranchId} />
          )}
          {shared.enabled && shared.admin && pendingOrders.length > 0 && (
            <section
              aria-label="Orders awaiting acceptance"
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 20,
                padding: 16,
                marginBottom: 20,
                background: '#fff3df',
                border: '2px solid #ed3825',
                borderRadius: 12,
              }}
            >
              <strong role="status">
                {pendingOrders.length} new order{pendingOrders.length === 1 ? '' : 's'} — accept to
                send to Kitchen
              </strong>
              {pendingOrders.map((order) => (
                <div
                  key={order.id}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 12,
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: 12,
                  }}
                >
                  <Link href={`/admin/orders/${order.id}`}>
                    Order #{order.number} · {order.items.length} items
                  </Link>
                  <button
                    className="btn btn-primary"
                    disabled={accepting !== null}
                    onClick={async () => {
                      if (acceptLock.current) return;
                      acceptLock.current = true;
                      setAccepting(order.id);
                      try {
                        await shared.changeOrderStatus(order.id, 'confirmed');
                        toast.success(`Order #${order.number} accepted — sent to Kitchen`);
                      } catch (cause) {
                        toast.error(
                          cause instanceof Error ? cause.message : 'Unable to accept order.',
                        );
                      } finally {
                        acceptLock.current = false;
                        setAccepting(null);
                      }
                    }}
                  >
                    {accepting === order.id ? 'Accepting…' : 'Accept order'}
                  </button>
                </div>
              ))}
            </section>
          )}
          {!shared.enabled && persistenceError && (
            <p
              role="alert"
              className="error-message admin-section-gap"
              style={{ marginBottom: 20 }}
            >
              {persistenceError}
            </p>
          )}
          {shared.enabled && shared.adminError && (
            <div role="alert" className="error-message" style={{ marginBottom: 20 }}>
              {shared.adminError}{' '}
              <button className="btn btn-outline btn-sm" onClick={() => void shared.refreshAdmin()}>
                Retry sync
              </button>
            </div>
          )}
          <div key={adminBranchId}>{children}</div>
        </div>
      </main>
    </div>
  );
}
