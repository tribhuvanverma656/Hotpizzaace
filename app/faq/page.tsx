import type { Metadata } from 'next';
import Link from 'next/link';
import { FaqItem, InfoNote, InfoPage } from '@/components/info/info-page';
import { CouponPolicy, OrderingFacts, PaymentPolicy } from '@/components/info/business-info';

export const metadata: Metadata = {
  title: 'Frequently asked questions',
  description:
    'Answers about ordering, delivery charges, coupons, payments and tracking at Hot Pizza Ace.',
};

export default function FaqPage() {
  return (
    <InfoPage
      title="Good questions. Clear answers."
      intro="Everything you need to find your way from the menu to your order details."
      currentPath="/faq"
    >
      <InfoNote>
        <p>
          <strong>This is an ordering prototype.</strong> You can try the full flow, but no
          restaurant order or real payment is made here.
        </p>
      </InfoNote>
      <FaqItem question="How do I place a demo order?">
        <p>
          Browse the <Link href="/menu">menu</Link>, choose an item and any size or extras, then add
          it to your cart. Review the total, continue to checkout, choose delivery or pickup and
          provide test contact details. Select an enabled payment method and follow the demo
          confirmation or payment simulator.
        </p>
      </FaqItem>
      <FaqItem question="Do I need to sign in?">
        <p>
          You can check out as a guest. Demo mobile sign-in makes it easier to find orders for that
          mobile number in this browser. The code shown on the sign-in page is for testing; no SMS
          is sent and it is not production account authentication.
        </p>
      </FaqItem>
      <FaqItem question="What are the delivery fee and minimum order?">
        <OrderingFacts />
        <p>
          These are the current demo settings. Your checkout summary shows the final charge, and
          pickup has no minimum order value or delivery fee. Read{' '}
          <Link href="/delivery-policy">Delivery & pickup</Link> for more details.
        </p>
      </FaqItem>
      <FaqItem question="Can I save and reuse delivery addresses?">
        <p>
          Sign in, then open <Link href="/account/addresses">Saved addresses</Link> from My orders
          or the navigation. Add, edit or remove addresses and choose a default. Checkout fills your
          default address when there is no saved checkout draft; you can choose another address
          before ordering. These details stay in this browser and do not sync to another device.
        </p>
      </FaqItem>
      <FaqItem question="How do coupons work?">
        <CouponPolicy />
        <p>Enter the code in your cart or checkout and check the savings before submitting.</p>
      </FaqItem>
      <FaqItem question="Can I pay cash on delivery?">
        <PaymentPolicy />
      </FaqItem>
      <FaqItem question="Why can’t I order right now?">
        <p>
          The kitchen may have paused new orders, delivery or pickup may be switched off, or an item
          may be unavailable. Check the banner and checkout message. Checkout also needs a valid
          configuration, the minimum delivery total when applicable, an eligible delivery postal
          code and an enabled payment method.
        </p>
      </FaqItem>
      <FaqItem question="How do I track an order?">
        <p>
          Use Track order on the confirmation screen, or open{' '}
          <Link href="/track-order">Track order</Link> from the website navigation. Guest lookup
          needs the order number and checkout mobile number. Signed-in customers can open{' '}
          <Link href="/account/orders">My orders</Link>. Status changes come from this browser’s
          admin dashboard; there is no live delivery rider location.
        </p>
      </FaqItem>
      <FaqItem question="Why is my order missing on another phone or browser?">
        <p>
          This prototype stores demo orders on the browser where they were created. They do not sync
          to a shared account or another device. Clearing site data also removes the saved history.
          The <Link href="/privacy-policy">privacy policy</Link> explains this storage.
        </p>
      </FaqItem>
      <FaqItem question="Can I change or cancel an order, or get a refund?">
        <p>
          You can update your cart before submitting. The customer interface currently has no
          cancellation button; eligible demo records can be cancelled using staff controls. No real
          payment is collected, so no real refund is processed. For an actual purchase, contact the
          restaurant or the platform you used. See{' '}
          <Link href="/refund-cancellation">Refunds & cancellations</Link>.
        </p>
      </FaqItem>
      <FaqItem question="Where is the restaurant, and who can help with ingredients?">
        <p>
          Hot Pizza Ace is in Barra, Kanpur. The <Link href="/contact">contact page</Link> has the
          address, current opening hours, phone number and map link. Contact the restaurant directly
          for ingredient and allergy information before a real purchase.
        </p>
      </FaqItem>
    </InfoPage>
  );
}
