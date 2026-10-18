'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Clock, MapPin, Phone, ShoppingBag, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { useDemoStore } from '@/lib/store';
import type { Branch } from '@/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import './branch-picker.css';

function acceptsOrders(branch: Branch) {
  return (
    branch.settings.acceptingOrders &&
    !branch.settings.temporarilyClosed &&
    (branch.settings.deliveryEnabled || branch.settings.pickupEnabled)
  );
}

export function BranchPicker({ className = '' }: { className?: string }) {
  const { branches, selectedBranchId, cart, selectBranch } = useDemoStore();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [checkedPin, setCheckedPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [browseAll, setBrowseAll] = useState(false);
  const [pendingBranchId, setPendingBranchId] = useState<string | null>(null);
  const keepCartButton = useRef<HTMLButtonElement>(null);
  const pinFieldId = useId();
  const itemCount = cart.reduce((count, item) => count + item.quantity, 0);
  useEffect(() => {
    if (pendingBranchId) keepCartButton.current?.focus();
  }, [pendingBranchId]);
  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId);
  const pendingBranch = branches.find((branch) => branch.id === pendingBranchId);
  const deliveryMatches = (branch: Branch) =>
    branch.settings.deliveryEnabled && branch.settings.servicePostalCodes.includes(checkedPin);
  const matchingBranches = checkedPin ? branches.filter(deliveryMatches) : branches;
  const visibleBranches = checkedPin && !browseAll ? matchingBranches : branches;

  const close = () => {
    setOpen(false);
    setPendingBranchId(null);
    setSelectionError('');
  };
  const choose = (branch: Branch, clearCart = false) => {
    setSelectionError('');
    if (branch.id === selectedBranchId) {
      close();
      return;
    }
    if (cart.length && !clearCart) {
      setPendingBranchId(branch.id);
      return;
    }
    try {
      selectBranch(branch.id, clearCart);
      close();
      toast.success(`Selected ${branch.name}`);
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : 'Could not change branches.');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setPendingBranchId(null);
        setSelectionError('');
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className={`branch-picker-trigger ${className}`}
          aria-label={`Choose branch${selectedBranch ? `. Current branch: ${selectedBranch.name}` : ''}`}
        >
          <MapPin size={18} aria-hidden="true" />
          <span>
            <small>Ordering from</small>
            <strong>{selectedBranch?.name || 'Choose branch'}</strong>
          </span>
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogContent className="branch-picker-dialog">
        {pendingBranch ? (
          <>
            <div className="branch-picker-dialog-icon">
              <ShoppingBag size={23} aria-hidden="true" />
            </div>
            <DialogTitle className="branch-picker-title">
              Change to {pendingBranch.name}?
            </DialogTitle>
            <DialogDescription className="branch-picker-description">
              Your cart belongs to {selectedBranch?.name || 'your current branch'}. Changing
              branches will clear these items and any applied coupon so you can start a new order.
            </DialogDescription>
            <div className="branch-picker-confirm-note">
              <ShoppingBag size={18} aria-hidden="true" />
              <span>
                {itemCount} {itemCount === 1 ? 'item' : 'items'} will be removed. Previous orders
                stay in your order history.
              </span>
            </div>
            {selectionError && (
              <p className="branch-picker-error" role="alert">
                {selectionError}
              </p>
            )}
            <div className="branch-picker-confirm-actions">
              <button
                type="button"
                className="btn btn-outline"
                ref={keepCartButton}
                onClick={() => {
                  setPendingBranchId(null);
                  setSelectionError('');
                }}
              >
                Keep my cart
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => choose(pendingBranch, true)}
              >
                Clear cart & change branch
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="branch-picker-eyebrow">HOT PIZZA ACE</span>
            <DialogTitle className="branch-picker-title">Choose your branch</DialogTitle>
            <DialogDescription className="branch-picker-description">
              Choose where your order will be prepared. Enter your PIN to check home delivery.
            </DialogDescription>
            <form
              className="branch-picker-pin-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!/^\d{6}$/.test(pin)) {
                  setPinError('Enter a six-digit PIN to check delivery.');
                  return;
                }
                setPinError('');
                setCheckedPin(pin);
                setBrowseAll(false);
              }}
              noValidate
            >
              <label htmlFor={pinFieldId}>Your delivery PIN</label>
              <div className="branch-picker-pin-entry">
                <MapPin size={18} aria-hidden="true" />
                <input
                  id={pinFieldId}
                  value={pin}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={6}
                  placeholder="6-digit PIN"
                  aria-invalid={!!pinError}
                  aria-describedby={pinError ? `${pinFieldId}-error` : undefined}
                  onChange={(event) => {
                    setPin(event.target.value.replace(/\D/g, '').slice(0, 6));
                    setPinError('');
                    setCheckedPin('');
                    setBrowseAll(false);
                  }}
                />
                <button type="submit">Check</button>
              </div>
              {pinError && (
                <p className="branch-picker-error" role="alert" id={`${pinFieldId}-error`}>
                  {pinError}
                </p>
              )}
              {(pin || checkedPin) && (
                <button
                  type="button"
                  className="branch-picker-text-button"
                  onClick={() => {
                    setPin('');
                    setCheckedPin('');
                    setPinError('');
                    setBrowseAll(false);
                  }}
                >
                  Clear PIN
                </button>
              )}
            </form>
            {checkedPin && (
              <div className="branch-picker-coverage" role="status">
                {matchingBranches.length ? (
                  <p>
                    {matchingBranches.length}{' '}
                    {matchingBranches.length === 1 ? 'branch delivers' : 'branches deliver'} to{' '}
                    <strong>{checkedPin}</strong>.
                  </p>
                ) : (
                  <p>
                    Home delivery is unavailable for <strong>{checkedPin}</strong>. Browse our
                    branches to see pickup options.
                  </p>
                )}
                {!browseAll && (
                  <button
                    type="button"
                    className="branch-picker-text-button"
                    onClick={() => setBrowseAll(true)}
                  >
                    Browse all branches
                  </button>
                )}
              </div>
            )}
            <div className="branch-picker-list">
              {visibleBranches.map((branch) => {
                const selected = branch.id === selectedBranchId;
                const available = acceptsOrders(branch);
                return (
                  <article
                    key={branch.id}
                    className={`branch-picker-card ${selected ? 'branch-picker-card-selected' : ''}`}
                  >
                    <div className="branch-picker-card-heading">
                      <h3>{branch.name}</h3>
                      {selected && (
                        <span className="branch-picker-selected-badge">
                          <Check size={13} aria-hidden="true" /> Current branch
                        </span>
                      )}
                    </div>
                    <span
                      className={`branch-picker-availability ${available ? '' : 'branch-picker-unavailable'}`}
                    >
                      {available ? 'Accepting orders' : 'Ordering paused · browse menu'}
                    </span>
                    <p className="branch-picker-address">
                      <MapPin size={16} aria-hidden="true" />
                      <span>{branch.settings.address}</span>
                    </p>
                    <p className="branch-picker-contact">
                      <Clock size={16} aria-hidden="true" />
                      <span>{branch.settings.openingHours}</span>
                    </p>
                    <a
                      className="branch-picker-contact"
                      href={`tel:${branch.settings.phone.replace(/[^\d+]/g, '')}`}
                    >
                      <Phone size={16} aria-hidden="true" />
                      {branch.settings.phone}
                    </a>
                    <div className="branch-picker-services">
                      {branch.settings.deliveryEnabled && (
                        <span>
                          <Truck size={14} aria-hidden="true" />
                          {checkedPin
                            ? deliveryMatches(branch)
                              ? `Delivers to ${checkedPin}`
                              : `No delivery to ${checkedPin}`
                            : 'Home delivery'}
                        </span>
                      )}
                      {branch.settings.pickupEnabled && (
                        <span>
                          <ShoppingBag size={14} aria-hidden="true" /> Pickup
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className={`btn ${selected ? 'btn-outline' : 'btn-primary'} branch-picker-select`}
                      onClick={() => choose(branch)}
                    >
                      {selected
                        ? `Continue with ${branch.name}`
                        : available
                          ? 'Choose this branch'
                          : 'Browse this branch'}
                    </button>
                  </article>
                );
              })}
            </div>
            {!branches.length && (
              <p className="branch-picker-description">No branches are available right now.</p>
            )}
            {selectionError && (
              <p className="branch-picker-error" role="alert">
                {selectionError}
              </p>
            )}
            <p className="branch-picker-footer-note">
              We’ll confirm delivery again with your complete address at checkout.
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
