import { LocalQrOrder } from '@/components/local-pos/qr-order';

export default async function LocalQrOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LocalQrOrder token={token} />;
}
