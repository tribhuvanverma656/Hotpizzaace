'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { QrCode } from 'lucide-react';
import { commerceRequest } from '@/lib/commerce/client';
import { startVisiblePolling } from '@/lib/visible-polling';
import type { TableRequest } from '@/lib/table-ordering';

/** Pay-at-counter proposals are visible everywhere, but never trigger the paid-order alarm. */
export function QrRequestNotice({ branchId }: { branchId: string }) {
  const [count, setCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    try {
      const result = await commerceRequest<{ requests: TableRequest[]; hasMore: boolean }>(
        `admin/table-requests/${encodeURIComponent(branchId)}`,
        { signal: current.signal },
      );
      if (!active.current || current.signal.aborted) return;
      if (
        !Array.isArray(result.requests) ||
        result.requests.some(
          (request) => request.branchId !== branchId || request.status !== 'pending',
        )
      )
        throw new Error('The QR request queue could not be verified.');
      setCount(result.requests.length);
      setHasMore(result.hasMore === true);
      setError('');
    } catch (cause) {
      if (active.current && !current.signal.aborted) {
        setCount(0);
        setError(cause instanceof Error ? cause.message : 'Unable to check QR requests.');
      }
    } finally {
      if (controller.current === current) controller.current = null;
    }
  }, [branchId]);
  useEffect(() => {
    active.current = true;
    const stop = startVisiblePolling({ refresh, intervalMs: 10000 });
    return () => {
      active.current = false;
      stop();
      controller.current?.abort();
      controller.current = null;
    };
  }, [refresh]);
  if (!count && !error) return null;
  return (
    <section
      aria-label="QR orders awaiting counter payment"
      className="admin-card"
      style={{ padding: 16, marginBottom: 20, border: '2px solid #d89125', background: '#fff8eb' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <strong role="status">
            <QrCode size={18} aria-hidden="true" />{' '}
            {error
              ? 'QR request connection needs attention'
              : `${count}${hasMore ? '+' : ''} QR order${count === 1 ? '' : 's'} waiting at the counter`}
          </strong>
          <p style={{ margin: '6px 0 0' }}>
            {error ||
              'Collect or confirm payment, then accept to send to Kitchen. Requests expire after 30 minutes.'}
          </p>
        </div>
        <Link className="btn btn-primary" href="/admin/counter#qr-requests">
          Review & collect payment
        </Link>
        {error && (
          <button className="btn btn-outline" onClick={() => void refresh()}>
            Retry QR connection
          </button>
        )}
      </div>
    </section>
  );
}
