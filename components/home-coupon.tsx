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
      <span>A LITTLE EXTRA HAPPINESS</span>
      <h3>
        A little treat
        <br />
        on the house.
      </h3>
      <p>
        {active
          ? 'Try our demo coupon at checkout.'
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
            Illustrative demo offer.
          </small>
        </>
      ) : (
        <div className="coupon-code">
          SAY CHEESE!<span>MADE FRESH</span>
        </div>
      )}
      <Link href="/menu">
        Make it a pizza night <ArrowRight size={17} />
      </Link>
    </div>
  );
}
