export type CommerceEnvironment = {
  mode: 'development' | 'production' | null;
  allowSimulatedPayments: boolean;
};

/** Display metadata comes from the server catalog, never persisted browser settings or its host. */
export function readCommerceEnvironment(snapshot: unknown): CommerceEnvironment {
  const unknown: CommerceEnvironment = { mode: null, allowSimulatedPayments: false };
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return unknown;
  const metadata = snapshot as Record<string, unknown>;
  if (
    (metadata.mode !== 'development' && metadata.mode !== 'production') ||
    typeof metadata.allowSimulatedPayments !== 'boolean'
  )
    return unknown;
  return {
    mode: metadata.mode,
    // Match the server simulator's rule; a flag alone never enables simulation in production.
    allowSimulatedPayments: metadata.mode === 'development' && metadata.allowSimulatedPayments,
  };
}
