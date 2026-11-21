import type { BillingProfile, OrderItem, OrderTax, OrderTaxGroup, Product } from '../types';

const MAX_AMOUNT = 100_000_000;

function checkAmount(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_AMOUNT)
    throw new Error('Invalid taxable value.');
}

/** Explicit catalogue classification only; an MRP product is never inferred to be tax-exempt. */
export function validateGstInclusive(value: Product['gstInclusive']): void {
  if (
    !value ||
    !Number.isSafeInteger(value.rateBps) ||
    value.rateBps < 1 ||
    value.rateBps > 4000 ||
    value.rateBps % 2 !== 0 ||
    typeof value.code !== 'string' ||
    !/^(?:\d{4}|\d{6}|\d{8})$/.test(value.code)
  )
    throw new Error('Review this item’s GST-inclusive rate and HSN/SAC code.');
}

/** Standalone UP restaurant service; supplier-charged delivery forms part of the supply. */
export function calculateRestaurantGst(taxableValue: number, supplier: BillingProfile): OrderTax {
  checkAmount(taxableValue);
  if (
    supplier.cgstRate !== 2.5 ||
    supplier.sgstRate !== 2.5 ||
    supplier.stateCode !== '09' ||
    !supplier.gstin.startsWith(supplier.stateCode) ||
    !/^\d{14}$/.test(supplier.fssaiNumber)
  )
    throw new Error('The restaurant tax registration must be reviewed before checkout.');
  // 2.5% = 1/40. Integer paise, rounded half up for each separate tax component.
  const cgst = Math.floor((taxableValue + 20) / 40);
  const sgst = cgst;
  return { supplier: structuredClone(supplier), taxableValue, cgst, sgst, total: cgst + sgst };
}

/**
 * GST from trusted, priced line snapshots. Discounts apply proportionally to displayed item
 * values; delivery belongs to restaurant service and is excluded from discount allocation.
 * All-exclusive orders retain the exact original structure and rounding for old receipts.
 */
export function calculateOrderGst(
  items: Pick<OrderItem, 'unitPrice' | 'quantity' | 'gstInclusive'>[],
  deliveryFee: number,
  discount: number,
  supplier: BillingProfile,
): OrderTax {
  checkAmount(deliveryFee);
  checkAmount(discount);
  const grouped = new Map<string, OrderTaxGroup>();
  let subtotal = 0;
  let inclusive = false;
  for (const item of items) {
    checkAmount(item.unitPrice);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 20)
      throw new Error('Invalid item quantity.');
    const grossValue = item.unitPrice * item.quantity;
    checkAmount(grossValue);
    subtotal += grossValue;
    checkAmount(subtotal);
    if (item.gstInclusive !== undefined) {
      validateGstInclusive(item.gstInclusive);
      inclusive = true;
    }
    const pricing = item.gstInclusive ? 'inclusive' : 'exclusive';
    const rateBps = item.gstInclusive?.rateBps ?? 500;
    const code = item.gstInclusive?.code ?? '996331';
    const key = `${pricing}:${rateBps}:${code}`;
    const group = grouped.get(key) ?? {
      pricing,
      rateBps,
      code,
      grossValue: 0,
      deliveryFee: 0,
      discount: 0,
      taxableValue: 0,
      cgst: 0,
      sgst: 0,
      total: 0,
    };
    group.grossValue += grossValue;
    grouped.set(key, group);
  }
  if (discount > subtotal) throw new Error('The discount exceeds the item subtotal.');
  checkAmount(subtotal + deliveryFee - discount);
  if (!inclusive) return calculateRestaurantGst(subtotal + deliveryFee - discount, supplier);
  // Validate the restaurant registration even for an inclusive-only cart.
  calculateRestaurantGst(0, supplier);
  const exclusiveKey = 'exclusive:500:996331';
  if (deliveryFee && !grouped.has(exclusiveKey))
    grouped.set(exclusiveKey, {
      pricing: 'exclusive',
      rateBps: 500,
      code: '996331',
      grossValue: 0,
      deliveryFee: 0,
      discount: 0,
      taxableValue: 0,
      cgst: 0,
      sgst: 0,
      total: 0,
    });
  const groups = [...grouped].sort(([first], [second]) =>
    first < second ? -1 : first > second ? 1 : 0,
  );
  let allocated = 0;
  const remainders = groups.map(([key, group]) => {
    const numerator = BigInt(discount) * BigInt(group.grossValue);
    const divisor = BigInt(subtotal || 1);
    group.discount = Number(numerator / divisor);
    allocated += group.discount;
    return { key, group, remainder: numerator % divisor };
  });
  remainders.sort((first, second) =>
    first.remainder > second.remainder
      ? -1
      : first.remainder < second.remainder
        ? 1
        : first.key < second.key
          ? -1
          : first.key > second.key
            ? 1
            : 0,
  );
  for (let index = 0; index < discount - allocated; index++) remainders[index].group.discount += 1;
  for (const [key, group] of groups) {
    group.deliveryFee = key === exclusiveKey ? deliveryFee : 0;
    const baseGross = group.grossValue - group.discount;
    if (group.pricing === 'inclusive') {
      // Extract separately rounded half-GST components without changing the displayed MRP.
      group.cgst = Math.floor(
        (baseGross * group.rateBps + (10_000 + group.rateBps)) / (2 * (10_000 + group.rateBps)),
      );
      group.sgst = group.cgst;
      group.total = group.cgst + group.sgst;
      group.taxableValue = baseGross - group.total;
    } else {
      group.taxableValue = baseGross + group.deliveryFee;
      group.cgst = Math.floor((group.taxableValue * group.rateBps + 10_000) / 20_000);
      group.sgst = group.cgst;
      group.total = group.cgst + group.sgst;
    }
  }
  const taxGroups = groups.map(([, group]) => group);
  return {
    supplier: structuredClone(supplier),
    taxableValue: taxGroups.reduce((sum, group) => sum + group.taxableValue, 0),
    cgst: taxGroups.reduce((sum, group) => sum + group.cgst, 0),
    sgst: taxGroups.reduce((sum, group) => sum + group.sgst, 0),
    total: taxGroups.reduce((sum, group) => sum + group.total, 0),
    version: 2,
    includedTotal: taxGroups.reduce(
      (sum, group) => sum + (group.pricing === 'inclusive' ? group.total : 0),
      0,
    ),
    groups: taxGroups,
  };
}
