import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage } from '@/components/info/info-page';
import { BusinessContact } from '@/components/info/business-info';

export const metadata: Metadata = {
  title: 'About us',
  description: 'Meet Hot Pizza Ace in Barra, Kanpur, and explore pizzas, combos, sides and more.',
};

export default function AboutPage() {
  return (
    <InfoPage
      title="A little more about Ace."
      intro="Hot Pizza Ace, Barra, Kanpur. Pizzas, sides and plenty of choices for your next meal."
      currentPath="/about"
      sections={[
        {
          id: 'on-the-menu',
          title: 'Find your kind of pizza day',
          content: (
            <>
              <p>
                Explore pizzas in different sizes, value pizzas and sharing combos, alongside
                burgers, pasta, garlic breads, wraps, fries, desserts and drinks. Pizza size, crust
                and extra topping choices show their prices before you add them to your cart.
              </p>
              <p>
                Start with the <Link href="/menu">menu</Link>, search for a favourite, or choose a
                category to see what is available. Ask the restaurant directly about ingredients or
                allergies before making a real purchase.
              </p>
            </>
          ),
        },
        {
          id: 'restaurant',
          title: 'Come say hello',
          content: <BusinessContact />,
        },
        {
          id: 'website',
          title: 'About this website',
          content: (
            <p>
              This website currently demonstrates the ordering experience using the restaurant’s
              supplied menu and branding. Menu photos are from the restaurant’s online listing, with
              placeholders where a suitable image is unavailable. Checkout, payments and tracking
              are local demos; they do not send a real order to the restaurant. See our{' '}
              <Link href="/faq">FAQs</Link> for details.
            </p>
          ),
        },
      ]}
    />
  );
}
