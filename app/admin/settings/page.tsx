'use client';
import { useState } from 'react';
import { Save, Store, Truck, Gift, CreditCard, Clock, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useDemoStore } from '@/lib/store';
import { money } from '@/lib/utils';
import type { RestaurantSettings } from '@/types';
import { PageHeading } from '@/components/admin/shared';
import styles from './kitchen-settings.module.css';

function getKitchenStatus(
  settings: Pick<
    RestaurantSettings,
    'acceptingOrders' | 'temporarilyClosed' | 'deliveryEnabled' | 'pickupEnabled'
  >,
) {
  if (settings.temporarilyClosed)
    return {
      open: false,
      title: 'Temporarily closed',
      description: `Temporary closure overrides Accepting orders. Turn off Temporarily closed${
        !settings.acceptingOrders ? ' and turn on Accepting orders' : ''
      }${
        !settings.deliveryEnabled && !settings.pickupEnabled
          ? ', then enable delivery or pickup'
          : ''
      } to reopen.`,
    };
  if (!settings.acceptingOrders)
    return {
      open: false,
      title: 'New orders paused',
      description: `Accepting orders is off. Turn it on${
        !settings.deliveryEnabled && !settings.pickupEnabled ? ' and enable delivery or pickup' : ''
      } to resume new orders.`,
    };
  if (!settings.deliveryEnabled && !settings.pickupEnabled)
    return {
      open: false,
      title: 'Delivery and pickup disabled',
      description: 'Enable home delivery or pickup to accept new orders.',
    };
  return {
    open: true,
    title: 'Accepting new orders',
    description: `Customers can order for ${
      settings.deliveryEnabled && settings.pickupEnabled
        ? 'delivery or pickup'
        : settings.deliveryEnabled
          ? 'delivery'
          : 'pickup'
    }.`,
  };
}

export default function SettingsPage() {
  const { settings: customerSettings, branches, adminBranchId, updateSettings } = useDemoStore();
  const settings =
    branches.find((branch) => branch.id === adminBranchId)?.settings ?? customerSettings;
  const [draft, setDraft] = useState<RestaurantSettings>({ ...settings });
  const [postalCodes, setPostalCodes] = useState(settings.servicePostalCodes.join(', '));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const savedKitchenStatus = getKitchenStatus(settings);
  const draftKitchenStatus = getKitchenStatus(draft);
  const kitchenChanged = (
    ['acceptingOrders', 'temporarilyClosed', 'deliveryEnabled', 'pickupEnabled'] as const
  ).some((key) => settings[key] !== draft[key]);
  const set = <K extends keyof RestaurantSettings>(key: K, value: RestaurantSettings[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };
  const moneyField = (
    key: 'deliveryFee' | 'minimumOrder' | 'couponMinimum' | 'couponMaximum',
    label: string,
  ) => (
    <label className="field">
      {label} (₹)
      <input
        required
        type="number"
        min="0"
        max="100000"
        step="0.01"
        value={draft[key] / 100}
        onChange={(e) => set(key, Math.round(Number(e.target.value) * 100))}
      />
    </label>
  );
  const toggle = (
    key: 'acceptingOrders' | 'temporarilyClosed' | 'deliveryEnabled' | 'pickupEnabled',
    label: string,
    description: string,
  ) => (
    <label className="admin-checkbox">
      <input type="checkbox" checked={draft[key]} onChange={(e) => set(key, e.target.checked)} />
      <span>
        {label}
        <small>{description}</small>
      </span>
    </label>
  );
  const kitchenSwitch = (
    key: 'acceptingOrders' | 'temporarilyClosed',
    label: string,
    description: string,
  ) => (
    <label
      className={`${styles.switchRow} ${key === 'temporarilyClosed' ? styles.closureSwitch : ''}`}
    >
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        aria-describedby={`${key}-description`}
        checked={draft[key]}
        onChange={(e) => set(key, e.target.checked)}
      />
      <span className={styles.switchTrack} aria-hidden="true" />
      <span className={styles.switchCopy}>
        <strong>{label}</strong>
        <small id={`${key}-description`}>{description}</small>
      </span>
      <b className={styles.switchState} aria-hidden="true">
        {draft[key] ? 'On' : 'Off'}
      </b>
    </label>
  );
  return (
    <>
      <PageHeading
        eyebrow="THE DETAILS MAKE THE DIFFERENCE"
        title="Restaurant settings"
        description="Set up your restaurant, your service area, and your next great offer."
      />
      <form
        className="admin-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          const codes = postalCodes
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          if (draft.name.trim().length < 2 || draft.address.trim().length < 8) {
            setError('Enter a restaurant name and complete address.');
            return;
          }
          if (
            !/^[6-9]\d{9}$/.test(draft.phone.replace(/[\s+-]/g, '').replace(/^91(?=\d{10}$)/, ''))
          ) {
            setError('Enter a valid Indian mobile number (10 digits, optionally +91).');
            return;
          }
          if (!draft.openingHours.trim()) {
            setError('Opening hours are required.');
            return;
          }
          if (
            draft.deliveryEnabled &&
            (!codes.length || codes.some((code) => !/^\d{6}$/.test(code)))
          ) {
            setError('Delivery needs at least one valid six-digit service postal code.');
            return;
          }
          if (
            !draft.deliveryEnabled &&
            !draft.pickupEnabled &&
            draft.acceptingOrders &&
            !draft.temporarilyClosed
          ) {
            setError('Enable delivery or pickup before accepting orders.');
            return;
          }
          if (!draft.paymentMethods.length) {
            setError('Choose at least one payment method.');
            return;
          }
          if (draft.couponCode && !/^[A-Z0-9]{3,20}$/.test(draft.couponCode)) {
            setError('Coupon code must contain 3–20 uppercase letters or numbers.');
            return;
          }
          if (
            !Number.isFinite(draft.preparationMinutes) ||
            draft.preparationMinutes < 5 ||
            draft.preparationMinutes > 180
          ) {
            setError('Preparation time must be between 5 and 180 minutes.');
            return;
          }
          if (
            !Number.isFinite(draft.couponPercent) ||
            draft.couponPercent < 0 ||
            draft.couponPercent > 100
          ) {
            setError('Coupon discount must be between 0% and 100%.');
            return;
          }
          try {
            updateSettings({
              ...draft,
              name: draft.name.trim(),
              address: draft.address.trim(),
              servicePostalCodes: [...new Set(codes)],
            });
            toast.success('Restaurant settings saved');
            setSaved(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save settings.');
          }
        }}
      >
        <div className="admin-settings-grid">
          <div>
            <section className="admin-card">
              <div className="admin-card-heading">
                <h2>
                  <Store size={18} /> Restaurant profile
                </h2>
              </div>
              <div className="admin-card-padding admin-form">
                <label className="field">
                  Restaurant name
                  <input
                    required
                    maxLength={80}
                    value={draft.name}
                    onChange={(e) => set('name', e.target.value)}
                  />
                </label>
                <label className="field">
                  Restaurant address
                  <textarea
                    required
                    rows={3}
                    maxLength={500}
                    value={draft.address}
                    onChange={(e) => set('address', e.target.value)}
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    Contact phone
                    <input
                      type="tel"
                      required
                      value={draft.phone}
                      onChange={(e) => set('phone', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Opening hours
                    <input
                      required
                      value={draft.openingHours}
                      onChange={(e) => set('openingHours', e.target.value)}
                      placeholder="Daily, 11 AM – 11 PM"
                    />
                  </label>
                </div>
              </div>
            </section>
            <section className="admin-card admin-section-gap">
              <div className="admin-card-heading">
                <h2>
                  <Truck size={18} /> Delivery & pickup
                </h2>
              </div>
              <div className="admin-card-padding admin-form">
                {toggle(
                  'deliveryEnabled',
                  'Home delivery',
                  'Offer delivery within the service postal codes below.',
                )}
                <label className="field">
                  Service postal codes
                  <textarea
                    rows={2}
                    value={postalCodes}
                    onChange={(e) => {
                      setPostalCodes(e.target.value);
                      setSaved(false);
                    }}
                    placeholder="208027"
                  />
                  <small>
                    Separate six-digit Indian postal codes with commas. Demo coverage only.
                  </small>
                </label>
                <div className="form-grid">
                  {moneyField(
                    'deliveryFee',
                    draft.freeDeliveryThreshold === null
                      ? 'Delivery fee'
                      : 'Delivery fee below free-delivery subtotal',
                  )}
                  {moneyField('minimumOrder', 'Minimum delivery total')}
                </div>
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.freeDeliveryThreshold !== null}
                    onChange={(e) => set('freeDeliveryThreshold', e.target.checked ? 25000 : null)}
                  />
                  <span>
                    Free delivery from a minimum food subtotal
                    <small>
                      Waive the delivery fee when the food subtotal reaches this amount.
                    </small>
                  </span>
                </label>
                {draft.freeDeliveryThreshold !== null && (
                  <label className="field">
                    Free delivery from food subtotal (₹)
                    <input
                      required
                      type="number"
                      min="0"
                      max="100000"
                      step="0.01"
                      value={draft.freeDeliveryThreshold / 100}
                      onChange={(e) =>
                        set('freeDeliveryThreshold', Math.round(Number(e.target.value) * 100))
                      }
                    />
                    <small>
                      Orders of {money(draft.freeDeliveryThreshold)} or more qualify before coupon
                      discounts. Below this subtotal, delivery costs {money(draft.deliveryFee)}.
                    </small>
                  </label>
                )}
                <p className="admin-inline-note">
                  The minimum delivery total includes the delivery fee and applies after coupon
                  discounts. The free delivery threshold still uses food subtotal before coupons.
                  Pickup has no delivery fee and no minimum order value.
                </p>
                <hr />
                {toggle(
                  'pickupEnabled',
                  'Pickup / takeaway',
                  'Allow customers to collect their order from the restaurant.',
                )}
                <label className="field">
                  Estimated preparation time (minutes)
                  <input
                    required
                    type="number"
                    min="5"
                    max="180"
                    step="1"
                    value={draft.preparationMinutes}
                    onChange={(e) => set('preparationMinutes', Number(e.target.value))}
                  />
                </label>
              </div>
            </section>
          </div>
          <div>
            <section className="admin-card">
              <div className="admin-card-heading">
                <h2>
                  <Clock size={18} /> Kitchen availability
                </h2>
              </div>
              <div className="admin-card-padding admin-form">
                <div
                  className={`${styles.status} ${savedKitchenStatus.open ? styles.open : styles.closed}`}
                  aria-live="polite"
                >
                  <span>Current saved status</span>
                  <strong>{savedKitchenStatus.title}</strong>
                  <p>{savedKitchenStatus.description}</p>
                </div>
                {kitchenSwitch(
                  'acceptingOrders',
                  'Accepting orders',
                  'On allows new orders. Off pauses new orders.',
                )}
                {kitchenSwitch(
                  'temporarilyClosed',
                  'Temporarily closed',
                  'On closes checkout and overrides Accepting orders.',
                )}
                {kitchenChanged && (
                  <div className={styles.preview} role="status">
                    <span>Unsaved preview</span>
                    <strong>{draftKitchenStatus.title}</strong>
                    <p>{draftKitchenStatus.description}</p>
                  </div>
                )}
                <p className="admin-inline-note">
                  Switch changes take effect after you save settings. Opening hours are displayed
                  for customers; they do not automatically open or close checkout.
                </p>
                <button className="btn btn-primary" type="submit">
                  <Save size={17} /> Save settings
                </button>
                <p className="admin-inline-note">
                  Existing orders remain manageable while the kitchen is paused or temporarily
                  closed.
                </p>
              </div>
            </section>
            <section className="admin-card admin-section-gap">
              <div className="admin-card-heading">
                <h2>
                  <CreditCard size={18} /> Payment options
                </h2>
              </div>
              <div className="admin-card-padding admin-form">
                {(
                  [
                    { id: 'upi', name: 'UPI (simulated)' },
                    { id: 'card', name: 'Debit / credit card (simulated)' },
                    { id: 'cash', name: 'Enable Cash on Delivery (COD)' },
                  ] as const
                ).map((method) => (
                  <label key={method.id} className="admin-checkbox">
                    <input
                      type="checkbox"
                      checked={draft.paymentMethods.includes(method.id)}
                      onChange={(e) =>
                        set(
                          'paymentMethods',
                          e.target.checked
                            ? [...draft.paymentMethods, method.id]
                            : draft.paymentMethods.filter((m) => m !== method.id),
                        )
                      }
                    />
                    <span>
                      {method.name}
                      {method.id === 'cash' && (
                        <small>
                          Turn off to remove cash from delivery and pickup checkout. Existing orders
                          stay unchanged. Save settings to apply.
                        </small>
                      )}
                    </span>
                  </label>
                ))}
                <p className="admin-inline-note">
                  UPI and card payments use explicit demo states. No credentials or actual money
                  transfers are involved.
                </p>
              </div>
            </section>
            <section className="admin-card admin-section-gap">
              <div className="admin-card-heading">
                <h2>
                  <Gift size={18} /> Coupon rules
                </h2>
              </div>
              <div className="admin-card-padding admin-form">
                <div className="form-grid">
                  <label className="field">
                    Coupon code
                    <input
                      value={draft.couponCode}
                      maxLength={20}
                      onChange={(e) =>
                        set('couponCode', e.target.value.toUpperCase().replace(/\s/g, ''))
                      }
                      placeholder="Empty to disable"
                    />
                  </label>
                  <label className="field">
                    Discount (%)
                    <input
                      required
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={draft.couponPercent}
                      onChange={(e) => set('couponPercent', Number(e.target.value))}
                    />
                  </label>
                </div>
                <div className="form-grid">
                  {moneyField('couponMinimum', 'Minimum subtotal')}
                  {moneyField('couponMaximum', 'Maximum discount')}
                </div>
                <small className="muted">
                  Coupon applies to the food subtotal. Clear the code to disable the promotion.
                  Changes appear on the homepage, cart, and checkout after you save settings.
                </small>
              </div>
            </section>
          </div>
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="admin-form-footer">
          {saved && (
            <span className="admin-saved">
              <CircleCheck size={17} /> All changes saved locally
            </span>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setDraft({ ...settings });
              setPostalCodes(settings.servicePostalCodes.join(', '));
              setError('');
              setSaved(false);
              toast.info('Unsaved changes discarded');
            }}
          >
            Discard changes
          </button>
          <button className="btn btn-primary" type="submit">
            <Save size={17} /> Save settings
          </button>
        </div>
      </form>
    </>
  );
}
