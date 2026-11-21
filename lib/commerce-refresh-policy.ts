export type CommerceRefreshPolicy = {
  adminSnapshot: boolean;
  customerOrders: boolean;
  intervalMs: number;
};

/** Dedicated counter/Kitchen/QR feeds own their operational ten-second updates. */
export function commerceRefreshPolicy(
  pathname: string,
  hasActiveCustomerOrder = false,
): CommerceRefreshPolicy {
  const adminPage = pathname === '/admin' || pathname.startsWith('/admin/');
  const adminSnapshot = adminPage && pathname !== '/admin/login';
  const customerOrders =
    !adminPage && !pathname.startsWith('/dine-in/') && !pathname.startsWith('/auth/');
  const customerHistory = pathname === '/account/orders' || pathname === '/track-order';
  return {
    adminSnapshot,
    customerOrders,
    intervalMs:
      adminSnapshot || (customerOrders && (customerHistory || hasActiveCustomerOrder))
        ? 10_000
        : adminSnapshot
          ? 30_000
          : 60_000,
  };
}
