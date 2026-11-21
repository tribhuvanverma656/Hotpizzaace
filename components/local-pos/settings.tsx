'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Check, CircleAlert, RefreshCw, Save } from 'lucide-react';
import type { CommerceCatalog } from '@/lib/commerce/domain';
import type { LocalUser } from '@/lib/local-pos/database';
import type { RestaurantSettings } from '@/types';
import { LocalPosSidebar } from './sidebar';
import styles from './settings.module.css';

async function getJson<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
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

function rupees(value: number): string {
  return (value / 100).toFixed(2);
}

export function LocalSettings() {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [catalog, setCatalog] = useState<CommerceCatalog | null>(null);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [postalCodes, setPostalCodes] = useState('');
  const [couponMaximum, setCouponMaximum] = useState('0');
  const [couponMinimum, setCouponMinimum] = useState('0');
  const [couponPercent, setCouponPercent] = useState('0');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const session = await getJson<{ user: LocalUser | null }>('/api/local-pos/session');
      if (!session.user || session.user.role !== 'super_user') {
        setUser(null);
        setCatalog(null);
        return;
      }
      setUser(session.user);
      const data = await getJson<CommerceCatalog>('/api/local-pos/catalog');
      const current = data.branches[0]?.settings;
      if (!current) throw new Error('Restaurant settings are missing from the local database.');
      setCatalog(data);
      setSettings(current);
      setPostalCodes(current.servicePostalCodes.join(', '));
      setCouponMaximum(rupees(current.couponMaximum));
      setCouponMinimum(rupees(current.couponMinimum));
      setCouponPercent(String(current.couponPercent));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!catalog || !settings || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const next = {
        ...settings,
        servicePostalCodes: postalCodes.split(/[,\s]+/).filter(Boolean),
        couponMaximum: Math.round(Number(couponMaximum) * 100),
        couponMinimum: Math.round(Number(couponMinimum) * 100),
        couponPercent: Number(couponPercent),
      };
      const result = await getJson<{ catalog: CommerceCatalog }>('/api/local-pos/catalog', 'PATCH', {
        action: 'updateSettings',
        args: { branchId: 'barra', settings: next },
        expectedRevision: catalog.revision,
      });
      setCatalog(result.catalog);
      setSettings(result.catalog.branches[0].settings);
      setPostalCodes(result.catalog.branches[0].settings.servicePostalCodes.join(', '));
      setNotice('Restaurant settings saved on this POS.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Settings could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (loading && !user)
    return <main className={styles.statePage}><div className={styles.spinner} />Loading restaurant settings…</main>;
  if (!user || !settings)
    return (
      <main className={styles.statePage}>
        <h1>Super User access required</h1>
        <p>Only the Super User can change restaurant identity, billing, and operating settings.</p>
        <Link href="/local-pos">Go to POS sign in</Link>
      </main>
    );

  const set = <K extends keyof RestaurantSettings>(key: K, value: RestaurantSettings[K]) =>
    setSettings((current) => current ? { ...current, [key]: value } : current);

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Link href="/local-pos/dashboard"><Image src="/brand/hot-pizza-ace.gif" alt="" width={1806} height={1440} unoptimized /></Link>
          <div><strong>HOT PIZZA ACE</strong><span>RESTAURANT SETTINGS</span></div>
        </div>
        <Link href="/local-pos">Team access</Link>
      </header>
      <div className={styles.layout}>
        <LocalPosSidebar role="super_user" active="settings" />
        <section className={styles.content}>
          <div className={styles.heading}>
            <div><p>SUPER USER CONTROLS</p><h1>Restaurant settings</h1><span>These settings are saved locally and used to calculate POS bills.</span></div>
            <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}><RefreshCw size={15} /> Refresh</button>
          </div>
          {error && <p className={styles.error} role="alert"><CircleAlert size={16} />{error}</p>}
          {notice && <p className={styles.notice} role="status"><Check size={16} />{notice}</p>}
          <form onSubmit={(event) => void save(event)}>
            <section className={styles.panel}>
              <header><h2>Restaurant details</h2><p>Identity shown across the counter bill and receipts.</p></header>
              <div className={styles.grid}>
                <label>Restaurant name<input required minLength={2} maxLength={100} value={settings.name} onChange={(event) => set('name', event.target.value)} /></label>
                <label>Contact phone<input value={settings.phone} onChange={(event) => set('phone', event.target.value)} maxLength={40} /></label>
                <label className={styles.wide}>Business address<textarea required minLength={8} maxLength={300} rows={2} value={settings.address} onChange={(event) => set('address', event.target.value)} /></label>
                <label className={styles.wide}>Opening hours<input required minLength={3} maxLength={200} value={settings.openingHours} onChange={(event) => set('openingHours', event.target.value)} /></label>
              </div>
            </section>
            <section className={styles.panel}>
              <header><h2>Counter availability</h2><p>Temporarily stop new bills without losing saved orders.</p></header>
              <div className={styles.checks}>
                <label><input type="checkbox" checked={settings.counterAcceptingOrders === true} onChange={(event) => set('counterAcceptingOrders', event.target.checked)} /> Counter orders enabled</label>
                <label><input type="checkbox" checked={settings.temporarilyClosed} onChange={(event) => set('temporarilyClosed', event.target.checked)} /> Restaurant temporarily closed</label>
              </div>
            </section>
            <section className={styles.panel}>
              <header><h2>Delivery settings</h2><p>POS Managers can only submit delivery orders inside the enabled service area.</p></header>
              <div className={styles.checks}>
                <label><input type="checkbox" checked={settings.deliveryEnabled} onChange={(event) => set('deliveryEnabled', event.target.checked)} /> Accept phone delivery orders</label>
              </div>
              <div className={styles.grid}>
                <label>Delivery fee (₹)<input type="number" min="0" max="100000" step="0.01" value={rupees(settings.deliveryFee)} onChange={(event) => set('deliveryFee', Math.round(Number(event.target.value) * 100))} /></label>
                <label>Free delivery above (₹)<input type="number" min="0" max="100000" step="0.01" value={settings.freeDeliveryThreshold === null ? '' : rupees(settings.freeDeliveryThreshold)} onChange={(event) => set('freeDeliveryThreshold', event.target.value === '' ? null : Math.round(Number(event.target.value) * 100))} /></label>
                <label>Minimum delivery order (₹)<input type="number" min="0" max="100000" step="0.01" value={rupees(settings.minimumOrder)} onChange={(event) => set('minimumOrder', Math.round(Number(event.target.value) * 100))} /></label>
                <label>Preparation estimate (minutes)<input type="number" min="5" max="240" step="1" value={settings.preparationMinutes} onChange={(event) => set('preparationMinutes', Number(event.target.value))} /></label>
                <label className={styles.wide}>Delivery PIN codes <small>Comma or space separated six-digit PIN codes.</small><textarea rows={3} value={postalCodes} onChange={(event) => setPostalCodes(event.target.value)} placeholder="208027, 208024" /></label>
              </div>
            </section>
            <section className={styles.panel}>
              <header><h2>Payment methods &amp; offers</h2><p>Cash and external UPI are supported by the local register.</p></header>
              <div className={styles.checks}>
                <label><input type="checkbox" checked={settings.paymentMethods.includes('cash')} onChange={(event) => set('paymentMethods', event.target.checked ? [...new Set([...settings.paymentMethods, 'cash' as const])] : settings.paymentMethods.filter((method) => method !== 'cash'))} /> Cash</label>
                <label><input type="checkbox" checked={settings.paymentMethods.includes('upi')} onChange={(event) => set('paymentMethods', event.target.checked ? [...new Set([...settings.paymentMethods, 'upi' as const])] : settings.paymentMethods.filter((method) => method !== 'upi'))} /> External UPI</label>
              </div>
              <div className={styles.grid}>
                <label>Coupon code<input maxLength={20} value={settings.couponCode} onChange={(event) => set('couponCode', event.target.value.toUpperCase())} /></label>
                <label>Coupon discount (%)<input type="number" min="0" max="100" step="0.01" value={couponPercent} onChange={(event) => setCouponPercent(event.target.value)} /></label>
                <label>Minimum coupon subtotal (₹)<input type="number" min="0" max="100000" step="0.01" value={couponMinimum} onChange={(event) => setCouponMinimum(event.target.value)} /></label>
                <label>Maximum coupon discount (₹)<input type="number" min="0" max="100000" step="0.01" value={couponMaximum} onChange={(event) => setCouponMaximum(event.target.value)} /></label>
              </div>
            </section>
            <section className={styles.panel}>
              <header><h2>GST &amp; FSSAI bill profile</h2><p>Verify these values against your registration documents.</p></header>
              {settings.billing && (
                <div className={styles.grid}>
                  <label>Legal business name<input required minLength={2} maxLength={100} value={settings.billing.businessName} onChange={(event) => set('billing', { ...settings.billing!, businessName: event.target.value })} /></label>
                  <label>GSTIN<input required pattern="09[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]" value={settings.billing.gstin} onChange={(event) => set('billing', { ...settings.billing!, gstin: event.target.value.toUpperCase() })} /></label>
                  <label className={styles.wide}>Invoice address<textarea required minLength={8} maxLength={300} rows={2} value={settings.billing.address} onChange={(event) => set('billing', { ...settings.billing!, address: event.target.value })} /></label>
                  <label>FSSAI number<input required pattern="[0-9]{14}" maxLength={14} value={settings.billing.fssaiNumber} onChange={(event) => set('billing', { ...settings.billing!, fssaiNumber: event.target.value })} /></label>
                  <p className={styles.taxNote}>CGST 2.5% + SGST 2.5% · Uttar Pradesh (09) · Per-item MRP-inclusive GST is configured in Menu &amp; Products.</p>
                </div>
              )}
            </section>
            <div className={styles.saveRow}><span>Changes take effect on new orders. Existing bills retain their saved values.</span><button className={styles.save} disabled={saving}><Save size={16} />{saving ? 'Saving…' : 'Save settings'}</button></div>
          </form>
        </section>
      </div>
    </main>
  );
}
