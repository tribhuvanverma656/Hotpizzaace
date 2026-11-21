'use client';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useDemoStore } from '@/lib/store';
import { isCouponActive } from '@/lib/pricing';
import { money } from '@/lib/utils';
export function HomeCoupon() {
  const settings = useDemoStore((state) => state.settings);
  const active = isCouponActive(settings);
  return (
    <div className="coupon-card">
      <span>OFFERS & COMBOS</span>
      <h3>
        Explore our
        <br />
        latest offers.
      </h3>
      <p>
        {active
          ? 'Apply this coupon at checkout.'
          : 'Find something delicious for your next pizza night.'}
      </p>
      {active ? (
        <>
          <div className="coupon-code">
            {settings.couponCode}
            <span>{settings.couponPercent}% OFF</span>
          </div>
          <small>
            Orders {money(settings.couponMinimum)}+ · Up to {money(settings.couponMaximum)} off
            <br />
            Discount shown before payment.
          </small>
        </>
      ) : (
        <div className="coupon-code">
          EXPLORE COMBOS<span>MADE FRESH</span>
        </div>
      )}
      <Link href="/menu">
        Make it a pizza night <ArrowRight size={17} />
      </Link>
    </div>
  );
}
