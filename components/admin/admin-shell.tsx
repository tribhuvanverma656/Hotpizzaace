'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import { attachDemoStoreSync, useDemoStore } from '@/lib/store';
import { RestaurantLogo } from '@/components/restaurant-logo';
import branchStyles from '@/components/admin/admin-branches.module.css';

const links = [
  { href: '/admin/dashboard', label: 'Overview', icon: BarChart3 },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingBag },
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
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    void useDemoStore.persist.rehydrate();
    return attachDemoStoreSync();
  }, []);
  useEffect(() => {
    if (hydrated && !adminSession && pathname !== '/admin/login') router.replace('/admin/login');
  }, [hydrated, adminSession, pathname, router]);
  if (pathname === '/admin/login') return <main className="admin-login-shell">{children}</main>;
  if (!hydrated || !adminSession)
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
              <strong>Demo workspace</strong>
              <p>Changes are saved in this browser. Sample data only.</p>
            </div>
          </div>
          <Link href="/" className="admin-store-link">
            Visit storefront <ArrowUpRight size={16} />
          </Link>
          <button
            className="admin-logout"
            onClick={() => {
              logout();
              router.replace('/admin/login');
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
              Workspace <span>/</span>{' '}
              {links.find((l) => pathname.startsWith(l.href))?.label || 'Overview'}
            </span>
          </div>
          <div className="admin-user">
            <span className="badge admin-demo-badge">DEMO MODE</span>
            <div className="admin-avatar">OA</div>
            <div>
              <strong>Owner account</strong>
              <small>Demo administrator</small>
            </div>
          </div>
        </header>
        <div className="admin-page-content">
          {persistenceError && (
            <p
              role="alert"
              className="error-message admin-section-gap"
              style={{ marginBottom: 20 }}
            >
              {persistenceError}
            </p>
          )}
          <div key={adminBranchId}>{children}</div>
        </div>
      </main>
    </div>
  );
}
