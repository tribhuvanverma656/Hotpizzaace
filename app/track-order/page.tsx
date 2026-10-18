'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, PackageSearch, ArrowRight } from 'lucide-react';
import { useDemoStore } from '@/lib/store';
import { getOrdersForCustomer } from '@/lib/order-tracking';
import { OrderDetail } from '@/components/order-detail';
import { LocalOrderList } from '@/components/local-order-list';

function TrackingContent() {
  const { orders, customerSession, hydrated } = useDemoStore();
  const params = useSearchParams();
  const router = useRouter();
  const [number, setNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [foundId, setFoundId] = useState('');
  const [error, setError] = useState('');
  const localOrders = customerSession ? getOrdersForCustomer(orders, customerSession.phone) : [];
  const requestedId = params.get('order');
  // IDs reopen browser-local receipts; they are not production authentication tokens.
  const order =
    localOrders.find((order) => order.id === requestedId) ||
    orders.find((order) => order.id === foundId);
  if (!hydrated)
    return (
      <div className="container empty-state" role="status">
        Finding your saved orders…
      </div>
    );
  return (
    <div className="container track-page">
      {order ? (
        <>
          <button
            className="back-link"
            onClick={() => {
              setFoundId('');
              setError('');
              router.replace('/track-order', { scroll: false });
            }}
          >
            <Search size={16} />
            Find another order
          </button>
          <OrderDetail order={order} />
        </>
      ) : (
        <>
          <div className="page-heading centered">
            <span className="eyebrow">THE WAIT IS PART OF THE CRAVING</span>
            <h1>
              Where’s my <em>happy box?</em>
            </h1>
            <p>Track your order from confirmation to delivery or pickup.</p>
          </div>
          {!customerSession && (
            <div className="tracking-signin-card">
              <div>
                <h2>Sign in. See your orders. Track every slice.</h2>
                <p>Use the mobile number from checkout. Demo sign-in takes just a moment.</p>
              </div>
              <Link href="/account/login?next=/account/orders" className="btn btn-primary">
                Customer sign in <ArrowRight size={17} />
              </Link>
            </div>
          )}
          {requestedId && customerSession && (
            <p className="error-message tracking-link-error" role="alert">
              This order isn’t available for the signed-in mobile number on this device. Check My
              orders or use the guest lookup below.
            </p>
          )}
          {localOrders.length > 0 && (
            <section className="recent-tracking-orders" aria-labelledby="recent-orders-heading">
              <div className="section-heading">
                <div>
                  <h2 id="recent-orders-heading">Your recent orders</h2>
                  <p className="muted">
                    Orders for your signed-in mobile. Tap Track order to see the latest status.
                  </p>
                </div>
                <Link className="text-link" href="/account/orders">
                  All orders <ArrowRight size={16} />
                </Link>
              </div>
              <LocalOrderList orders={localOrders.slice(0, 4)} />
            </section>
          )}
          <form
            className="track-form"
            onSubmit={(event) => {
              event.preventDefault();
              const normalizedPhone = phone.replace(/\D/g, '').slice(-10);
              const found = orders.find(
                (order) =>
                  order.number.toUpperCase() === number.trim().toUpperCase() &&
                  order.customer.phone.replace(/\D/g, '').slice(-10) === normalizedPhone &&
                  normalizedPhone.length === 10,
              );
              if (found) {
                setFoundId(found.id);
                setError('');
                if (requestedId) router.replace('/track-order', { scroll: false });
              } else
                setError('No matching local order. Check your order number and mobile number.');
            }}
          >
            <PackageSearch size={37} />
            <h2>{localOrders.length ? 'Find a different order' : 'Let’s find your order.'}</h2>
            <label className="field">
              Order number
              <input
                required
                maxLength={80}
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                placeholder="e.g. HPA-1041"
                autoComplete="off"
              />
            </label>
            <label className="field">
              Mobile number
              <input
                required
                type="tel"
                maxLength={20}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="Number used at checkout"
                autoComplete="tel"
              />
            </label>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-primary">
              Track my order <ArrowRight size={17} />
            </button>
            <p className="field-help">
              Local demo only. Try order HPA-1041 with mobile 9876543210. Status updates come from
              this browser’s admin dashboard.
            </p>
          </form>
        </>
      )}
    </div>
  );
}
export default function TrackOrderPage() {
  return (
    <Suspense
      fallback={
        <div className="container empty-state" role="status">
          Finding your order…
        </div>
      }
    >
      <TrackingContent />
    </Suspense>
  );
}
