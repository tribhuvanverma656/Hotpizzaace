import type { Metadata } from 'next';
import { DineInQrPage } from '@/components/dine-in-qr';

export const metadata: Metadata = {
  title: 'Scan & order · Pay at counter',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <DineInQrPage key={token} token={token} />;
}
