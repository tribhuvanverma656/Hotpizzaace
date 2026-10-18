'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Search, Users, ArrowUpRight } from 'lucide-react';
import { getOrderBranchId } from '@/lib/branches';
import { useDemoStore } from '@/lib/store';
import { money } from '@/lib/utils';
import { dateTime, isRevenueEligible, PageHeading } from '@/components/admin/shared';
import type { Order } from '@/types';
export default function CustomersPage() {
  const { orders: allOrders, adminBranchId } = useDemoStore();
  const orders = allOrders.filter((order) => getOrderBranchId(order) === adminBranchId);
  const [search, setSearch] = useState('');
  const groups = Object.values(
    orders.reduce<Record<string, { name: string; phone: string; orders: Order[] }>>(
      (acc, order) => {
        const key = order.customer.phone;
        acc[key] ||= { name: order.customer.name, phone: key, orders: [] };
        acc[key].orders.push(order);
        return acc;
      },
      {},
    ),
  )
    .map((customer) => ({
      ...customer,
      orders: customer.orders.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    }))
    .sort((a, b) => Date.parse(b.orders[0].createdAt) - Date.parse(a.orders[0].createdAt));
  const filtered = groups.filter((c) =>
    `${c.name} ${c.phone}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="THE PEOPLE BEHIND THE ORDERS"
        title="Customers"
        description="A little closer to the people who keep coming back."
      />
      <div className="admin-inline-note admin-customers-note">
        <Users size={19} />
        <span>
          Demonstration directory, grouped by phone number from local sample orders. This is not an
          authenticated customer account system.
        </span>
      </div>
      <section className="admin-card">
        <div className="filter-bar">
          <div className="admin-search">
            <Search size={17} />
            <input
              value={search}
              aria-label="Search customers"
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers by name or phone…"
            />
          </div>
          <span className="muted">{filtered.length} customers</span>
        </div>
        <div className="admin-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Phone</th>
                <th>Orders</th>
                <th>Eligible demo spend</th>
                <th>Latest order</th>
                <th>
                  <span className="sr-only">View latest order</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((customer) => (
                <tr key={customer.phone}>
                  <td>
                    <div className="admin-customer-cell">
                      <span className="admin-avatar">
                        {customer.name
                          .split(' ')
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join('')}
                      </span>
                      <strong>{customer.name}</strong>
                    </div>
                  </td>
                  <td>{customer.phone}</td>
                  <td>{customer.orders.length}</td>
                  <td>
                    <strong>
                      {money(
                        customer.orders
                          .filter(isRevenueEligible)
                          .reduce((sum, o) => sum + o.total, 0),
                      )}
                    </strong>
                    <small>Fulfilled + simulated-paid only</small>
                  </td>
                  <td>
                    <Link
                      className="admin-table-link"
                      href={`/admin/orders/${customer.orders[0].id}`}
                    >
                      #{customer.orders[0].number}
                    </Link>
                    <small>{dateTime(customer.orders[0].createdAt)}</small>
                  </td>
                  <td>
                    <Link
                      className="admin-icon-link"
                      aria-label={`View ${customer.name}'s latest order`}
                      href={`/admin/orders/${customer.orders[0].id}`}
                    >
                      <ArrowUpRight size={17} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <div className="empty-state">
              <Users size={30} />
              <h3>No customers found</h3>
              <p>Customers appear here when orders are placed in the demo.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
