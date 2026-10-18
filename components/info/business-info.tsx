'use client';
import { SocialLinks } from '@/components/social-links';

import { Clock, MapPin, Phone, ArrowUpRight } from 'lucide-react';
import { useDemoStore } from '@/lib/store';
import { isCouponActive } from '@/lib/pricing';
import { money } from '@/lib/utils';
import styles from './info-page.module.css';

export function BusinessContact() {
  const { settings, selectedBranchId, branches } = useDemoStore();
  const branch = branches.find((branch) => branch.id === selectedBranchId);
  const restaurantMap =
    selectedBranchId === 'barra'
      ? 'https://share.google/JKBLLOUz7KItONQEb'
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(settings.address)}`;
  const telephone = settings.phone.replace(/[^+\d]/g, '');
  return (
    <div className={styles.businessCard}>
      <h3>{settings.name}</h3>
      <p>{branch?.name}</p>
      <dl className={styles.contactList}>
        <div>
          <dt>
            <MapPin size={19} aria-hidden="true" /> Visit us
          </dt>
          <dd>{settings.address}</dd>
        </div>
        <div>
          <dt>
            <Phone size={19} aria-hidden="true" /> Call the restaurant
          </dt>
          <dd>
            <a href={`tel:${telephone}`}>{settings.phone}</a>
          </dd>
        </div>
        <div>
          <dt>
            <Clock size={19} aria-hidden="true" /> Opening hours
          </dt>
          <dd>{settings.openingHours}</dd>
        </div>
      </dl>
      <div className={styles.contactActions}>
        <a href={`tel:${telephone}`}>Call restaurant</a>
        <a href={restaurantMap} target="_blank" rel="noopener noreferrer">
          Open in Google Maps <ArrowUpRight size={18} aria-hidden="true" />
        </a>
      </div>
      <SocialLinks />
    </div>
  );
}

/** Read the same settings as checkout, so policy figures do not drift from the dashboard. */
export function OrderingFacts() {
  const settings = useDemoStore((state) => state.settings);
  const freeDelivery = settings.freeDeliveryThreshold;
  return (
    <dl className={styles.facts}>
      <div>
        <dt>Delivery charge</dt>
        <dd>
          {settings.deliveryFee === 0
            ? 'Free delivery'
            : freeDelivery === null
              ? money(settings.deliveryFee)
              : `${money(settings.deliveryFee)} below ${money(freeDelivery)}; free from ${money(freeDelivery)}`}
        </dd>
      </div>
      {settings.deliveryFee > 0 && freeDelivery !== null && (
        <div>
          <dt>Free delivery calculation</dt>
          <dd>Food subtotal before coupon discounts</dd>
        </div>
      )}
      <div>
        <dt>Minimum delivery total</dt>
        <dd>{money(settings.minimumOrder)}, including delivery and after coupon discounts</dd>
      </div>
      <div>
        <dt>Pickup</dt>
        <dd>No minimum order value and no delivery charge</dd>
      </div>
      <div>
        <dt>Demo delivery postal codes</dt>
        <dd>{settings.servicePostalCodes.join(', ') || 'No delivery area configured'}</dd>
      </div>
      <div>
        <dt>Preparation estimate</dt>
        <dd>About {settings.preparationMinutes} minutes; this is not an arrival guarantee</dd>
      </div>
      <div>
        <dt>Ordering availability</dt>
        <dd>
          {!settings.acceptingOrders || settings.temporarilyClosed
            ? 'Ordering is currently paused'
            : !settings.deliveryEnabled && !settings.pickupEnabled
              ? 'Delivery and pickup are currently unavailable'
              : [settings.deliveryEnabled ? 'Delivery' : '', settings.pickupEnabled ? 'Pickup' : '']
                  .filter(Boolean)
                  .join(' and ')}
        </dd>
      </div>
    </dl>
  );
}

export function PaymentPolicy() {
  const methods = useDemoStore((state) => state.settings.paymentMethods);
  const labels = { upi: 'UPI', card: 'debit / credit card', cash: 'cash at handover' };
  return (
    <p>
      {methods.length
        ? `The methods currently enabled in this demo are ${methods.map((method) => labels[method]).join(', ')}.`
        : 'No payment methods are currently enabled, so checkout is unavailable.'}{' '}
      Online payments are simulations. Cash on delivery or pickup only appears when enabled by the
      restaurant in the dashboard. No payment is collected and no cash delivery is scheduled by this
      prototype.
    </p>
  );
}

export function CouponPolicy() {
  const settings = useDemoStore((state) => state.settings);
  return (
    <p>
      {isCouponActive(settings) ? (
        <>
          The current demo code is <strong>{settings.couponCode}</strong>: {settings.couponPercent}%
          off a food subtotal of {money(settings.couponMinimum)} or more, up to{' '}
          {money(settings.couponMaximum)} off.
        </>
      ) : (
        'There is currently no active coupon.'
      )}{' '}
      Coupons reduce the food subtotal, not the delivery charge. The code and rules shown at
      checkout reflect the current dashboard settings; an invalid or no longer eligible coupon is
      removed when those settings or the cart change.
    </p>
  );
}
