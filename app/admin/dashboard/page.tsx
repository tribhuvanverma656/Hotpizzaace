'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { getOrderBranchId } from '@/lib/branches';
import { useAdminStore } from '@/components/admin/use-admin-store';
import { PageHeading } from '@/components/admin/shared';
import { OrderTable } from '@/components/admin/orders';
import { SalesAnalytics } from '@/components/admin/analytics';

export default function DashboardPage() {
  const {
    orders: allOrders,
    settings: customerSettings,
    branches,
    adminBranchId,
    shared,
  } = useAdminStore();
  const orders = allOrders.filter((order) => getOrderBranchId(order) === adminBranchId);
  const settings =
    branches.find((branch) => branch.id === adminBranchId)?.settings ?? customerSettings;
  return (
    <>
      <PageHeading
        eyebrow="YOUR RESTAURANT, AT A GLANCE"
        title="Let’s make it a good day."
        description="Branch sales, counter collections and your latest orders."
      >
        <Link className="btn btn-dark" href="/admin/orders">
          Manage orders <ArrowUpRight size={16} />
        </Link>
      </PageHeading>
      <div className="admin-overview-banner">
        <div>
          <span
            className={`admin-live-dot ${settings.acceptingOrders && !settings.temporarilyClosed ? '' : 'paused'}`}
          />
          <strong>
            {settings.acceptingOrders && !settings.temporarilyClosed
              ? 'Your website is accepting orders'
              : 'Website ordering is paused'}
          </strong>
          <span>
            {shared.enabled
              ? shared.mode === 'development'
                ? 'Development · test data'
                : 'Connected restaurant workspace'
              : 'Demo order data'}
          </span>
        </div>
        <Link href="/admin/settings">
          Manage availability <ArrowUpRight size={15} />
        </Link>
      </div>
      <SalesAnalytics />
      <section className="admin-card admin-section-gap">
        <div className="admin-card-heading">
          <div>
            <h2>Fresh from the order queue</h2>
            <p>
              Latest activity for this branch. Sales reports above use the full selected date range.
            </p>
          </div>
          <Link className="admin-inline-link" href="/admin/orders">
            View all orders <ArrowUpRight size={15} />
          </Link>
        </div>
        <OrderTable
          orders={[...orders]
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .slice(0, 5)}
        />
      </section>
    </>
  );
}
