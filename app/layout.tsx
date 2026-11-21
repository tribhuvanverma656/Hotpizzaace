import type { Metadata } from 'next';
import { ResponsiveToaster } from '@/components/responsive-toaster';
import { ApplicationProviders } from '@/components/application-providers';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Hot Pizza Ace — A slice of the good life', template: '%s | Hot Pizza Ace' },
  icons: {
    icon: [{ url: '/brand/hot-pizza-ace.gif', type: 'image/gif' }],
    shortcut: '/brand/hot-pizza-ace.gif',
  },
  description:
    'Hand-tossed pizzas, bold Indian flavours, and your new favourite slice. Explore the Hot Pizza Ace ordering prototype.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <ApplicationProviders commerceEnabled={process.env.COMMERCE_ENABLED === 'true'}>
          {children}
        </ApplicationProviders>
        <ResponsiveToaster />
      </body>
    </html>
  );
}
