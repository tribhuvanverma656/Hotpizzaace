import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoNote, InfoPage } from '@/components/info/info-page';
import { BusinessContact, OrderingFacts } from '@/components/info/business-info';

export const metadata: Metadata = {
  title: 'Delivery & pickup',
  description:
    'Current delivery settings, pickup details, connected order tracking and development availability.',
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
              postal code at checkout. The connected service checks the postal code against its
              configured service area. An optional landmark or short instruction can help explain an
              address. For a real order, confirm delivery coverage directly with the restaurant;
              this development website does not dispatch a rider.
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
                an actual pickup. An enabled connected test checkout still saves its order and
                contact details on the server.
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
              browse the menu but cannot submit a new order. Existing connected order status is
              shown under <Link href="/track-order">Track order</Link>. Orders placed while signed
              in can be opened through the same account on another device; guest orders use the
              original browser session or a private tracking link. Staff updates to connected orders
              are stored on the server. Tracking does not show a live rider location. A separate
              local demo’s order statuses remain in its browser.
            </p>
          ),
        },
      ]}
    >
      <InfoNote>
        <p>
          <strong>Live ordering is paused while development continues.</strong> Delivery and pickup
          settings describe the checkout rules, not a promise of current fulfillment. Connected test
          orders are stored on the server, payment simulations or Razorpay test payments do not
          charge real money, and no real delivery or collection is scheduled by a test confirmation.
        </p>
      </InfoNote>
    </InfoPage>
  );
}
