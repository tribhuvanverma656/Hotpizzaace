'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import QRCode from 'qrcode';
import { Printer, QrCode, RefreshCw } from 'lucide-react';
import { commerceRequest } from '@/lib/commerce/client';
import type { ManagedTable } from '@/lib/table-ordering';
import { useAdminStore } from './use-admin-store';
import styles from './dine-in-qr.module.css';

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : 'Unable to manage the branch ordering QR.';
export function DineInQrManager() {
  const store = useAdminStore();
  if (!store.shared.enabled)
    return (
      <section>
        <h1>Scan & order QR</h1>
        <p>Connect the shared workspace to manage your branch ordering QR.</p>
      </section>
    );
  return (
    <BranchQrManager
      key={`${store.shared.user?.id}:${store.adminBranchId}`}
      branchId={store.adminBranchId}
    />
  );
}
function BranchQrManager({ branchId }: { branchId: string }) {
  const store = useAdminStore();
  const branch = store.branches.find((b) => b.id === branchId);
  const [branchQr, setBranchQr] = useState<ManagedTable | null>(null);
  const [qr, setQr] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'rotate' | 'disable' | null>(null);
  const active = useRef(true);
  const mutation = useRef(false);
  const seq = useRef(0);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const n = ++seq.current;
      setLoading(true);
      try {
        const result = await commerceRequest<{ tables: ManagedTable[]; hasMore: boolean }>(
          `admin/table-qr/${branchId}`,
          { signal },
        );
        if (!active.current || signal?.aborted || n !== seq.current) return;
        if (
          !Array.isArray(result.tables) ||
          result.hasMore ||
          result.tables.length > 1 ||
          result.tables.some(
            (item) => item.branchId !== branchId || !/^[a-f0-9]{64}$/.test(item.token),
          )
        )
          throw new Error('The branch QR could not be verified. Refresh before printing.');
        setBranchQr(result.tables[0] ?? null);
        setError('');
      } catch (cause) {
        if (active.current && !signal?.aborted && n === seq.current) setError(message(cause));
      } finally {
        if (active.current && !signal?.aborted && n === seq.current) setLoading(false);
      }
    },
    [branchId],
  );
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      active.current = false;
      controller.abort();
    };
  }, [load]);
  useEffect(() => {
    let cancelled = false;
    setQr('');
    setUrl('');
    if (branchQr?.active) {
      const href = `${window.location.origin}/dine-in/${branchQr.token}`;
      setUrl(href);
      void QRCode.toDataURL(href, { width: 600, margin: 3, errorCorrectionLevel: 'M' })
        .then((data) => {
          if (!cancelled) setQr(data);
        })
        .catch(() => {
          if (!cancelled) setError('Unable to generate the QR image. Try again.');
        });
    }
    return () => {
      cancelled = true;
    };
  }, [branchQr]);
  const mutate = async (body: unknown) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError('');
    ++seq.current;
    try {
      await commerceRequest('admin/table-qr', { method: 'POST', body });
      if (active.current) {
        setConfirm(null);
        await load();
      }
    } catch (cause) {
      if (active.current) {
        await load();
        if (active.current) setError(message(cause));
      }
    } finally {
      mutation.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <section className={styles.screen}>
      <header className={styles.heading}>
        <div>
          <p>QUICK SERVICE ORDERING</p>
          <h1>One QR for your branch</h1>
          <span>{branch?.name} · Customers order on their phone and pay at the counter</span>
        </div>
        <Link className="btn btn-outline" href="/admin/counter">
          Review QR orders
        </Link>
      </header>
      {store.shared.mode === 'development' && (
        <p className={styles.warning}>
          TEST WORKSPACE · Use this QR for testing only. Print the production QR for customers.
        </p>
      )}
      <div className={styles.card}>
        <label>
          Branch
          <select
            aria-label="QR branch"
            value={branchId}
            disabled={busy}
            onChange={(e) => store.selectAdminBranch(e.target.value)}
          >
            {store.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <p>
          Put this ordering QR at the counter or entrance. Customers choose food, enter their name
          and mobile number, and send their order here. Collect cash or verify payment on your
          existing merchant UPI QR, then send the order to Kitchen.
        </p>
        {!branch?.settings.counterAcceptingOrders && (
          <p className={styles.warning}>
            QR ordering is paused. Enable “Accept counter and QR orders” in this branch’s settings
            after testing.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.create}>
        {!branchQr && !loading && (
          <button
            className="btn btn-dark"
            disabled={busy || !!error}
            onClick={() => void mutate({ action: 'create', branchId })}
          >
            <QrCode size={18} /> Create branch ordering QR
          </button>
        )}
        {branchQr && (
          <>
            <strong>{branchQr.active ? 'Ordering QR active' : 'Ordering QR disabled'}</strong>
            <button
              className="btn btn-outline"
              disabled={busy || loading || !!error}
              onClick={() => setConfirm('rotate')}
            >
              {branchQr.active ? 'Replace QR' : 'Reactivate with new QR'}
            </button>
            {branchQr.active && (
              <button
                className="btn btn-outline"
                disabled={busy || loading || !!error}
                onClick={() => setConfirm('disable')}
              >
                Disable QR
              </button>
            )}
          </>
        )}
        <button className="btn btn-outline" disabled={loading || busy} onClick={() => void load()}>
          <RefreshCw size={17} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {confirm && branchQr && (
        <div role="alert" className={styles.warning}>
          <strong>
            {confirm === 'rotate' ? 'Replace this branch QR?' : 'Disable this branch QR?'}
          </strong>
          <p>
            Its existing link and pending requests will stop working. Accepted orders and bills
            remain unchanged.
            {confirm === 'rotate' && ' Print and replace every copy of the QR after this change.'}
          </p>
          <div className={styles.actions}>
            <button
              className="btn btn-dark"
              disabled={busy || loading || !!error}
              onClick={() =>
                void mutate({
                  action: confirm,
                  tableId: branchQr.id,
                  expectedVersion: branchQr.version,
                })
              }
            >
              Confirm {confirm === 'rotate' ? 'replacement' : 'disable'}
            </button>
            <button className="btn btn-outline" disabled={busy} onClick={() => setConfirm(null)}>
              Keep current QR
            </button>
          </div>
        </div>
      )}
      {branchQr?.active && qr && (
        <section className={`${styles.print} hpa-print-bill`}>
          <h2>HOT PIZZA ACE</h2>
          <p>{branch?.name}</p>
          <h3>Scan. Choose your food. Pay at the counter.</h3>
          <Image
            src={qr}
            alt={`Scan to order at ${branch?.name ?? 'HOT PIZZA ACE'}`}
            width={280}
            height={280}
            unoptimized
          />
          <p>
            Enter your name and mobile number.
            <br />
            Show your request number and pay with cash or UPI at the counter.
            <br />
            We prepare your food after payment confirmation.
          </p>
          {store.shared.mode === 'development' && <strong>TEST QR · NOT FOR RESTAURANT USE</strong>}
          <div className={styles.actions}>
            <button
              className="btn btn-dark"
              disabled={busy || loading || !!error}
              onClick={() => window.print()}
            >
              <Printer size={18} /> Print QR
            </button>
            {!error && !loading && !busy && (
              <>
                <a className="btn btn-outline" href={url} target="_blank" rel="noopener noreferrer">
                  Preview ordering menu
                </a>
                <a
                  className="btn btn-outline"
                  download={`hot-pizza-ace-${branchId.replace(/[^A-Za-z0-9]/g, '-')}-ordering-qr.png`}
                  href={qr}
                >
                  Download PNG
                </a>
              </>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
