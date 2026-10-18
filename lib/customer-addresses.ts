import { z } from 'zod';
import { normalizeCustomerPhone } from './customer-auth';
import { customerSchema } from './validation';
import type { SavedAddress } from '../types';

export const MAX_SAVED_ADDRESSES = 10;
export type CustomerAddressSaveOptions =
  | { mode: 'create'; expectedOwnerPhone: string }
  | { mode: 'update'; expectedOwnerPhone: string; expected: SavedAddress };

export function sameCustomerAddress(first: SavedAddress, second: SavedAddress): boolean {
  const snapshot = (address: SavedAddress) =>
    JSON.stringify([
      address.id,
      address.ownerPhone,
      address.label,
      address.isDefault,
      ...(
        ['name', 'phone', 'address', 'locality', 'postalCode', 'landmark', 'instructions'] as const
      ).map((key) => address.customer[key]),
    ]);
  return snapshot(first) === snapshot(second);
}

export function customerAddressFingerprint(address: SavedAddress): string {
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[,\s]+/g, ' ')
      .trim();
  return JSON.stringify([
    address.ownerPhone,
    ...(['name', 'address', 'locality', 'postalCode', 'landmark'] as const).map((key) =>
      normalize(address.customer[key]),
    ),
  ]);
}

const savedAddressInputSchema = z.object({
  id: z.string().trim().min(1, 'An address ID is required.').max(100),
  label: z.string().trim().min(1, 'Give this address a label.').max(40),
  customer: customerSchema.extend({
    address: z.string().trim().min(8, 'Enter your complete delivery address.').max(300),
    locality: z.string().trim().min(2, 'Enter your locality.').max(100),
    postalCode: z
      .string()
      .trim()
      .regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit postal code that does not start with 0.'),
  }),
  isDefault: z.boolean(),
});

/** Read helpers return no addresses for absent or invalid customer identity. */
export function getCustomerAddresses(addresses: SavedAddress[], phone: string): SavedAddress[] {
  let owner: string;
  try {
    owner = normalizeCustomerPhone(phone);
  } catch {
    return [];
  }
  return sanitizeSavedAddresses(addresses)
    .filter((address) => address.ownerPhone === owner)
    .sort((first, second) => Number(second.isDefault) - Number(first.isDefault));
}

export function getDefaultCustomerAddress(
  addresses: SavedAddress[],
  phone: string,
): SavedAddress | undefined {
  return getCustomerAddresses(addresses, phone)[0];
}

/** The session owns both the record and contact number; input cannot override either. */
export function parseCustomerAddress(
  input: Omit<SavedAddress, 'ownerPhone'>,
  sessionPhone: string,
): SavedAddress {
  const ownerPhone = normalizeCustomerPhone(sessionPhone);
  const parsed = savedAddressInputSchema.safeParse({
    ...input,
    customer: { ...input.customer, phone: ownerPhone, instructions: '' },
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return { ...parsed.data, ownerPhone };
}

/** Repair only address-book data; preserve the rest of the persisted application state. */
export function sanitizeSavedAddresses(value: unknown): SavedAddress[] {
  if (!Array.isArray(value)) return [];
  const result: SavedAddress[] = [];
  const ids = new Set<string>();
  const fingerprints = new Set<string>();
  const counts = new Map<string, number>();
  for (const input of value) {
    try {
      if (!input || typeof input !== 'object') continue;
      const address = parseCustomerAddress(input, input.ownerPhone);
      const fingerprint = customerAddressFingerprint(address);
      const count = counts.get(address.ownerPhone) ?? 0;
      if (ids.has(address.id) || fingerprints.has(fingerprint) || count >= MAX_SAVED_ADDRESSES)
        continue;
      ids.add(address.id);
      fingerprints.add(fingerprint);
      counts.set(address.ownerPhone, count + 1);
      result.push(address);
    } catch {
      // Ignore an invalid record instead of preventing the customer from opening checkout.
    }
  }
  const defaults = new Map<string, string>();
  const explicitDefaults = new Set<string>();
  for (const address of result) {
    if (!defaults.has(address.ownerPhone)) defaults.set(address.ownerPhone, address.id);
    if (address.isDefault && !explicitDefaults.has(address.ownerPhone)) {
      defaults.set(address.ownerPhone, address.id);
      explicitDefaults.add(address.ownerPhone);
    }
  }
  return result.map((address) => ({
    ...address,
    isDefault: defaults.get(address.ownerPhone) === address.id,
  }));
}
