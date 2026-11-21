'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

// Keep the chef tree independent of the customer Auth, address and commerce stores.
const CustomerApplicationProviders = dynamic(() =>
  import('./customer-application-providers').then((module) => module.CustomerApplicationProviders),
);

export function ApplicationProviders({
  children,
  commerceEnabled,
}: {
  children: React.ReactNode;
  commerceEnabled: boolean;
}) {
  const path = usePathname();
  if (
    path === '/kitchen' ||
    path.startsWith('/kitchen/') ||
    path === '/local-pos' ||
    path.startsWith('/local-pos/')
  )
    return <>{children}</>;
  return (
    <CustomerApplicationProviders commerceEnabled={commerceEnabled}>
      {children}
    </CustomerApplicationProviders>
  );
}
