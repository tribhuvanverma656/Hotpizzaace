import Image from 'next/image';
import '@/components/restaurant-logo.css';

export function RestaurantLogo({
  variant = 'header',
}: {
  variant?: 'header' | 'footer' | 'admin' | 'login';
}) {
  return (
    <Image
      src="/brand/hot-pizza-ace.gif"
      alt="Hot Pizza Ace — Make Every Day Delicious"
      width={1806}
      height={1440}
      unoptimized
      loading={variant === 'footer' ? 'lazy' : 'eager'}
      className={`restaurant-logo restaurant-logo--${variant}`}
    />
  );
}
