import type { OrderTax } from '../types';

export const NEAREST_RUPEE_POLICY = 'nearest_rupee' as const;

/** Integer-paise adjustment only; tax, item prices and saved bill snapshots stay unchanged. */
export function nearestRupeeAdjustment(
  unroundedTotal: number,
  subtotal: number,
  deliveryFee: number,
  tax?: Pick<OrderTax, 'version' | 'groups'>,
): number {
  if (
    ![unroundedTotal, subtotal, deliveryFee].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    unroundedTotal > Number.MAX_SAFE_INTEGER - 50
  )
    throw new Error('The bill amounts cannot be rounded safely.');
  let payable = Math.floor((unroundedTotal + 50) / 100) * 100;
  // A basket sold entirely at tax-inclusive MRP cannot collect above its listed
  // item subtotal. Discounts may round normally while remaining within that cap.
  const mrpOnly =
    deliveryFee === 0 &&
    tax?.version === 2 &&
    !!tax.groups?.length &&
    tax.groups.every((group) => group.pricing === 'inclusive');
  if (mrpOnly && payable > subtotal) payable = Math.floor(subtotal / 100) * 100;
  return payable - unroundedTotal || 0;
}

export type ExpectedPayableQuote = {
  expectedTotal?: number;
  expectedRoundOffPolicy?: typeof NEAREST_RUPEE_POLICY;
};
export const BILL_QUOTE_CHANGED_MESSAGE =
  'The bill total or rounding rule changed. Reload this page and review the current total before paying or confirming payment.';

/** A displayed quote is an assertion, never the source of the trusted payable amount. */
export function payableQuoteMatches(
  expected: ExpectedPayableQuote,
  actual: { total: number; roundOffPolicy?: string },
): boolean {
  return (
    Number.isSafeInteger(expected.expectedTotal) &&
    expected.expectedTotal === actual.total &&
    expected.expectedRoundOffPolicy === NEAREST_RUPEE_POLICY &&
    actual.roundOffPolicy === NEAREST_RUPEE_POLICY
  );
}
