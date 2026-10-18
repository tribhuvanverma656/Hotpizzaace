'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  Check,
  House,
  Info,
  LogIn,
  MapPin,
  Pencil,
  Plus,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDemoStore } from '@/lib/store';
import { getCustomerAddresses } from '@/lib/customer-addresses';
import type { SavedAddress } from '@/types';
import { CustomerAddressForm } from '@/components/customer-address-form';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import './addresses.css';

function sameAddress(first: SavedAddress, second: SavedAddress) {
  const signature = (address: SavedAddress) =>
    JSON.stringify([
      address.id,
      address.ownerPhone,
      address.label,
      address.isDefault,
      address.customer.name,
      address.customer.phone,
      address.customer.address,
      address.customer.locality,
      address.customer.postalCode,
      address.customer.landmark,
      address.customer.instructions,
    ]);
  return signature(first) === signature(second);
}

export default function CustomerAddressesPage() {
  const { customerSession, hydrated } = useDemoStore();
  if (!hydrated)
    return (
      <div className="container empty-state" role="status">
        Opening your saved addresses…
      </div>
    );
  if (!customerSession)
    return (
      <div className="container empty-state customer-address-signin">
        <span className="customer-address-empty-icon">
          <MapPin size={31} aria-hidden="true" />
        </span>
        <span className="eyebrow">A LITTLE LESS TYPING NEXT TIME</span>
        <h1>
          Save your <em>favourite places.</em>
        </h1>
        <p>Sign in with your mobile number to save delivery addresses for your next order.</p>
        <Link className="btn btn-primary" href="/account/login?next=/account/addresses">
          Customer sign in <LogIn size={17} aria-hidden="true" />
        </Link>
        <Link className="text-link" href="/menu">
          Explore the menu
        </Link>
        <small>Demo account · addresses are saved in this browser.</small>
      </div>
    );
  return <SignedInAddressBook key={customerSession.phone} phone={customerSession.phone} />;
}

function SignedInAddressBook({ phone }: { phone: string }) {
  const {
    savedAddresses,
    cart,
    saveCustomerAddress,
    removeCustomerAddress,
    setDefaultCustomerAddress,
  } = useDemoStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<SavedAddress | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [removingAddress, setRemovingAddress] = useState<SavedAddress | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [notice, setNotice] = useState('');
  const addButton = useRef<HTMLButtonElement>(null);
  const addresses = getCustomerAddresses(savedAddresses, phone);
  const currentEditingAddress = addresses.find((address) => address.id === editingAddress?.id);
  const currentRemovingAddress = addresses.find((address) => address.id === removingAddress?.id);
  const editingMissing = !!editingAddress && !currentEditingAddress;
  const editingChanged =
    !!editingAddress &&
    !!currentEditingAddress &&
    !sameAddress(editingAddress, currentEditingAddress);
  const removingMissing = !!removingAddress && !currentRemovingAddress;
  const removingChanged =
    !!removingAddress &&
    !!currentRemovingAddress &&
    !sameAddress(removingAddress, currentRemovingAddress);
  const newAddressLimitReached = !editingAddress && addresses.length >= 10;
  useEffect(() => {
    if (!editingMissing) return;
    setFormOpen(false);
    setEditingAddress(null);
    setNotice(
      'This address is no longer available. The editor was closed and your edits were not saved.',
    );
    addButton.current?.focus();
  }, [editingMissing]);
  useEffect(() => {
    if (!removingMissing) return;
    setRemovingAddress(null);
    setRemoveError('');
    setNotice('This address has already been removed. Your saved-address list is up to date.');
    addButton.current?.focus();
  }, [removingMissing]);
  const closeForm = () => {
    setFormOpen(false);
    setEditingAddress(null);
    addButton.current?.focus();
  };
  const save = (input: Omit<SavedAddress, 'ownerPhone'>) => {
    saveCustomerAddress(
      input,
      editingAddress
        ? { mode: 'update', expectedOwnerPhone: phone, expected: editingAddress }
        : { mode: 'create', expectedOwnerPhone: phone },
    );
    toast.success(editingAddress ? 'Address updated' : 'Address saved');
    setNotice('');
    closeForm();
  };

  return (
    <div className="container journey-page customer-address-page">
      <div className="customer-address-page-heading">
        <div>
          <span className="eyebrow">HOME, WORK & EVERYWHERE IN BETWEEN</span>
          <h1>
            Your saved <em>addresses.</em>
          </h1>
          <p>Signed in with +91 ••••••{phone.slice(-4)}</p>
        </div>
        <div className="customer-address-heading-actions">
          <Link className="btn btn-outline" href="/account/orders">
            My orders
          </Link>
          <button
            ref={addButton}
            type="button"
            className="btn btn-primary"
            disabled={addresses.length >= 10}
            onClick={() => {
              setEditingAddress(null);
              setEditorVersion((version) => version + 1);
              setNotice('');
              setFormOpen(true);
            }}
          >
            <Plus size={17} aria-hidden="true" /> Add address
          </button>
        </div>
      </div>
      {notice && (
        <div className="customer-address-notice" role="status">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice('')}>
            Dismiss
          </button>
        </div>
      )}
      {addresses.length >= 10 && (
        <p className="customer-address-limit">
          You have 10 saved addresses. Edit or remove one to add another.
        </p>
      )}
      {formOpen && editingChanged && (
        <div className="customer-address-notice customer-address-conflict" role="alert">
          <div>
            <strong>This address changed in another tab.</strong>
            <p>
              Your edits have not been saved. Loading the latest address will replace your unsaved
              edits.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!currentEditingAddress) return;
              setEditingAddress(structuredClone(currentEditingAddress));
              setEditorVersion((version) => version + 1);
            }}
          >
            Load latest address
          </button>
        </div>
      )}
      {formOpen && newAddressLimitReached && (
        <p className="customer-address-error" role="alert">
          The address limit was reached while this form was open. Remove a saved address to make
          room, or cancel this draft.
        </p>
      )}
      {formOpen && !editingMissing && (
        <CustomerAddressForm
          key={`${phone}:${editingAddress?.id || 'new'}:${editorVersion}`}
          address={editingAddress || undefined}
          phone={phone}
          firstAddress={addresses.length === 0}
          saveBlocked={editingChanged || newAddressLimitReached}
          onSave={save}
          onCancel={closeForm}
        />
      )}
      {addresses.length ? (
        <div className="customer-address-grid">
          {addresses.map((address) => {
            const LabelIcon =
              address.label === 'Home'
                ? House
                : address.label === 'Work'
                  ? BriefcaseBusiness
                  : MapPin;
            return (
              <article
                key={address.id}
                className={`customer-address-card ${address.isDefault ? 'customer-address-is-default' : ''}`}
              >
                <div className="customer-address-card-heading">
                  <span className="customer-address-label-icon">
                    <LabelIcon size={20} aria-hidden="true" />
                  </span>
                  <h2>{address.label}</h2>
                  {address.isDefault && (
                    <span className="customer-address-default-badge">
                      <Check size={13} aria-hidden="true" /> Default
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
                    <p className="customer-address-landmark">
                      Landmark: {address.customer.landmark}
                    </p>
                  )}
                  <p className="customer-address-phone">+91 {address.customer.phone}</p>
                </div>
                <div className="customer-address-card-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingAddress(structuredClone(address));
                      setEditorVersion((version) => version + 1);
                      setNotice('');
                      setFormOpen(true);
                    }}
                    aria-label={`Edit ${address.label} address`}
                  >
                    <Pencil size={14} aria-hidden="true" /> Edit
                  </button>
                  {!address.isDefault && (
                    <button
                      type="button"
                      onClick={() => {
                        try {
                          setDefaultCustomerAddress(address.id);
                          toast.success(`${address.label} is now your default address`);
                        } catch (error) {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : 'Could not update your default address.',
                          );
                        }
                      }}
                    >
                      Make default
                    </button>
                  )}
                  <button
                    type="button"
                    className="customer-address-remove"
                    aria-label={`Remove ${address.label} address`}
                    onClick={() => {
                      setRemovingAddress(structuredClone(address));
                      setRemoveError('');
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" /> Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        !formOpen && (
          <div className="customer-address-empty">
            <span className="customer-address-empty-icon">
              <House size={30} aria-hidden="true" />
            </span>
            <h2>A familiar place for your next order.</h2>
            <p>
              Save your home, work, or another delivery address. Your default will be ready at
              checkout.
            </p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditorVersion((version) => version + 1);
                setNotice('');
                setFormOpen(true);
              }}
            >
              <Plus size={17} aria-hidden="true" /> Save your first address
            </button>
          </div>
        )
      )}
      <div className="customer-address-page-footer">
        <p>
          <Info size={16} aria-hidden="true" />
          <span>Demo account · saved in this browser for your signed-in mobile number.</span>
        </p>
        <Link className="btn btn-outline" href={cart.length ? '/checkout' : '/menu'}>
          {cart.length ? 'Continue to checkout' : 'Explore the menu'}
          {cart.length ? (
            <ArrowRight size={17} aria-hidden="true" />
          ) : (
            <ShoppingBag size={17} aria-hidden="true" />
          )}
        </Link>
      </div>
      <Dialog
        open={!!removingAddress && !removingMissing}
        onOpenChange={(open) => {
          if (!open) {
            setRemovingAddress(null);
            setRemoveError('');
          }
        }}
      >
        <DialogContent className="customer-address-remove-dialog">
          <DialogTitle>Remove this address?</DialogTitle>
          <DialogDescription>
            {removingAddress?.label} will be removed from your saved addresses. Your previous orders
            will keep their delivery details.
          </DialogDescription>
          {removingAddress && (
            <div className="customer-address-removal-details">
              <strong>{removingAddress.customer.name}</strong>
              <p>{removingAddress.customer.address}</p>
              <p>
                {removingAddress.customer.locality} · {removingAddress.customer.postalCode}
              </p>
            </div>
          )}
          <p>
            {addresses.length === 1
              ? 'This is your last saved address. You can add a new one or enter your address at checkout.'
              : removingAddress?.isDefault
                ? 'Another saved address will become your default.'
                : 'Your default address will stay the same.'}
          </p>
          {removingChanged && (
            <div className="customer-address-notice customer-address-conflict" role="alert">
              <p>
                This address changed in another tab. Review its latest details before removing it.
              </p>
              <button
                type="button"
                onClick={() => {
                  if (!currentRemovingAddress) return;
                  setRemovingAddress(structuredClone(currentRemovingAddress));
                  setRemoveError('');
                }}
              >
                Review updated address
              </button>
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
              onClick={() => setRemovingAddress(null)}
            >
              Keep address
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={removingChanged || removingMissing}
              onClick={() => {
                if (!removingAddress) return;
                try {
                  const latest = getCustomerAddresses(
                    useDemoStore.getState().savedAddresses,
                    phone,
                  ).find((address) => address.id === removingAddress.id);
                  if (!latest) throw new Error('This address has already been removed.');
                  if (!sameAddress(removingAddress, latest))
                    throw new Error(
                      'This address changed. Review its latest details before removing it.',
                    );
                  removeCustomerAddress(removingAddress.id, removingAddress);
                  setRemovingAddress(null);
                  toast.success('Address removed');
                  addButton.current?.focus();
                } catch (error) {
                  setRemoveError(
                    error instanceof Error ? error.message : 'Could not remove this address.',
                  );
                }
              }}
            >
              Remove address
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
