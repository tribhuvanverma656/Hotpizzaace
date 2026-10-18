import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoNote, InfoPage } from '@/components/info/info-page';
import { PaymentPolicy } from '@/components/info/business-info';

export const metadata: Metadata = {
  title: 'Terms & conditions',
  description: 'Terms for using the current Hot Pizza Ace menu and local ordering demonstration.',
};

export default function TermsPage() {
  return (
    <InfoPage
      title="Terms & conditions"
      intro="Please read these details before using the menu, cart and checkout demonstration."
      currentPath="/terms-and-conditions"
      updated="17 October 2026"
      sections={[
        {
          id: 'demo',
          title: 'Using the demonstration',
          content: (
            <p>
              The current Hot Pizza Ace website lets you browse a menu and test a browser-local
              ordering flow. Submitting checkout creates a demo record on this device. It does not
              send an order to a kitchen, reserve food, arrange delivery or create a real purchase.
              A demo receipt is not a tax invoice or evidence of payment.
            </p>
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
                The demo applies the menu and availability configured in its admin dashboard. An
                unavailable item or paused kitchen can prevent checkout. Existing demo receipts
                retain their original item and price snapshots when the menu changes. Confirm actual
                availability, ingredients and allergy questions directly with the restaurant before
                making a real purchase elsewhere.
              </p>
            </>
          ),
        },
        {
          id: 'checkout',
          title: 'Checkout and payments',
          content: (
            <>
              <PaymentPolicy />
              <p>
                Delivery eligibility, minimum order, fees and coupons are checked against the
                current settings at checkout. Please review your choices and total before
                continuing. Read the{' '}
                <Link href="/delivery-policy">delivery and pickup details</Link> and{' '}
                <Link href="/refund-cancellation">refund and cancellation information</Link>.
              </p>
            </>
          ),
        },
        {
          id: 'accounts',
          title: 'Demo sign-in and order history',
          content: (
            <p>
              Mobile sign-in uses a publicly displayed demo code and sends no SMS. It filters orders
              stored in this browser by mobile number; it is not a verified customer account or
              secure production authentication. Clearing browser site data removes saved demo
              history. The <Link href="/privacy-policy">privacy policy</Link> explains what is
              stored and how to remove it.
            </p>
          ),
        },
        {
          id: 'live-service',
          title: 'Before real ordering is launched',
          content: (
            <p>
              Live ordering terms require confirmation of the operating legal entity, applicable
              business disclosures, support and grievance contacts, taxes, payment providers,
              delivery commitments and cancellation/refund process. Those details have not been
              established by this demonstration. Nothing on these pages is intended to limit any
              rights available under applicable law.
            </p>
          ),
        },
        {
          id: 'contact',
          title: 'Need help?',
          content: (
            <p>
              Visit <Link href="/contact">Contact</Link> for the restaurant’s phone number, opening
              hours and map, or browse the <Link href="/faq">frequently asked questions</Link>.
              Orders made through another service are handled through that service’s own order and
              support process.
            </p>
          ),
        },
      ]}
    >
      <InfoNote>
        <p>
          <strong>Demo checkout only.</strong> No money is charged and no food is ordered through
          this version of the website.
        </p>
      </InfoNote>
    </InfoPage>
  );
}
