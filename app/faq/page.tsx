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
          <strong>Live ordering is paused while development continues.</strong> Account sign-in,
          saved addresses and connected order records use cloud storage. Online payments are
          simulated, and a test confirmation does not schedule restaurant fulfillment.
        </p>
      </InfoNote>
      <FaqItem question="How does checkout work during development?">
        <p>
          Browse the <Link href="/menu">menu</Link>, choose an item and any size or extras, then add
          it to your cart. Review the total, continue to checkout, choose delivery or pickup and
          provide test contact details. When ordering is paused, checkout cannot be submitted. An
          enabled connected test checkout saves the order on the server; follow its confirmation or
          payment simulator. No money is collected.
        </p>
      </FaqItem>
      <FaqItem question="Do I need to sign in?">
        <p>
          Guest checkout is supported when ordering is enabled. Continue with Google to use a
          connected account, retrieve orders placed while signed in and save addresses across
          devices. A separate browser-local demo may offer a publicly displayed mobile test code;
          that code sends no SMS and does not authenticate a connected account.
        </p>
      </FaqItem>
      <FaqItem question="What are the delivery fee and minimum order?">
        <OrderingFacts />
        <p>
          These are the current configured settings. Your checkout summary shows the final charge,
          and pickup has no minimum order value or delivery fee. Read{' '}
          <Link href="/delivery-policy">Delivery & pickup</Link> for more details.
        </p>
      </FaqItem>
      <FaqItem question="Can I save and reuse delivery addresses?">
        <p>
          Sign in, then open <Link href="/account/addresses">Saved addresses</Link> from My orders
          or the navigation. Add, edit or remove addresses and choose a default. Checkout fills your
          default address when there is no saved checkout draft; you can choose another address
          before ordering. In the connected website, saved addresses belong to your signed-in
          account and can be used on another device with the same account. Editing or removing an
          address does not rewrite an existing order receipt. Addresses in a separately labelled
          local demo stay in that demo’s browser.
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
          <Link href="/track-order">Track order</Link> from the website navigation. Connected guest
          orders use the browser session where they were placed or their private tracking link. Keep
          that link private: anyone with it can view the order. Signed-in customers can open{' '}
          <Link href="/account/orders">My orders</Link> on another device using the same account.
          Authorized staff updates are stored on the server; tracking does not show a live delivery
          rider location.
        </p>
      </FaqItem>
      <FaqItem question="Why is my order missing on another phone or browser?">
        <p>
          Sign in to the same Google account used when placing the order. Orders placed as a guest
          use the original browser’s guest session or their private tracking link; signing in later
          does not make them orders placed with that account. A separate local demo’s records do not
          sync across devices. Clearing browser data can remove local access, but it does not delete
          connected cloud orders. The <Link href="/privacy-policy">privacy policy</Link> explains
          this storage.
        </p>
      </FaqItem>
      <FaqItem question="Can I change or cancel an order, or get a refund?">
        <p>
          You can update your cart before submitting. For an unpaid online order awaiting
          confirmation, use Cancel order on the tracking page in the original ordering browser or
          account. For paid or accepted orders and refund requests, contact the restaurant. See{' '}
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
