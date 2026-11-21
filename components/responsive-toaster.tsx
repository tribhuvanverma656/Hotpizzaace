'use client';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';

/**
 * Phones show notices at the bottom, above the cart/checkout bar, so they never cover
 * the header or cart button. Larger screens keep the top-right placement.
 */
export function ResponsiveToaster() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 700px)');
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return (
    <Toaster
      richColors
      position={phone ? 'bottom-center' : 'top-right'}
      closeButton
      duration={phone ? 2500 : 4000}
      offset={{
        top: 'calc(24px + env(safe-area-inset-top))',
        right: 'max(24px, env(safe-area-inset-right))',
      }}
      mobileOffset={{
        bottom: 'calc(84px + env(safe-area-inset-bottom))',
        left: 'max(16px, env(safe-area-inset-left), env(safe-area-inset-right))',
        right: 'max(16px, env(safe-area-inset-left), env(safe-area-inset-right))',
      }}
    />
  );
}
