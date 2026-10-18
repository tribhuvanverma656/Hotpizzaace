'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useDemoStore } from '@/lib/store';
import { ProductCustomizer } from '@/components/product-customizer';
export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const product = useDemoStore((s) => s.products.find((p) => p.slug === slug && !p.archived));
  const hydrated = useDemoStore((s) => s.hydrated);
  if (!hydrated)
    return (
      <div className="container empty-state" role="status">
        Getting your favourite ready…
      </div>
    );
  if (!product)
    return (
      <div className="container empty-state">
        <h1>That slice isn’t on the menu</h1>
        <Link href="/menu" className="btn btn-primary">
          Back to menu
        </Link>
      </div>
    );
  return (
    <div className="container detail-page">
      <Link className="back-link" href="/menu">
        <ArrowLeft size={16} />
        Back to our menu
      </Link>
      <ProductCustomizer product={product} />
      <p className="detail-note">
        <ShieldCheck size={16} />
        Printed menu · Prices include selected options
      </p>
    </div>
  );
}
