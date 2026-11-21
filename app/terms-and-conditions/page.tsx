import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoNote, InfoPage } from '@/components/info/info-page';
import { BusinessIdentity, GrievanceContact } from '@/components/business-identity';

export const metadata: Metadata = {
  title: 'Terms & conditions',
  description:
    'Terms for using the Hot Pizza Ace website, account features, menu and current prelaunch service.',
};

export default function TermsPage() {
  return (
    <InfoPage
      title="Terms & conditions"
      intro="Please read these details before using the menu, account and checkout features."
      currentPath="/terms-and-conditions"
      updated="23 October 2026"
      sections={[
        {
          id: 'service',
          title: 'The website and current service',
          content: (
            <>
              <p>
                Hot Pizza Ace provides this website at{' '}
                <a href="https://hotpizzaace.com">hotpizzaace.com</a>. You can browse restaurant
                information and the menu and use available account features. Live restaurant
                ordering and payments are not yet available on the public website. Browsing a menu,
                signing in or saving an address does not reserve food or arrange delivery or pickup.
              </p>
              <BusinessIdentity branchId="barra" />
              <p>
                Separate development testing may enable test checkouts and simulated payment
                outcomes. A test confirmation does not create a real purchase, schedule food
                preparation or fulfillment, or show that money was paid. A test receipt is not a tax
                invoice. Connected test records may be stored on the server; a separately labelled
                local demo keeps its test records in the browser.
              </p>
            </>
          ),
        },
        {
          id: 'menu-and-prices',
          title: 'Menu, availability and prices',
          content: (
            <>
              <p>
                Prices are displayed in Indian rupees. Sizes, crusts, toppings and quantities change
                the price shown before adding an item. The cart and checkout show the current food
                subtotal, applicable delivery charge, coupon savings and total. Menu images show
                dishes for reference; presentation may vary.
              </p>
              <p>
                The website applies the menu and availability configured in its admin dashboard. An
                unavailable item or paused kitchen can prevent checkout. Existing order receipts
                retain their original item and price snapshots when the menu changes. Confirm actual
                availability, ingredients and allergy questions directly with the restaurant before
                making a purchase. A preparation or delivery estimate is not an arrival guarantee.
              </p>
            </>
          ),
        },
        {
          id: 'checkout',
          title: 'Checkout and payments',
          content: (
            <>
              <p>
                The public website does not currently accept online payments or live orders. It does
                not collect card numbers, bank details or a UPI PIN. Development payment success,
                failure and retry screens are simulations, and cash choices in testing do not
                arrange an actual cash delivery or collection. Where Razorpay test checkout is
                enabled on the separate development website, it is labelled as a test payment and
                does not transfer real money. A browser success message alone does not confirm a
                payment: the server verifies its payment reference, amount and captured status.
              </p>
              <p>
                Where a test checkout is enabled, delivery eligibility, minimum order, fees and
                coupons are checked against the current branch settings. A delivery minimum uses the
                final total including the delivery charge and after coupon discounts. Free-delivery
                eligibility uses the food subtotal before coupon discounts. Pickup has no delivery
                charge or minimum order value. The postal code must be in the selected branch’s
                service area for delivery.
              </p>
              <p>
                Review the displayed items, contact details, selected branch and total before
                continuing. Coupon eligibility and availability may change before submission; an
                existing receipt preserves the prices and discounts recorded for that order. Read
                the <Link href="/delivery-policy">delivery and pickup details</Link> and{' '}
                <Link href="/refund-cancellation">refund and cancellation information</Link>.
              </p>
            </>
          ),
        },
        {
          id: 'accounts',
          title: 'Accounts and order history',
          content: (
            <>
              <p>
                Google sign-in uses your Google account to establish your Hot Pizza Ace account.
                Keep your account secure and sign out on shared devices. Provide accurate contact
                details and only information you are entitled to use. Do not use the website to
                access another person’s account or records, disrupt the service or submit abusive
                content.
              </p>
              <p>
                Saved account addresses and any orders submitted while signed in can be retrieved on
                another device using the same account. Where guest checkout is enabled, guest access
                uses the browser’s guest session or a private tracking link; keep that link private.
                A contact mobile number alone does not establish account ownership. Clearing browser
                data, signing out or removing Google access does not delete server records. Removing
                a saved address does not change an existing order receipt.
              </p>
              <p>
                Public test-code mobile sign-in, when shown in the separate local demo, applies only
                to that browser’s demo records. The{' '}
                <Link href="/privacy-policy">privacy policy</Link> explains Google account
                permissions, connected storage, service providers and how to request access,
                correction or deletion of personal information.
              </p>
            </>
          ),
        },
        {
          id: 'live-service',
          title: 'Before real ordering is launched',
          content: (
            <p>
              We will explain the applicable order acceptance, payment, delivery and cancellation
              arrangements before enabling live restaurant ordering. Current test payment and
              fulfillment results do not establish those arrangements. Nothing in these terms
              removes rights available under applicable law.
            </p>
          ),
        },
        {
          id: 'contact',
          title: 'Contact and updates',
          content: (
            <>
              <p>
                Email Hot Pizza Ace at{' '}
                <a href="mailto:hotpizzaace@gmail.com">hotpizzaace@gmail.com</a> for website,
                account or service questions. Visit <Link href="/contact">Contact</Link> for the
                restaurant’s phone number, opening hours and map, or browse the{' '}
                <Link href="/faq">frequently asked questions</Link>. Orders made through another
                service are handled through that service’s own order and support process.
              </p>
              <GrievanceContact />
              <p>
                We may update these terms as the service changes. The date above identifies the
                current version, and material changes will be explained before they take effect.
                Changes to Google account data access or use are also subject to the notice and
                consent commitments in our <Link href="/privacy-policy">privacy policy</Link>.
              </p>
            </>
          ),
        },
      ]}
    >
      <InfoNote>
        <p>
          <strong>Live ordering and payments are not yet available on hotpizzaace.com.</strong>{' '}
          Google sign-in and saved addresses can store real information. Separate development tests
          do not place real restaurant orders or collect payments.
        </p>
      </InfoNote>
    </InfoPage>
  );
}
