import { z } from 'zod';
import type { Customer } from '../../types';

export const MAX_SHARED_SAVED_ADDRESSES = 10;
export type SharedSavedAddress = {
  id: string;
  label: string;
  customer: Customer;
  isDefault: boolean;
};
export type SharedAddressBook = { revision: number; addresses: SharedSavedAddress[] };
export type SharedAddressMutation =
  | { action: 'create'; expectedRevision: number; address: SharedSavedAddress }
  | { action: 'update'; expectedRevision: number; address: SharedSavedAddress }
  | { action: 'remove'; expectedRevision: number; id: string }
  | { action: 'default'; expectedRevision: number; id: string };
export type SharedAddressErrorCode =
  | 'address_invalid'
  | 'address_limit'
  | 'address_duplicate'
  | 'address_conflict'
  | 'address_not_found'
  | 'address_revision_conflict'
  | 'address_unavailable';

export class SharedAddressError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code: SharedAddressErrorCode = 'address_invalid',
  ) {
    super(message);
  }
}

const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const addressId = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'Use a valid address ID.',
  );
const text = (minimum: number, maximum: number) =>
  z
    .string()
    .max(maximum)
    .transform((value) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim())
    .pipe(
      z
        .string()
        .min(minimum)
        .max(maximum)
        .refine(
          (value) => !/[\u0000-\u001f\u007f]/.test(value),
          'Remove control characters from this address.',
        ),
    );
const customer = z
  .object({
    name: text(2, 80),
    phone: z
      .string()
      .trim()
      .regex(/^(?:\+91[ -]?)?[6-9](?:[ -]?\d){9}$/, 'Enter a valid Indian mobile number.')
      .transform((value) => value.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')),
    address: text(8, 300),
    locality: text(2, 100),
    postalCode: z
      .string()
      .trim()
      .regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit postal code.'),
    landmark: text(0, 150),
    instructions: text(0, 300),
  })
  .strict();
const savedAddress = z
  .object({ id: addressId, label: text(1, 40), customer, isDefault: z.boolean() })
  .strict();

/** Recipient phone differentiates recipients; labels and instructions do not create new destinations. */
export function sharedAddressFingerprint(address: SharedSavedAddress): string {
  const normalize = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[,\s]+/gu, ' ')
      .trim();
  return JSON.stringify(
    (['name', 'phone', 'address', 'locality', 'postalCode', 'landmark'] as const).map((key) =>
      normalize(address.customer[key]),
    ),
  );
}

const addressBook = z
  .object({ revision, addresses: z.array(savedAddress).max(MAX_SHARED_SAVED_ADDRESSES) })
  .strict()
  .superRefine((book, context) => {
    if (new Set(book.addresses.map((address) => address.id)).size !== book.addresses.length)
      context.addIssue({ code: 'custom', message: 'Address IDs must be unique.' });
    if (new Set(book.addresses.map(sharedAddressFingerprint)).size !== book.addresses.length)
      context.addIssue({ code: 'custom', message: 'This destination is already saved.' });
    if (
      book.addresses.filter((address) => address.isDefault).length !==
      (book.addresses.length ? 1 : 0)
    )
      context.addIssue({ code: 'custom', message: 'Choose exactly one default address.' });
  });
const mutation = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('create'), expectedRevision: revision, address: savedAddress })
    .strict(),
  z
    .object({ action: z.literal('update'), expectedRevision: revision, address: savedAddress })
    .strict(),
  z.object({ action: z.literal('remove'), expectedRevision: revision, id: addressId }).strict(),
  z.object({ action: z.literal('default'), expectedRevision: revision, id: addressId }).strict(),
]);

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new SharedAddressError(result.error.issues[0]?.message ?? 'Check this address.');
  return result.data;
}
export function parseSharedSavedAddress(value: unknown): SharedSavedAddress {
  return parse(savedAddress, value);
}
export function parseSharedAddressBook(value: unknown): SharedAddressBook {
  return parse(addressBook, value);
}
export function parseSharedAddressMutation(value: unknown): SharedAddressMutation {
  return parse(mutation, value);
}

/** Pure edits are committed by a separate per-account database compare-and-swap. Never auto-retry a conflict. */
export function mutateSharedAddressBook(
  previous: SharedAddressBook,
  value: unknown,
): SharedAddressBook {
  const input = parseSharedAddressMutation(value);
  const book = parseSharedAddressBook(previous);
  if (input.expectedRevision !== book.revision)
    throw new SharedAddressError(
      'Your saved addresses changed. Refresh and review them before saving.',
      409,
      'address_revision_conflict',
    );
  if (book.revision === Number.MAX_SAFE_INTEGER)
    throw new SharedAddressError(
      'Saved addresses are temporarily unavailable.',
      503,
      'address_unavailable',
    );
  let addresses = book.addresses;
  if (input.action === 'create' || input.action === 'update') {
    const existing = addresses.find((address) => address.id === input.address.id);
    if (input.action === 'create' && existing)
      throw new SharedAddressError(
        'This address ID is already saved. Refresh your address book.',
        409,
        'address_conflict',
      );
    if (input.action === 'update' && !existing)
      throw new SharedAddressError(
        'This saved address no longer exists. Refresh your address book.',
        404,
        'address_not_found',
      );
    const fingerprint = sharedAddressFingerprint(input.address);
    if (
      addresses.some(
        (address) =>
          address.id !== input.address.id && sharedAddressFingerprint(address) === fingerprint,
      )
    )
      throw new SharedAddressError(
        'This destination is already saved. Choose or edit the existing address.',
        409,
        'address_duplicate',
      );
    if (input.action === 'create' && addresses.length >= MAX_SHARED_SAVED_ADDRESSES)
      throw new SharedAddressError(
        'You can save up to 10 addresses. Remove one before adding another.',
        409,
        'address_limit',
      );
    const chosen = {
      ...input.address,
      isDefault: input.address.isDefault || !!existing?.isDefault || addresses.length === 0,
    };
    addresses =
      input.action === 'create'
        ? [...addresses, chosen]
        : addresses.map((address) => (address.id === chosen.id ? chosen : address));
    if (chosen.isDefault)
      addresses = addresses.map((address) => ({ ...address, isDefault: address.id === chosen.id }));
  } else {
    if (!addresses.some((address) => address.id === input.id))
      throw new SharedAddressError(
        'This saved address no longer exists. Refresh your address book.',
        404,
        'address_not_found',
      );
    addresses =
      input.action === 'remove'
        ? addresses.filter((address) => address.id !== input.id)
        : addresses.map((address) => ({ ...address, isDefault: address.id === input.id }));
    if (addresses.length && !addresses.some((address) => address.isDefault))
      addresses = addresses.map((address, index) => ({ ...address, isDefault: index === 0 }));
  }
  return { revision: book.revision + 1, addresses };
}
