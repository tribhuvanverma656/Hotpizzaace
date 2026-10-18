'use client';
import Link from 'next/link';
import { LogIn, LogOut, ShoppingBag, MapPin } from 'lucide-react';
import { useDemoStore } from '@/lib/store';
import { getOrdersForCustomer } from '@/lib/order-tracking';
import { LocalOrderList } from '@/components/local-order-list';

export default function OrderHistory() {
  const { orders, customerSession, hydrated, logoutCustomer } = useDemoStore();
  if (!hydrated)
    return (
      <div className="container empty-state" role="status">
        Finding your saved orders…
      </div>
    );
  if (!customerSession)
    return (
      <div className="container empty-state customer-signin-prompt">
        <span className="empty-icon">
          <LogIn size={38} />
        </span>
        <span className="eyebrow">YOUR PIZZA, YOUR PROGRESS</span>
        <h1>
          Sign in to see <em>your orders.</em>
        </h1>
        <p>
          Use the mobile number entered at checkout to find your orders and track their progress.
        </p>
        <Link className="btn btn-primary" href="/account/login?next=/account/orders">
          Customer sign in <LogIn size={17} />
        </Link>
        <Link className="text-link" href="/track-order">
          Track as a guest using an order number
        </Link>
        <small className="muted">
          Demo login only. No SMS is sent; orders stay in this browser.
        </small>
      </div>
    );
  const ordersForCustomer = getOrdersForCustomer(orders, customerSession.phone);
  return (
    <div className="container journey-page">
      <div className="page-heading account-orders-heading">
        <div>
          <span className="eyebrow">GOOD MEMORIES. GREAT PIZZA.</span>
          <h1>
            Your slice <em>of history.</em>
          </h1>
          <p>
            Signed in with +91 ••••••{customerSession.phone.slice(-4)} · Demo account on this
            device.
          </p>
        </div>
        <div className="account-page-actions">
          <Link href="/account/addresses" className="btn btn-outline btn-sm">
            <MapPin size={15} /> Saved addresses
          </Link>
          <button className="btn btn-outline btn-sm" onClick={logoutCustomer}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </div>
      {ordersForCustomer.length ? (
        <LocalOrderList orders={ordersForCustomer} />
      ) : (
        <div className="empty-state">
          <ShoppingBag size={38} />
          <h2>No orders for this mobile yet.</h2>
          <p>Orders placed with your signed-in mobile number will appear here.</p>
          <Link className="btn btn-primary" href="/menu">
            Find your first slice
          </Link>
        </div>
      )}
    </div>
  );
}
