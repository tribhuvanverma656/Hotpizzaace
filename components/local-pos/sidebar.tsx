'use client';

import Link from 'next/link';
import {
  BarChart3,
  ChefHat,
  ClipboardList,
  LayoutDashboard,
  Pizza,
  QrCode,
  ReceiptText,
  Settings2,
} from 'lucide-react';
import type { LocalRole } from '@/lib/local-pos/database';
import styles from './sidebar.module.css';

export type LocalPosSection =
  | 'dashboard'
  | 'register'
  | 'orders'
  | 'kitchen'
  | 'qr'
  | 'analytics'
  | 'menu'
  | 'settings';

const sectionLabels: Record<LocalPosSection, string> = {
  dashboard: 'Dashboard',
  register: 'POS Register',
  orders: 'Order Dashboard',
  kitchen: 'Kitchen Display',
  qr: 'QR Ordering',
  analytics: 'Sales Insights',
  menu: 'Menu & Products',
  settings: 'Restaurant Settings',
};

const icons = {
  dashboard: LayoutDashboard,
  register: ReceiptText,
  orders: ClipboardList,
  kitchen: ChefHat,
  qr: QrCode,
  analytics: BarChart3,
  menu: Pizza,
  settings: Settings2,
};

export function LocalPosSidebar({
  role,
  active,
}: {
  role: LocalRole;
  active: LocalPosSection;
}) {
  const sections: LocalPosSection[] =
    role === 'kitchen'
      ? ['dashboard', 'kitchen']
      : role === 'super_user'
      ? ['dashboard', 'register', 'orders', 'kitchen', 'menu', 'settings', 'analytics']
      : ['dashboard', 'register', 'orders', 'menu'];

  return (
    <aside className={styles.sidebar}>
      <p className={styles.label}>WORKSPACE</p>
      <nav aria-label="Local POS navigation">
        {sections.map((section) => {
          const Icon = icons[section];
          return (
            <Link
              key={section}
              href={`/local-pos/${section}`}
              className={active === section ? styles.active : ''}
              aria-current={active === section ? 'page' : undefined}
            >
              <Icon size={18} />
              <span>{sectionLabels[section]}</span>
            </Link>
          );
        })}
      </nav>
      {role !== 'kitchen' && (
        <Link className={styles.teamLink} href="/local-pos">
          <Settings2 size={17} />
          <span>Team access</span>
        </Link>
      )}
    </aside>
  );
}
