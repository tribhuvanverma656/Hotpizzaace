'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useDemoStore } from '@/lib/store';
import { OrderDetail } from '@/components/order-detail';
import { useSharedCommerce } from '@/components/shared-commerce-provider';
import { SharedOrderView } from '@/components/shared-order-view';
function Confirmation() {
  const params = useSearchParams();
  const id = params.get('id');
  const shared = useSharedCommerce();
  const order = useDemoStore((s) => s.orders.find((o) => o.id === id));
  const hydrated = useDemoStore((s) => s.hydrated);
  if (shared.enabled && id)
    return <SharedOrderView id={id} access={params.get('access') ?? undefined} confirmation />;
  if (!hydrated) return <div className="container empty-state">Finding your order…</div>;
  if (!order)
    return (
      <div className="container empty-state">
        <h1>Let’s find your order.</h1>
        <p>
          {shared.enabled
            ? 'Open your private tracking link or check My orders.'
            : 'No local order was found for this link.'}
        </p>
        <Link href="/track-order" className="btn btn-primary">
          Track your order
        </Link>
      </div>
    );
  return (
    <div className="container order-page">
      <OrderDetail order={order} confirmation />
    </div>
  );
}
export default function OrderSuccessPage() {
  return (
    <Suspense fallback={<div className="empty-state">Loading your order…</div>}>
      <Confirmation />
    </Suspense>
  );
}
