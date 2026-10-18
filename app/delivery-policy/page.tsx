import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoNote, InfoPage } from '@/components/info/info-page';
import { BusinessContact, OrderingFacts } from '@/components/info/business-info';

export const metadata: Metadata = {
  title: 'Delivery & pickup',
  description:
    'Current demo delivery fees, service postal codes, pickup details and preparation estimates.',
};

export default function DeliveryPage() {
  return (
    <InfoPage
      title="Delivery & pickup"
      intro="Choose how you would like your order, with charges and availability visible before checkout."
      currentPath="/delivery-policy"
      sections={[
        {
          id: 'current-settings',
          title: 'Current ordering details',
          content: (
            <>
              <OrderingFacts />
              <p>
                These figures use the same restaurant settings as checkout and update when the
                dashboard settings change. The final order summary shows the charge for your
                selected fulfillment method and food subtotal. Coupon discounts do not change
                eligibility for free delivery.
              </p>
            </>
          ),
        },
        {
          id: 'delivery',
          title: 'Home delivery',
          content: (
            <p>
              When delivery is enabled, enter your name, mobile number, full address, locality and
              postal code at checkout. The demo checks the postal code against its configured
              service area. An optional landmark or short instruction can help explain an address.
              For a real order, confirm delivery coverage directly with the restaurant; this
              prototype does not dispatch a rider.
            </p>
          ),
        },
        {
          id: 'pickup',
          title: 'Pickup / takeaway',
          content: (
            <>
              <p>
                Pickup has no minimum order value and no delivery charge. When enabled, checkout
                asks for your name and mobile number without requiring a delivery address. The
                restaurant address is shown before submission. A demo confirmation does not arrange
                an actual pickup.
              </p>
              <BusinessContact />
            </>
          ),
        },
        {
          id: 'timing',
          title: 'Preparation and availability',
          content: (
            <p>
              Preparation time is an estimate, not a promised arrival time. Kitchen status, delivery
              and pickup can be paused separately in the dashboard. When ordering is paused, you may
              browse the menu but cannot place a new demo order. Existing order status is shown
              under <Link href="/track-order">Track order</Link>; this is staff status tracking
              within the same browser, not a live rider map.
            </p>
          ),
        },
      ]}
    >
      <InfoNote>
        <p>
          <strong>This is a local demo.</strong> Delivery fees and pickup choices can be tested, but
          no real delivery or collection is scheduled here.
        </p>
      </InfoNote>
    </InfoPage>
  );
}
