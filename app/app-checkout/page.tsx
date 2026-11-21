'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDemoStore } from '@/lib/store';
import { useSharedCommerce } from '@/components/shared-commerce-provider';
import { decodeMobileCart, validateMobileCart, type MobileCart } from '@/lib/mobile-cart';
import { getItemOptions, getUnitPrice } from '@/lib/pricing';
import { money } from '@/lib/utils';
import { RestaurantLogo } from '@/components/restaurant-logo';

export default function AppCheckout() {
  const router = useRouter();
  const shared = useSharedCommerce();
  const store = useDemoStore();
  const [proposal, setProposal] = useState<MobileCart | null>(null);
  const [error, setError] = useState('');
  const [replace, setReplace] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      setProposal(decodeMobileCart(window.location.hash));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to read app cart.');
    }
  }, []);
  let valid: MobileCart | null = null;
  let validationError = '';
  if (proposal && shared.ready && store.hydrated) {
    try {
      valid = validateMobileCart(
        proposal,
        store.products,
        store.branches.map((b) => b.id),
      );
    } catch (e) {
      validationError = e instanceof Error ? e.message : 'Please review your cart.';
    }
  }
  const branch = store.branches.find((b) => b.id === valid?.branchId);
  const ready = shared.enabled && shared.ready && store.hydrated && valid && branch;
  return (
    <main style={{ maxWidth: 600, margin: '40px auto', padding: 24 }}>
      <RestaurantLogo />
      <p>HOT PIZZA ACE APP</p>
      <h1>Review your app cart</h1>
      <p>
        Your current menu prices are shown below. Delivery, GST and available payment options are
        confirmed at checkout.
      </p>
      {(error || validationError || shared.error) && (
        <p role="alert">{error || validationError || shared.error}</p>
      )}
      {!ready && !error && !validationError && !shared.error && (
        <p role="status">Connecting to the restaurant…</p>
      )}
      {ready && valid && branch && (
        <>
          <h2>{branch.name}</h2>
          <ul>
            {valid.items.map((item, index) => {
              const product = store.products.find((p) => p.id === item.productId)!;
              return (
                <li key={index} style={{ padding: '16px 0' }}>
                  <strong>
                    {item.quantity} × {product.name}
                  </strong>
                  <p>{getItemOptions(product, item).join(' · ')}</p>
                  {item.notes && <p>{item.notes}</p>}
                  <b>{money(getUnitPrice(product, item) * item.quantity)}</b>
                </li>
              );
            })}
          </ul>
          {store.cart.length > 0 && (
            <label style={{ display: 'block', margin: '20px 0' }}>
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
              />{' '}
              Replace the cart already saved in this browser with this app cart.
            </label>
          )}
          <button
            className="btn btn-primary"
            disabled={store.cart.length > 0 && !replace}
            onClick={() => {
              try {
                const state = useDemoStore.getState();
                const checked = validateMobileCart(
                  proposal,
                  state.products,
                  state.branches.map((b) => b.id),
                );
                if (state.cart.length && !replace)
                  throw new Error('Confirm before replacing the existing website cart.');
                const current = state.branches.find((b) => b.id === checked.branchId)!;
                useDemoStore.setState({
                  selectedBranchId: current.id,
                  settings: current.settings,
                  cartBranchId: current.id,
                  cart: checked.items.map((item, index) => ({
                    ...item,
                    id: `app-${Date.now()}-${index}`,
                  })),
                  coupon: '',
                });
                window.history.replaceState(null, '', window.location.pathname);
                router.replace('/checkout');
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Unable to transfer cart.');
              }
            }}
          >
            Continue to secure checkout
          </button>
        </>
      )}
      <p>
        <Link href="/menu">Browse website menu</Link>
      </p>
    </main>
  );
}
