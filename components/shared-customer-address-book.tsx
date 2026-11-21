'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { ArrowRight, Check, Info, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { MAX_SHARED_SAVED_ADDRESSES, type SharedSavedAddress } from '@/lib/commerce/addresses';
import { addressBookError } from '@/lib/customer-addresses-state';
import { useCustomerAuth } from './customer-auth-provider';
import { useCustomerAddresses } from './customer-addresses-provider';
import { SharedCustomerAddressForm } from './shared-customer-address-form';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';

type AddressReview = { address: SharedSavedAddress; revision: number };
type Editor = { address: SharedSavedAddress | null; revision: number; key: number };

function sameAddress(first: SharedSavedAddress, second: SharedSavedAddress) {
  const signature = (address: SharedSavedAddress) =>
    JSON.stringify([
      address.id,
      address.label,
      address.isDefault,
      ...(
        ['name', 'phone', 'address', 'locality', 'postalCode', 'landmark', 'instructions'] as const
      ).map((field) => address.customer[field]),
    ]);
  return signature(first) === signature(second);
}

export function SharedCustomerAddressBook() {
  const auth = useCustomerAuth();
  if (auth.error)
    return (
      <div className="container empty-state">
        <h1>Let’s reconnect.</h1>
        <p role="alert">{auth.error}</p>
        <button className="btn btn-primary" onClick={() => void auth.refresh()}>
          Try again
        </button>
      </div>
    );
  if (!auth.user)
    return (
      <div className="container empty-state customer-address-signin">
        {auth.loading ? (
          <p role="status">Checking your account…</p>
        ) : (
          <>
            <MapPin size={38} aria-hidden="true" />
            <h1>Save your favourite places.</h1>
            <p>
              Continue with Google to save delivery addresses and use them on your other devices.
            </p>
            <Link className="btn btn-primary" href="/account/login?next=/account/addresses">
              Continue with Google <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </>
        )}
      </div>
    );
  return (
    <>
      {auth.loading && (
        <div className="container empty-state" role="status">
          Checking your account…
        </div>
      )}
      {/* Keep a dirty editor mounted while the same account is being rechecked, with contacts hidden. */}
      <div hidden={auth.loading}>
        <SignedInAddressBook
          key={auth.user.id}
          initialName={auth.user.name ?? ''}
          active={!auth.loading}
        />
      </div>
    </>
  );
}

function SignedInAddressBook({ initialName, active }: { initialName: string; active: boolean }) {
  const book = useCustomerAddresses();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [removal, setRemoval] = useState<AddressReview | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [notice, setNotice] = useState('');
  const editorVersion = useRef(0);
  const addButton = useRef<HTMLButtonElement>(null);
  const ready = book.revision !== null && !book.loading;
  const unavailable =
    !ready ||
    (!!book.error &&
      ![
        'address_duplicate',
        'address_conflict',
        'address_revision_conflict',
        'address_not_found',
        'address_limit',
      ].includes(book.errorCode ?? ''));
  const limitReached = book.addresses.length >= MAX_SHARED_SAVED_ADDRESSES;
  const latestEditing = book.addresses.find((address) => address.id === editor?.address?.id);
  const editorChanged =
    !!editor?.address && (!latestEditing || !sameAddress(editor.address, latestEditing));
  const editorStale = !!editor && book.revision !== editor.revision;
  const latestRemoving = book.addresses.find((address) => address.id === removal?.address.id);
  const removalStale =
    !!removal &&
    (book.revision !== removal.revision ||
      !latestRemoving ||
      !sameAddress(removal.address, latestRemoving));
  const closeEditor = () => {
    setEditor(null);
    addButton.current?.focus();
  };
  const openEditor = (address: SharedSavedAddress | null) => {
    if (book.revision === null) return;
    setEditor({
      address: address ? structuredClone(address) : null,
      revision: book.revision,
      key: ++editorVersion.current,
    });
    setNotice('');
  };
  return (
    <div className="container journey-page customer-address-page">
      <div className="customer-address-page-heading">
        <div>
          <span className="eyebrow">HOME, WORK & EVERYWHERE IN BETWEEN</span>
          <h1>
            Your saved <em>addresses.</em>
          </h1>
          <p>Saved to your Pizza Ace account, ready on your other devices.</p>
        </div>
        <div className="customer-address-heading-actions">
          <Link className="btn btn-outline" href="/account/profile">
            My account
          </Link>
          <button
            ref={addButton}
            type="button"
            className="btn btn-primary"
            disabled={unavailable || book.saving || limitReached}
            onClick={() => openEditor(null)}
          >
            <Plus size={17} aria-hidden="true" /> Add address
          </button>
        </div>
      </div>
      {book.error && (
        <div className="customer-address-notice customer-address-conflict" role="alert">
          <p>{book.error}</p>
          <button type="button" disabled={book.saving} onClick={() => void book.refresh()}>
            Refresh addresses
          </button>
        </div>
      )}
      {notice && (
        <div className="customer-address-notice" role="status">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </div>
      )}
      {limitReached && (
        <p className="customer-address-limit">
          You have 10 saved addresses. Edit or remove one to add another.
        </p>
      )}
      {editor && editorStale && ready && (
        <div className="customer-address-notice customer-address-conflict" role="alert">
          <div>
            <strong>Your address book changed on another device.</strong>
            <p>
              {editorChanged
                ? latestEditing
                  ? 'Your draft is still here. Loading the latest address will replace your unsaved edits.'
                  : 'This address was removed. Keep your draft as a new address, or cancel it.'
                : 'Your draft is still here. Review the latest addresses below before continuing.'}
            </p>
          </div>
          <button
            type="button"
            disabled={book.saving || unavailable}
            onClick={() => {
              if (book.revision === null) return;
              if (editorChanged && latestEditing) {
                setEditor({
                  address: structuredClone(latestEditing),
                  revision: book.revision,
                  key: ++editorVersion.current,
                });
              } else {
                setEditor({
                  ...editor,
                  address: editorChanged ? null : editor.address,
                  revision: book.revision,
                });
              }
            }}
          >
            {editorChanged
              ? latestEditing
                ? 'Load latest address'
                : 'Keep draft as new'
              : 'Review complete · keep draft'}
          </button>
        </div>
      )}
      {editor && !editor.address && limitReached && (
        <p className="customer-address-error" role="alert">
          The address book is full. Your draft is still here; remove another address or cancel this
          draft.
        </p>
      )}
      {editor && (
        <SharedCustomerAddressForm
          key={editor.key}
          address={editor.address ?? undefined}
          initialName={initialName}
          firstAddress={book.addresses.length === 0}
          saveBlocked={
            unavailable || book.saving || editorStale || (!editor.address && limitReached)
          }
          onCancel={closeEditor}
          onSave={async (address) => {
            if (editor.address) await book.update(address.id, address, editor.revision);
            else await book.create(address, editor.revision);
            setNotice(editor.address ? 'Address updated.' : 'Address saved.');
            closeEditor();
          }}
        />
      )}
      {book.loading && (
        <p className="customer-address-sync-status" role="status">
          Opening your saved addresses…
        </p>
      )}
      {!book.loading && ready && book.addresses.length === 0 && !editor && !book.error && (
        <div className="customer-address-empty">
          <span className="customer-address-empty-icon">
            <MapPin size={31} aria-hidden="true" />
          </span>
          <h2>A little less typing next time.</h2>
          <p>Save a home, work or family address for your next delivery.</p>
          <button type="button" className="btn btn-primary" onClick={() => openEditor(null)}>
            <Plus size={17} aria-hidden="true" /> Add your first address
          </button>
        </div>
      )}
      <div className="customer-address-grid">
        {[...book.addresses]
          .sort((first, second) => Number(second.isDefault) - Number(first.isDefault))
          .map((address) => (
            <article
              className={`customer-address-card${address.isDefault ? ' customer-address-is-default' : ''}`}
              key={address.id}
            >
              <div className="customer-address-card-heading">
                <span className="customer-address-label-icon">
                  <MapPin size={19} aria-hidden="true" />
                </span>
                <h2>{address.label}</h2>
                {address.isDefault && (
                  <span className="customer-address-default-badge">
                    <Check size={12} aria-hidden="true" /> Default
                  </span>
                )}
              </div>
              <p className="customer-address-recipient">{address.customer.name}</p>
              <div className="customer-address-lines">
                <p>{address.customer.address}</p>
                <p>
                  {address.customer.locality} · {address.customer.postalCode}
                </p>
                {address.customer.landmark && (
                  <p className="customer-address-landmark">Near {address.customer.landmark}</p>
                )}
                <p className="customer-address-phone">+91 {address.customer.phone}</p>
              </div>
              <div className="customer-address-card-actions">
                <button
                  type="button"
                  disabled={unavailable || book.saving}
                  onClick={() => openEditor(address)}
                >
                  <Pencil size={14} aria-hidden="true" /> Edit
                </button>
                {!address.isDefault && (
                  <button
                    type="button"
                    disabled={unavailable || book.saving}
                    onClick={async () => {
                      try {
                        await book.setDefault(address.id, book.revision!);
                        setNotice('Default address updated.');
                      } catch {
                        /* Provider shows a finite error and refreshes conflicts. */
                      }
                    }}
                  >
                    Set as default
                  </button>
                )}
                <button
                  type="button"
                  className="customer-address-remove"
                  disabled={unavailable || book.saving}
                  onClick={() => {
                    setRemoval({ address: structuredClone(address), revision: book.revision! });
                    setRemoveError('');
                  }}
                >
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </button>
              </div>
            </article>
          ))}
      </div>
      <div className="customer-address-page-footer">
        <p>
          <Info size={15} aria-hidden="true" />
          Delivery availability depends on your selected branch and PIN code.
        </p>
        <Link className="btn btn-outline" href="/checkout">
          Continue to checkout <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
      <Dialog
        open={active && !!removal}
        onOpenChange={(open) => {
          if (!open && !book.saving) {
            setRemoval(null);
            setRemoveError('');
          }
        }}
      >
        <DialogContent className="customer-address-remove-dialog">
          <DialogTitle>Remove this address?</DialogTitle>
          <DialogDescription>
            This removes it from your account on every device. Existing orders keep their delivery
            details.
          </DialogDescription>
          {removal && (
            <div className="customer-address-removal-details">
              <strong>
                {removal.address.label} · {removal.address.customer.name}
              </strong>
              <p>{removal.address.customer.address}</p>
              <p>
                {removal.address.customer.locality} · {removal.address.customer.postalCode}
              </p>
            </div>
          )}
          {removalStale && (
            <div className="customer-address-notice customer-address-conflict" role="alert">
              <p>
                {latestRemoving
                  ? 'Your address book changed. Review the latest address before removing it.'
                  : 'This address has already been removed on another device.'}
              </p>
              {latestRemoving && (
                <button
                  type="button"
                  disabled={unavailable || book.saving}
                  onClick={() => {
                    setRemoval({
                      address: structuredClone(latestRemoving),
                      revision: book.revision!,
                    });
                    setRemoveError('');
                  }}
                >
                  Load latest address
                </button>
              )}
            </div>
          )}
          {removeError && (
            <p className="customer-address-error" role="alert">
              {removeError}
            </p>
          )}
          <div className="customer-address-removal-actions">
            <button
              type="button"
              className="btn btn-outline"
              disabled={book.saving}
              onClick={() => setRemoval(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={unavailable || book.saving || removalStale || !removal}
              onClick={async () => {
                if (!removal) return;
                setRemoveError('');
                try {
                  await book.remove(removal.address.id, removal.revision);
                  setRemoval(null);
                  setNotice('Address removed.');
                  addButton.current?.focus();
                } catch (error) {
                  setRemoveError(addressBookError(error).message);
                }
              }}
            >
              {book.saving ? 'Removing…' : 'Remove address'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
