import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage } from '@/components/info/info-page';
import { BusinessContact } from '@/components/info/business-info';
import { GrievanceContact } from '@/components/business-identity';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Call Hot Pizza Ace or find the restaurant in Barra, Kanpur. View current opening hours and directions.',
};

export default function ContactPage() {
  return (
    <InfoPage
      title="Let’s talk pizza."
      intro="For restaurant enquiries, ingredients or directions, get in touch directly."
      currentPath="/contact"
      sections={[
        { id: 'details', title: 'Your selected branch', content: <BusinessContact /> },
        {
          id: 'orders',
          title: 'Looking for an order?',
          content: (
            <p>
              For a connected order record created on this website, use{' '}
              <Link href="/track-order">Track order</Link> or{' '}
              <Link href="/account/orders">My orders</Link> with the account used at checkout. Guest
              orders use their original browser session or private tracking link; a separate local
              demo’s orders stay in that browser. For an actual purchase made directly with the
              restaurant, call with your order reference. For a purchase through another platform,
              use its order support.
            </p>
          ),
        },
        {
          id: 'support',
          title: 'Website and privacy questions',
          content: (
            <p>
              The <Link href="/faq">FAQs</Link> explain Google sign-in, checkout and order history.
              Read the <Link href="/privacy-policy">privacy policy</Link> for connected storage,
              local drafts and data controls. For general website or privacy questions, email{' '}
              <a href="mailto:hotpizzaace@gmail.com">hotpizzaace@gmail.com</a>. Live ordering is
              currently paused and online payments are not available. Separate development testing
              may include simulated payments.
            </p>
          ),
        },
        {
          id: 'grievances',
          title: 'Customer grievances',
          content: (
            <>
              <p>For complaints about the website or restaurant service, use the contact below.</p>
              <GrievanceContact />
            </>
          ),
        },
      ]}
    />
  );
}
