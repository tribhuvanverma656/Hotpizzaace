'use client';
import Link from 'next/link';
import {
  ShoppingBag,
  Clock3,
  CircleCheck,
  IndianRupee,
  ArrowUpRight,
  TrendingUp,
  Pizza,
} from 'lucide-react';
import { getOrderBranchId } from '@/lib/branches';
import { useDemoStore } from '@/lib/store';
import { money } from '@/lib/utils';
import { isRevenueEligible, localDate, PageHeading } from '@/components/admin/shared';
import { OrderTable } from '@/components/admin/orders';
export default function DashboardPage() {
  const { orders: allOrders, settings: customerSettings, branches, adminBranchId } = useDemoStore();
  const orders = allOrders.filter((order) => getOrderBranchId(order) === adminBranchId);
  const settings =
    branches.find((branch) => branch.id === adminBranchId)?.settings ?? customerSettings;
  const today = localDate(new Date().toISOString());
  const todayOrders = orders.filter((o) => localDate(o.createdAt) === today);
  const eligible = orders.filter(isRevenueEligible);
  const revenue = eligible.reduce((sum, order) => sum + order.total, 0);
  const completed = orders.filter(
    (o) => ['delivered', 'picked_up'].includes(o.status) && isRevenueEligible(o),
  );
  const popular = Object.values(
    eligible.reduce<
      Record<string, { name: string; quantity: number; sales: number; image: string }>
    >((acc, order) => {
      for (const item of order.items) {
        acc[item.productId] ||= { name: item.name, quantity: 0, sales: 0, image: item.image };
        acc[item.productId].quantity += item.quantity;
        acc[item.productId].sales += item.quantity * item.unitPrice;
      }
      return acc;
    }, {}),
  )
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 4);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - 6 + i);
    const key = localDate(date.toISOString());
    return {
      label: date.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }),
      value: eligible
        .filter((o) => localDate(o.createdAt) === key)
        .reduce((sum, o) => sum + o.total, 0),
    };
  });
  const maxSales = Math.max(1, ...days.map((d) => d.value));
  return (
    <>
      <PageHeading
        eyebrow="YOUR RESTAURANT, AT A GLANCE"
        title="Let’s make it a good day."
        description="A fresh look at what’s happening at Hot Pizza Ace."
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
              ? 'Your kitchen is accepting orders'
              : 'Your kitchen is paused'}
          </strong>
          <span>Printed menu · Demo order data</span>
        </div>
        <Link href="/admin/settings">
          Manage availability <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="stat-grid">
        {[
          {
            title: 'Orders today',
            value: todayOrders.length,
            note: 'Today · India Standard Time',
            icon: ShoppingBag,
            color: 'red',
          },
          {
            title: 'Pending orders',
            value: orders.filter((o) => o.status === 'pending').length,
            note: 'Waiting for your confirmation',
            icon: Clock3,
            color: 'gold',
          },
          {
            title: 'Completed sales',
            value: completed.length,
            note: 'Fulfilled + simulated payment',
            icon: CircleCheck,
            color: 'green',
          },
          {
            title: 'Demo revenue',
            value: money(revenue),
            note: 'Eligible orders · all time',
            icon: IndianRupee,
            color: 'purple',
          },
        ].map(({ title, value, note, icon: Icon, color }) => (
          <div className="stat-card" key={title}>
            <div className="admin-stat-label">
              <span>{title}</span>
              <span className={`admin-stat-icon ${color}`}>
                <Icon size={19} />
              </span>
            </div>
            <strong className="admin-stat-value">{value}</strong>
            <p>{note}</p>
          </div>
        ))}
      </div>
      <p className="admin-revenue-definition">
        Revenue counts only delivered or picked-up orders with simulated payment. Cancelled and
        rejected orders are excluded. Unpaid cash, pending, initiated, and failed payments
        contribute ₹0. No real sales or money transfers.
      </p>
      <div className="admin-dashboard-grid">
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h2>Sales this week</h2>
              <p>Eligible demo revenue over the last 7 days</p>
            </div>
            <span className="admin-chart-label">
              <TrendingUp size={15} />
              {money(days.reduce((s, d) => s + d.value, 0))}
            </span>
          </div>
          <div
            className="admin-sales-chart"
            role="img"
            aria-label={days.map((d) => `${d.label}: ${money(d.value)}`).join(', ')}
          >
            {days.map((day, index) => (
              <div className="admin-chart-column" key={index}>
                <span className="admin-bar-value">{money(day.value)}</span>
                <div className="admin-bar-track">
                  <div
                    className="admin-chart-bar"
                    style={{
                      height: `${day.value ? Math.max(5, (day.value / maxSales) * 100) : 1}%`,
                    }}
                  />
                </div>
                <span>{day.label}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="admin-card">
          <div className="admin-card-heading">
            <div>
              <h2>The crowd favorites</h2>
              <p>Items from eligible demo sales</p>
            </div>
            <Pizza size={21} />
          </div>
          <div className="admin-bestsellers">
            {popular.length ? (
              popular.map((item, i) => (
                <div key={item.name}>
                  <span className="admin-rank">0{i + 1}</span>
                  <img src={item.image} alt="" />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.quantity} sold</small>
                  </span>
                  <strong>{money(item.sales)}</strong>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <p>Paid demo orders will reveal your bestsellers here.</p>
              </div>
            )}
          </div>
        </section>
      </div>
      <section className="admin-card admin-section-gap">
        <div className="admin-card-heading">
          <div>
            <h2>Fresh from the order queue</h2>
            <p>Your latest orders, all in one place</p>
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
