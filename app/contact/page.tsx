import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage } from '@/components/info/info-page';
import { BusinessContact } from '@/components/info/business-info';

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
              For a demo order created on this website, use{' '}
              <Link href="/track-order">Track order</Link> or{' '}
              <Link href="/account/orders">My orders</Link> on the same browser. For an actual
              purchase made directly with the restaurant, call with your order reference. For a
              purchase through another platform, use its order support.
            </p>
          ),
        },
        {
          id: 'support',
          title: 'Website and privacy questions',
          content: (
            <p>
              The <Link href="/faq">FAQs</Link> explain demo sign-in, checkout and browser-local
              history. Read the <Link href="/privacy-policy">privacy policy</Link> for storage
              details and removal instructions. Formal support and grievance contacts for a live
              ordering service will need to be confirmed before launch.
            </p>
          ),
        },
      ]}
    />
  );
}
