'use client';
import { useDemoStore } from '@/lib/store';
import { money } from '@/lib/utils';

export function HomeServiceFacts() {
  const settings = useDemoStore((state) => state.settings);
  const delivery =
    settings.deliveryFee === 0
      ? 'Free delivery'
      : settings.freeDeliveryThreshold !== null
        ? `${money(settings.freeDeliveryThreshold)}+`
        : money(settings.deliveryFee);
  return (
    <div className="home-service-facts" aria-label="Ordering information">
      {settings.deliveryEnabled && (
        <div>
          <strong>{delivery}</strong>
          <span>
            {settings.deliveryFee === 0
              ? 'Within our delivery area'
              : settings.freeDeliveryThreshold !== null
                ? 'For free delivery, before coupons'
                : 'Delivery charge'}
          </span>
        </div>
      )}
      <div>
        <strong>{settings.preparationMinutes} min</strong>
        <span>Estimated preparation time</span>
      </div>
    </div>
  );
}
