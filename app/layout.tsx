import type { Metadata } from 'next';
import { Toaster } from 'sonner';
import { CustomerShell } from '@/components/customer-shell';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Hot Pizza Ace — A slice of the good life', template: '%s | Hot Pizza Ace' },
  description:
    'Hand-tossed pizzas, bold Indian flavours, and your new favourite slice. Explore the Hot Pizza Ace ordering prototype.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <CustomerShell>{children}</CustomerShell>
        <Toaster richColors position="bottom-right" closeButton />
      </body>
    </html>
  );
}
