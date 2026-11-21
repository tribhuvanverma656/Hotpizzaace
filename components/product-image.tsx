import Image from 'next/image';

/**
 * Menu photos are large originals (900–1350px). Bundled local photos go through the
 * Next.js image optimizer so phones download a thumbnail-sized WebP/AVIF; owner-provided
 * HTTPS or browser-local data URLs keep the plain element because the optimizer only
 * accepts configured hosts. The parent must be `position: relative`.
 */
export function ProductImage({
  src,
  alt,
  sizes,
  priority = false,
  className,
}: {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const local = src.startsWith('/') && !src.startsWith('//');
  if (local)
    return (
      <Image
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized={src.endsWith('.svg')}
        className={className}
        style={{ objectFit: 'cover' }}
      />
    );
  return <img src={src} alt={alt} loading="lazy" decoding="async" className={className} />;
}
