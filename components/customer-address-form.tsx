'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Check, MapPin } from 'lucide-react';
import type { Customer, SavedAddress } from '@/types';

export function CustomerAddressForm({
  address,
  phone,
  firstAddress,
  saveBlocked = false,
  onSave,
  onCancel,
}: {
  address?: SavedAddress;
  phone: string;
  firstAddress: boolean;
  saveBlocked?: boolean;
  onSave: (input: Omit<SavedAddress, 'ownerPhone'>) => void;
  onCancel: () => void;
}) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const submitted = useRef(false);
  const [recordId] = useState(() => address?.id || crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [labelType, setLabelType] = useState(
    address && !['Home', 'Work'].includes(address.label) ? 'Other' : address?.label || 'Home',
  );
  const [customLabel, setCustomLabel] = useState(
    address && !['Home', 'Work'].includes(address.label) ? address.label : '',
  );
  const [customer, setCustomer] = useState<Customer>(
    address
      ? { ...address.customer, phone, instructions: '' }
      : {
          name: '',
          phone,
          address: '',
          locality: '',
          postalCode: '',
          landmark: '',
          instructions: '',
        },
  );
  const [isDefault, setIsDefault] = useState(!!address?.isDefault);
  const [error, setError] = useState('');
  type AddressField = 'label' | 'name' | 'address' | 'locality' | 'postalCode' | 'landmark';
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AddressField, string>>>({});
  useEffect(() => {
    nameField.current?.focus();
  }, []);
  const update = (key: keyof Customer, value: string) => {
    setCustomer((previous) => ({ ...previous, [key]: value }));
    setError('');
    setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
  };
  const fieldError = (key: AddressField) =>
    fieldErrors[key] ? (
      <small className="customer-address-field-error" id={`${formId}-${key}-error`}>
        {fieldErrors[key]}
      </small>
    ) : null;

  return (
    <form
      className="customer-address-form"
      ref={formRef}
      noValidate
      aria-busy={busy}
      aria-label={address ? 'Edit saved address' : 'Add a new address'}
      onSubmit={(event) => {
        event.preventDefault();
        if (submitted.current || saveBlocked) return;
        setError('');
        const label = (labelType === 'Other' ? customLabel : labelType).trim();
        const values = {
          ...customer,
          name: customer.name.trim(),
          address: customer.address.trim(),
          locality: customer.locality.trim(),
          postalCode: customer.postalCode.trim(),
          landmark: customer.landmark.trim(),
          phone,
          instructions: '',
        };
        const errors: Partial<Record<AddressField, string>> = {};
        if (label.length < 1 || label.length > 40)
          errors.label = 'Enter an address label between 1 and 40 characters.';
        if (values.name.length < 2 || values.name.length > 80)
          errors.name = 'Enter a full name between 2 and 80 characters.';
        if (values.address.length < 8 || values.address.length > 300)
          errors.address = 'Enter a complete address between 8 and 300 characters.';
        if (values.locality.length < 2 || values.locality.length > 100)
          errors.locality = 'Enter a locality between 2 and 100 characters.';
        if (!/^[1-9]\d{5}$/.test(values.postalCode))
          errors.postalCode = 'Enter a valid six-digit Indian PIN that does not start with 0.';
        if (values.landmark.length > 150)
          errors.landmark = 'Keep the landmark within 150 characters.';
        setFieldErrors(errors);
        const firstInvalid = Object.keys(errors)[0];
        if (firstInvalid) {
          setError('Check the highlighted fields before saving your address.');
          formRef.current?.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
          return;
        }
        submitted.current = true;
        setBusy(true);
        try {
          onSave({
            id: recordId,
            label,
            customer: values,
            isDefault: firstAddress || !!address?.isDefault || isDefault,
          });
        } catch (err) {
          submitted.current = false;
          setBusy(false);
          setError(err instanceof Error ? err.message : 'Could not save this address.');
        }
      }}
    >
      <div className="customer-address-form-heading">
        <span>
          <MapPin size={20} aria-hidden="true" />
        </span>
        <div>
          <h2>{address ? 'Edit your address' : 'Add a delivery address'}</h2>
          <p>A few details now make your next checkout easier.</p>
        </div>
      </div>
      <fieldset className="customer-address-labels">
        <legend>Save as</legend>
        {['Home', 'Work', 'Other'].map((label) => (
          <label key={label}>
            <input
              type="radio"
              name="address-label-type"
              value={label}
              checked={labelType === label}
              onChange={() => {
                setLabelType(label);
                setFieldErrors((previous) => ({ ...previous, label: undefined }));
                setError('');
              }}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      {labelType === 'Other' && (
        <label className="field">
          Address label
          <input
            required
            name="label"
            minLength={1}
            maxLength={40}
            value={customLabel}
            onChange={(event) => {
              setCustomLabel(event.target.value);
              setFieldErrors((previous) => ({ ...previous, label: undefined }));
              setError('');
            }}
            aria-invalid={!!fieldErrors.label}
            aria-describedby={fieldErrors.label ? `${formId}-label-error` : undefined}
            placeholder="e.g. Parents’ home"
          />
          {fieldError('label')}
        </label>
      )}
      <div className="customer-address-fields">
        <label className="field">
          Full name
          <input
            ref={nameField}
            name="name"
            required
            minLength={2}
            maxLength={80}
            autoComplete="name"
            value={customer.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="Name for this delivery"
            aria-invalid={!!fieldErrors.name}
            aria-describedby={fieldErrors.name ? `${formId}-name-error` : undefined}
          />
          {fieldError('name')}
        </label>
        <label className="field">
          Mobile number
          <input type="tel" readOnly autoComplete="tel" value={phone} />
          <small>Saved with your signed-in mobile number.</small>
        </label>
        <label className="field customer-address-wide-field">
          Complete address
          <input
            required
            name="address"
            minLength={8}
            maxLength={300}
            autoComplete="street-address"
            value={customer.address}
            onChange={(event) => update('address', event.target.value)}
            placeholder="Flat / house number, building and street"
            aria-invalid={!!fieldErrors.address}
            aria-describedby={fieldErrors.address ? `${formId}-address-error` : undefined}
          />
          {fieldError('address')}
        </label>
        <label className="field">
          Locality
          <input
            required
            name="locality"
            minLength={2}
            maxLength={100}
            autoComplete="address-level3"
            value={customer.locality}
            onChange={(event) => update('locality', event.target.value)}
            placeholder="e.g. Barra"
            aria-invalid={!!fieldErrors.locality}
            aria-describedby={fieldErrors.locality ? `${formId}-locality-error` : undefined}
          />
          {fieldError('locality')}
        </label>
        <label className="field">
          PIN code
          <input
            required
            name="postalCode"
            inputMode="numeric"
            pattern="[1-9][0-9]{5}"
            maxLength={6}
            autoComplete="postal-code"
            value={customer.postalCode}
            onChange={(event) =>
              update('postalCode', event.target.value.replace(/\D/g, '').slice(0, 6))
            }
            placeholder="6-digit PIN"
            aria-invalid={!!fieldErrors.postalCode}
            aria-describedby={fieldErrors.postalCode ? `${formId}-postalCode-error` : undefined}
          />
          {fieldError('postalCode')}
        </label>
        <label className="field customer-address-wide-field">
          Landmark <span className="customer-address-optional">Optional</span>
          <input
            name="landmark"
            maxLength={150}
            value={customer.landmark}
            onChange={(event) => update('landmark', event.target.value)}
            placeholder="A nearby place that helps us find you"
            aria-invalid={!!fieldErrors.landmark}
            aria-describedby={fieldErrors.landmark ? `${formId}-landmark-error` : undefined}
          />
          {fieldError('landmark')}
        </label>
      </div>
      <label className="customer-address-default-control">
        <input
          type="checkbox"
          checked={firstAddress || !!address?.isDefault || isDefault}
          disabled={firstAddress || !!address?.isDefault}
          onChange={(event) => setIsDefault(event.target.checked)}
        />
        <span>
          Use as my default address
          <small>
            {firstAddress
              ? 'Your first address becomes your default.'
              : address?.isDefault
                ? 'To change your default, choose another saved address.'
                : 'This address will be selected first at checkout.'}
          </small>
        </span>
      </label>
      <p className="customer-address-form-note">
        Delivery availability depends on your selected branch. Add instructions for each order at
        checkout.
      </p>
      {error && (
        <p className="customer-address-error" role="alert">
          {error}
        </p>
      )}
      <div className="customer-address-form-actions">
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || saveBlocked}>
          <Check size={17} aria-hidden="true" /> {busy ? 'Saving address…' : 'Save address'}
        </button>
      </div>
    </form>
  );
}
