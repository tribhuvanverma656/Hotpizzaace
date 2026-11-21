import { startVisiblePolling, type VisiblePollingEnvironment } from './visible-polling';

type AddressRefreshOptions = {
  pathname: string | null;
  refresh: () => Promise<void>;
  canRefresh?: () => boolean;
};

/** Only checkout and the saved-address screen consume the account's address book. */
export function startAddressRefresh(
  { pathname, refresh, canRefresh }: AddressRefreshOptions,
  environment?: VisiblePollingEnvironment,
): () => void {
  const route = pathname?.replace(/\/$/, '');
  if (route !== '/checkout' && route !== '/account/addresses') return () => {};
  return startVisiblePolling({ refresh, canRefresh, intervalMs: 15_000 }, environment);
}
