'use client';

import { CustomerShell } from './customer-shell';
import { CustomerAuthProvider } from './customer-auth-provider';
import { SharedCommerceProvider } from './shared-commerce-provider';
import { CustomerAddressesProvider } from './customer-addresses-provider';

export function CustomerApplicationProviders({
  children,
  commerceEnabled,
}: {
  children: React.ReactNode;
  commerceEnabled: boolean;
}) {
  return (
    <CustomerAuthProvider>
      <SharedCommerceProvider enabled={commerceEnabled}>
        <CustomerAddressesProvider>
          <CustomerShell>{children}</CustomerShell>
        </CustomerAddressesProvider>
      </SharedCommerceProvider>
    </CustomerAuthProvider>
  );
}
