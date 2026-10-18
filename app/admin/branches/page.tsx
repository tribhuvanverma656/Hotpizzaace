'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Phone, Plus, Save, Settings2, Store, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeading } from '@/components/admin/shared';
import { initialSettings } from '@/lib/data';
import { useDemoStore } from '@/lib/store';
import type { Branch } from '@/types';
import styles from '@/components/admin/admin-branches.module.css';

type BranchDraft = {
  name: string;
  address: string;
  phone: string;
  postalCodes: string;
  openingHours: string;
};

function freshDraft(): BranchDraft {
  return {
    name: '',
    address: '',
    phone: '',
    postalCodes: '',
    openingHours: initialSettings.openingHours,
  };
}

function kitchenLabel(branch: Branch) {
  const { settings } = branch;
  if (settings.temporarilyClosed) return 'Temporarily closed';
  if (!settings.acceptingOrders) return 'Orders paused';
  if (!settings.deliveryEnabled && !settings.pickupEnabled) return 'Service unavailable';
  return 'Accepting orders';
}

export default function BranchesPage() {
  const router = useRouter();
  const { branches, adminBranchId, selectAdminBranch, saveBranch } = useDemoStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<BranchDraft>(freshDraft);
  const [error, setError] = useState('');
  const formHeading = useRef<HTMLHeadingElement>(null);
  const set = (field: keyof BranchDraft, value: string) =>
    setDraft((previous) => ({ ...previous, [field]: value }));
  const openForm = (branch?: Branch) => {
    setEditingId(branch?.id ?? null);
    setDraft(
      branch
        ? {
            name: branch.name,
            address: branch.settings.address,
            phone: branch.settings.phone,
            postalCodes: branch.settings.servicePostalCodes.join(', '),
            openingHours: branch.settings.openingHours,
          }
        : freshDraft(),
    );
    setError('');
    setFormOpen(true);
    requestAnimationFrame(() => {
      formHeading.current?.focus();
      formHeading.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  return (
    <div className={styles.page}>
      <PageHeading
        eyebrow="YOUR LOCATIONS"
        title="Branches"
        description="Manage each restaurant’s address, service area and order settings."
      >
        <button type="button" className="btn btn-primary" onClick={() => openForm()}>
          <Plus size={17} />
          Add branch
        </button>
      </PageHeading>
      <div className={styles.catalogNote}>
        <Store size={21} aria-hidden="true" />
        <p>
          <strong>
            {branches.length} {branches.length === 1 ? 'branch' : 'branches'}
          </strong>{' '}
          · The menu and product catalog are shared. Delivery fees, kitchen availability, coupons
          and payment options are managed for each branch.
        </p>
      </div>
      <div className={styles.grid}>
        {branches.map((branch) => (
          <article className={`admin-card ${styles.card}`} key={branch.id}>
            <div className={styles.cardHeader}>
              <div className={styles.locationIcon}>
                <Store size={22} aria-hidden="true" />
              </div>
              {branch.id === adminBranchId && (
                <span className={styles.selectedBadge}>Managing now</span>
              )}
            </div>
            <h2>{branch.name}</h2>
            <p className={styles.kitchenStatus}>
              <span
                className={
                  kitchenLabel(branch) === 'Accepting orders' ? styles.openDot : styles.closedDot
                }
              />
              {kitchenLabel(branch)}
            </p>
            <dl className={styles.details}>
              <div>
                <dt>
                  <MapPin size={16} />
                  Address
                </dt>
                <dd>{branch.settings.address}</dd>
              </div>
              <div>
                <dt>
                  <Phone size={16} />
                  Phone
                </dt>
                <dd>{branch.settings.phone}</dd>
              </div>
              <div>
                <dt>Delivery PINs</dt>
                <dd>{branch.settings.servicePostalCodes.join(', ') || 'Not configured'}</dd>
              </div>
              <div>
                <dt>Hours</dt>
                <dd>{branch.settings.openingHours}</dd>
              </div>
            </dl>
            <div className={styles.actions}>
              <button
                type="button"
                className="btn btn-dark"
                onClick={() => {
                  selectAdminBranch(branch.id);
                  router.push('/admin/settings');
                }}
              >
                <Settings2 size={16} />
                Manage settings
              </button>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => openForm(branch)}
                aria-label={`Edit ${branch.name}`}
              >
                <Pencil size={15} />
                Edit
              </button>
            </div>
          </article>
        ))}
      </div>
      {formOpen && (
        <section className={`admin-card ${styles.formCard}`}>
          <div className={styles.formHeader}>
            <div>
              <h2 ref={formHeading} tabIndex={-1}>
                {editingId ? 'Edit branch' : 'Add a branch'}
              </h2>
              <p>
                {editingId
                  ? 'Update this location’s contact and service details.'
                  : 'New branches start with orders paused. Review settings before opening the kitchen.'}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              aria-label="Close branch form"
              onClick={() => setFormOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              setError('');
              try {
                const name = draft.name.trim();
                const codes = [
                  ...new Set(
                    draft.postalCodes
                      .split(/[\s,]+/)
                      .map((code) => code.trim())
                      .filter(Boolean),
                  ),
                ];
                if (name.length < 2 || name.length > 100)
                  throw new Error('Enter a branch name between 2 and 100 characters.');
                if (
                  branches.some(
                    (branch) =>
                      branch.id !== editingId && branch.name.toLowerCase() === name.toLowerCase(),
                  )
                )
                  throw new Error(
                    'A branch already uses this name. Choose a distinct location name.',
                  );
                if (!codes.length || codes.some((code) => !/^\d{6}$/.test(code)))
                  throw new Error('Enter at least one valid six-digit delivery PIN code.');
                const existing = branches.find((branch) => branch.id === editingId);
                const slugBase =
                  name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '') || 'branch';
                let slug = existing?.slug ?? slugBase;
                let suffix = 2;
                while (branches.some((branch) => branch.id !== editingId && branch.slug === slug))
                  slug = `${slugBase}-${suffix++}`;
                const branch: Branch = {
                  id: existing?.id ?? `branch-${crypto.randomUUID()}`,
                  slug,
                  name,
                  settings: {
                    ...(existing?.settings ?? initialSettings),
                    ...(!existing ? { acceptingOrders: false, temporarilyClosed: false } : {}),
                    address: draft.address.trim(),
                    phone: draft.phone.trim(),
                    openingHours: draft.openingHours.trim(),
                    servicePostalCodes: codes,
                  },
                };
                saveBranch(branch);
                toast.success(
                  existing
                    ? 'Branch updated'
                    : 'Branch added. Review its settings before accepting orders.',
                );
                setFormOpen(false);
                selectAdminBranch(branch.id);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Unable to save this branch.');
              }
            }}
          >
            <div className={styles.formGrid}>
              <label className="field">
                Branch name
                <input
                  name="branchName"
                  required
                  minLength={2}
                  maxLength={100}
                  autoComplete="off"
                  placeholder="e.g. Barra · Kanpur"
                  value={draft.name}
                  onChange={(event) => set('name', event.target.value)}
                />
              </label>
              <label className="field">
                Contact number
                <input
                  name="branchPhone"
                  required
                  type="tel"
                  autoComplete="tel"
                  maxLength={20}
                  placeholder="10-digit mobile number"
                  value={draft.phone}
                  onChange={(event) => set('phone', event.target.value)}
                />
              </label>
              <label className={`field ${styles.fullWidth}`}>
                Complete address
                <textarea
                  name="branchAddress"
                  required
                  minLength={8}
                  maxLength={300}
                  autoComplete="street-address"
                  rows={2}
                  placeholder="Building, street, locality, city and PIN"
                  value={draft.address}
                  onChange={(event) => set('address', event.target.value)}
                />
              </label>
              <label className="field">
                Delivery PIN codes
                <input
                  name="branchPostalCodes"
                  required
                  maxLength={800}
                  placeholder="e.g. 208027, 208022"
                  value={draft.postalCodes}
                  onChange={(event) => set('postalCodes', event.target.value)}
                />
                <small>Separate each six-digit code with a comma.</small>
              </label>
              <label className="field">
                Opening hours
                <input
                  name="branchHours"
                  required
                  minLength={3}
                  maxLength={200}
                  value={draft.openingHours}
                  onChange={(event) => set('openingHours', event.target.value)}
                />
              </label>
            </div>
            {error && (
              <p role="alert" className="error-message">
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <button className="btn btn-primary" type="submit">
                <Save size={16} />
                {editingId ? 'Save branch' : 'Create branch'}
              </button>
              <button className="btn btn-outline" type="button" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
