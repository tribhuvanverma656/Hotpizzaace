'use client';

import Image from 'next/image';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { Printer, QrCode, RefreshCw, ShieldOff } from 'lucide-react';
import { LocalPosAccountMenu } from '@/components/local-pos/account-menu';
import { LocalPosSidebar } from '@/components/local-pos/sidebar';
import type { LocalUser } from '@/lib/local-pos/database';
import styles from './qr-manager.module.css';

type QrState = { enabled: boolean; token: string | null };
type NetworkLink = { interface: string; url: string };
type QrImage = NetworkLink & { orderUrl: string; image: string };

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'The local POS request failed.');
  return result;
}

export function LocalPosQrManager() {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [qrState, setQrState] = useState<QrState | null>(null);
  const [images, setImages] = useState<QrImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const session = await request<{ user: LocalUser | null }>('/api/local-pos/session');
      if (!session.user || !['super_user', 'pos_manager'].includes(session.user.role)) {
        setUser(null);
        setQrState(null);
        return;
      }
      setUser(session.user);
      const state = await request<QrState>('/api/local-pos/qr');
      setQrState(state);
      if (!state.enabled || !state.token) {
        setImages([]);
        return;
      }
      const { links } = await request<{ links: NetworkLink[] }>('/api/local-pos/kitchen-link');
      const generated = await Promise.all(
        links.map(async (link) => {
          const orderUrl = `${new URL(link.url).origin}/local-pos/order/${state.token}`;
          return {
            ...link,
            orderUrl,
            image: await QRCode.toDataURL(orderUrl, {
              width: 520,
              margin: 3,
              errorCorrectionLevel: 'M',
            }),
          };
        }),
      );
      setImages(generated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'QR ordering could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeQr(action: 'enable' | 'rotate' | 'disable') {
    setBusy(true);
    setError('');
    try {
      await request('/api/local-pos/qr', 'POST', { action });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'QR ordering could not be updated.');
    } finally {
      setBusy(false);
    }
  }

  if (loading && !user) return <main className={styles.statePage}>Connecting to local POS…</main>;
  if (!user)
    return (
      <main className={styles.statePage}>
        <h1>POS sign-in required</h1>
        <p>Sign in as the Super User or POS Manager to manage customer ordering QR codes.</p>
        <Link href="/local-pos">Go to POS sign in</Link>
      </main>
    );

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Link href="/local-pos/dashboard" aria-label="Local POS dashboard">
            <Image src="/brand/hot-pizza-ace.gif" alt="" width={1806} height={1440} unoptimized />
          </Link>
          <div>
            <strong>HOT PIZZA ACE</strong>
            <span>LOCAL POS · QR ORDERING</span>
          </div>
        </div>
        <div className={styles.topActions}>
          <Link href="/local-pos">Team access</Link>
          <LocalPosAccountMenu user={user} />
        </div>
      </header>
      <div className={styles.layout}>
        <LocalPosSidebar role={user.role} active="qr" />
        <section className={styles.content}>
          <div className={styles.heading}>
            <div>
              <p>ORDER FROM THE TABLE</p>
              <h1>Customer QR ordering</h1>
              <span>
                Customers must be connected to the same restaurant Wi-Fi as this POS computer.
              </span>
            </div>
            <button type="button" disabled={busy || loading} onClick={() => void load()}>
              <RefreshCw size={15} /> Refresh
            </button>
          </div>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <section className={styles.card}>
            <div className={styles.cardIcon}>
              <QrCode size={21} />
            </div>
            <div>
              <h2>{qrState?.enabled ? 'QR ordering is enabled' : 'QR ordering is disabled'}</h2>
              <p>
                Share a customer menu on your local network. Guests choose items, provide a name and
                table number, and send the order directly to the local Kitchen Display. Payment is
                collected at the counter.
              </p>
              <p className={styles.networkNote}>
                The POS computer must stay on with the app running. This local QR does not use the
                website’s hosted ordering service.
              </p>
            </div>
          </section>
          <div className={styles.actions}>
            {!qrState?.enabled ? (
              <button
                type="button"
                className={styles.primary}
                disabled={busy}
                onClick={() => void changeQr('enable')}
              >
                <QrCode size={17} /> {busy ? 'Enabling…' : 'Enable local QR ordering'}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy}
                  onClick={() => void changeQr('rotate')}
                >
                  <RefreshCw size={16} /> Replace QR code
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => void changeQr('disable')}
                >
                  <ShieldOff size={16} /> Disable ordering
                </button>
              </>
            )}
          </div>
          {qrState?.enabled && (
            <section className={styles.qrSection}>
              <div className={styles.sectionHeading}>
                <h2>Print the QR for your restaurant network</h2>
                <span>
                  {images.length} network address{images.length === 1 ? '' : 'es'} detected
                </span>
              </div>
              {!images.length && !loading ? (
                <p className={styles.empty}>
                  No private network address was detected. Connect the POS computer to the
                  restaurant Wi-Fi and refresh.
                </p>
              ) : (
                <div className={styles.qrGrid}>
                  {images.map((qr) => (
                    <article className={styles.qrCard} key={qr.url}>
                      <p>{qr.interface}</p>
                      <Image
                        src={qr.image}
                        alt={`Customer ordering QR for ${qr.interface}`}
                        width={520}
                        height={520}
                        unoptimized
                      />
                      <code>{qr.orderUrl}</code>
                      <button type="button" onClick={() => window.print()}>
                        <Printer size={15} /> Print QR
                      </button>
                    </article>
                  ))}
                </div>
              )}
              <p className={styles.warning}>
                Replacing the QR invalidates previous printed copies. Reprint it if your POS
                computer’s network address or app port changes.
              </p>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
