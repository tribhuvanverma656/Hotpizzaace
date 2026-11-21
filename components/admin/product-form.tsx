'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ImagePlus, Plus, Trash2, Save, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { Product, Option } from '@/types';
import { useAdminStore } from '@/components/admin/use-admin-store';
import { PageHeading } from './shared';

type OptionDraft = {
  id: string;
  name: string;
  rupees: string;
  sizePrices?: Record<string, string>;
};
type Draft = Omit<Product, 'price' | 'sizes' | 'crusts' | 'toppings' | 'gstInclusive'> & {
  rupees: string;
  gstInclusiveEnabled: boolean;
  gstRatePercent: string;
  gstCode: string;
  sizes: OptionDraft[];
  crusts: OptionDraft[];
  toppings: OptionDraft[];
};
const makeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
const optionsToDraft = (options: Option[]) =>
  options.map((o) => ({
    id: o.id,
    name: o.name,
    rupees: String(o.price / 100),
    ...(o.sizePrices
      ? {
          sizePrices: Object.fromEntries(
            Object.entries(o.sizePrices).map(([id, price]) => [id, String(price / 100)]),
          ),
        }
      : {}),
  }));
function OptionEditor({
  title,
  description,
  options,
  onChange,
  defaultPrice = '0',
  sizes = [],
  disableAdd = false,
}: {
  title: string;
  description: string;
  options: OptionDraft[];
  onChange: (options: OptionDraft[]) => void;
  defaultPrice?: string;
  sizes?: OptionDraft[];
  disableAdd?: boolean;
}) {
  return (
    <section className="admin-card admin-section-gap">
      <div className="admin-card-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <button
          type="button"
          className="btn btn-outline admin-small-btn"
          disabled={disableAdd}
          onClick={() =>
            onChange([
              ...options,
              {
                id: crypto.randomUUID(),
                name: '',
                rupees: options.length === 0 ? defaultPrice : '0',
              },
            ])
          }
        >
          <Plus size={15} /> Add option
        </button>
      </div>
      <div className="admin-options-list">
        {options.map((option, index) => (
          <div className="admin-option-block" key={index}>
            <div className="admin-option-row">
              <label className="field">
                Option name
                <input
                  required
                  value={option.name}
                  maxLength={60}
                  onChange={(e) =>
                    onChange(
                      options.map((o, i) => (i === index ? { ...o, name: e.target.value } : o)),
                    )
                  }
                  placeholder="e.g. Regular"
                />
              </label>
              <label className="field">
                Option ID
                <input
                  required
                  value={option.id}
                  pattern="[a-zA-Z0-9_-]+"
                  onChange={(e) =>
                    onChange(
                      options.map((o, i) => (i === index ? { ...o, id: e.target.value } : o)),
                    )
                  }
                />
              </label>
              <label className="field">
                Price (₹)
                <input
                  type="number"
                  required
                  min="0"
                  max="100000"
                  step="0.01"
                  value={option.rupees}
                  onChange={(e) =>
                    onChange(
                      options.map((o, i) => (i === index ? { ...o, rupees: e.target.value } : o)),
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="admin-icon-link admin-danger-text"
                aria-label={`Remove ${option.name || 'option'}`}
                onClick={() => onChange(options.filter((_, i) => i !== index))}
              >
                <Trash2 size={17} />
              </button>
            </div>
            {sizes.length > 0 && (
              <div className="admin-size-prices">
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={!!option.sizePrices}
                    onChange={(event) =>
                      onChange(
                        options.map((o, i) =>
                          i === index
                            ? {
                                ...o,
                                sizePrices: event.target.checked
                                  ? Object.fromEntries(sizes.map((size) => [size.id, o.rupees]))
                                  : undefined,
                              }
                            : o,
                        ),
                      )
                    }
                  />
                  Charge by selected size
                </label>
                {option.sizePrices && (
                  <div className="admin-size-price-grid">
                    {sizes.map((size) => (
                      <label className="field" key={size.id}>
                        {size.name || size.id} (₹)
                        <input
                          type="number"
                          required
                          min="0"
                          max="100000"
                          step="0.01"
                          value={option.sizePrices?.[size.id] ?? option.rupees}
                          onChange={(event) =>
                            onChange(
                              options.map((o, i) =>
                                i === index
                                  ? {
                                      ...o,
                                      sizePrices: {
                                        ...o.sizePrices,
                                        [size.id]: event.target.value,
                                      },
                                    }
                                  : o,
                              ),
                            )
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {!options.length && (
          <p className="muted">
            No {title.toLowerCase()} configured. Customers will use the standard product.
          </p>
        )}
      </div>
    </section>
  );
}

export function ProductForm({ isNew = false }: { isNew?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const { products, categories, saveProduct, shared, saving } = useAdminStore();
  const router = useRouter();
  const [originalRevision] = useState(shared.revision);
  const original = products.find((p) => p.id === id);
  const [draft, setDraft] = useState<Draft>(() => {
    if (original) {
      const { gstInclusive, ...product } = original;
      return {
        ...product,
        rupees: String(original.price / 100),
        gstInclusiveEnabled: !!gstInclusive,
        gstRatePercent: gstInclusive ? String(gstInclusive.rateBps / 100) : '',
        gstCode: gstInclusive?.code ?? '',
        sizes: optionsToDraft(original.sizes),
        crusts: optionsToDraft(original.crusts),
        toppings: optionsToDraft(original.toppings),
      };
    }
    return {
      id: crypto.randomUUID(),
      name: '',
      slug: '',
      description: '',
      image: '',
      categoryId: categories.find((c) => !c.archived)?.id || '',
      vegetarian: true,
      available: true,
      featured: false,
      bestseller: false,
      rupees: '',
      gstInclusiveEnabled: false,
      gstRatePercent: '',
      gstCode: '',
      sizes: [],
      crusts: [],
      toppings: [],
      badge: '',
      archived: false,
    };
  });
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submissionInFlight = useRef(false);
  const busy = submitting || saving;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  if (!isNew && !original)
    return (
      <div className="empty-state">
        <h1>Product not found</h1>
        <Link href="/admin/products" className="btn btn-primary">
          Back to menu
        </Link>
      </div>
    );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submissionInFlight.current || saving || uploading) return;
    setError('');
    if (draft.name.trim().length < 2 || draft.description.trim().length < 10) {
      setError(
        'Enter a name of at least 2 characters and a description of at least 10 characters.',
      );
      return;
    }
    if (!draft.categoryId || !categories.some((c) => c.id === draft.categoryId && !c.archived)) {
      setError('Choose an active category.');
      return;
    }
    if (!draft.image.trim() || imageError) {
      setError('Add an image that can be previewed.');
      return;
    }
    if (!(
      draft.image.startsWith('https://') ||
      draft.image.startsWith('/') ||
      draft.image.startsWith('data:image/')
    )) {
      setError('Use an HTTPS image URL or upload a supported image.');
      return;
    }
    const price = Number(draft.rupees);
    if (!Number.isFinite(price) || price <= 0 || price > 100000) {
      setError('Base price must be between ₹0.01 and ₹1,00,000.');
      return;
    }
    let gstInclusive: Product['gstInclusive'];
    if (draft.gstInclusiveEnabled) {
      const rateText = draft.gstRatePercent.trim();
      const [whole, fraction = ''] = rateText.split('.');
      const rateBps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      if (
        !/^\d{1,2}(?:\.\d{1,2})?$/.test(rateText) ||
        !Number.isSafeInteger(rateBps) ||
        rateBps < 1 ||
        rateBps > 4000 ||
        rateBps % 2 !== 0
      ) {
        setError('Enter the total GST rate from 0.02% to 40%, in increments of 0.02%.');
        return;
      }
      const code = draft.gstCode.trim();
      if (!/^(?:\d{4}|\d{6}|\d{8})$/.test(code)) {
        setError('Enter the applicable HSN / SAC code using 4, 6 or 8 digits.');
        return;
      }
      if (draft.crusts.length || draft.toppings.length) {
        setError(
          'Remove crusts and toppings before using a price that includes GST. Sizes may have their own final MRP.',
        );
        return;
      }
      gstInclusive = { rateBps, code };
    }
    const slug = makeSlug(draft.slug);
    if (!slug || products.some((p) => p.slug === slug && p.id !== draft.id)) {
      setError('Use a unique, nonempty URL slug.');
      return;
    }
    const groups = [draft.sizes, draft.crusts, draft.toppings];
    if (
      groups.some(
        (group) =>
          new Set(group.map((o) => o.id)).size !== group.length ||
          group.some(
            (o) =>
              !o.id.trim() ||
              !o.name.trim() ||
              !Number.isFinite(Number(o.rupees)) ||
              Number(o.rupees) < 0 ||
              Number(o.rupees) > 100000 ||
              Object.values(o.sizePrices ?? {}).some(
                (value) =>
                  !value.trim() ||
                  !Number.isFinite(Number(value)) ||
                  Number(value) < 0 ||
                  Number(value) > 100000,
              ),
          ),
      )
    ) {
      setError(
        'Every option needs a unique ID within its group, a name, and a valid nonnegative price.',
      );
      return;
    }
    const convert = (options: OptionDraft[]): Option[] =>
      options.map((o) => ({
        id: o.id.trim(),
        name: o.name.trim(),
        price: Math.round(Number(o.rupees) * 100),
        ...(o.sizePrices
          ? {
              sizePrices: Object.fromEntries(
                draft.sizes.map((size) => [
                  size.id,
                  Math.round(Number(o.sizePrices?.[size.id] ?? o.rupees) * 100),
                ]),
              ),
            }
          : {}),
      }));
    submissionInFlight.current = true;
    setSubmitting(true);
    const toastId = `product-save-${draft.id}`;
    toast.loading(isNew ? 'Creating product…' : 'Saving product…', { id: toastId });
    try {
      const { rupees, gstInclusiveEnabled, gstRatePercent, gstCode, ...fields } = draft;
      void rupees;
      void gstInclusiveEnabled;
      void gstRatePercent;
      void gstCode;
      await saveProduct(
        {
          ...fields,
          archived: false,
          name: draft.name.trim(),
          slug,
          description: draft.description.trim(),
          price: Math.round(price * 100),
          sizes: convert(draft.sizes),
          crusts: convert(draft.crusts),
          toppings: convert(draft.toppings),
          ...(gstInclusive ? { gstInclusive } : {}),
        },
        originalRevision,
      );
      toast.success(
        isNew
          ? 'Product added to your menu'
          : original?.archived
            ? 'Product restored'
            : 'Product updated',
        { id: toastId },
      );
      router.push('/admin/products');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save this product.';
      setError(message);
      toast.error(message, { id: toastId });
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };
  return (
    <>
      <Link href="/admin/products" className="admin-back-link">
        <ArrowLeft size={15} /> Menu & products
      </Link>
      <PageHeading
        eyebrow="MAKE IT IRRESISTIBLE"
        title={
          isNew
            ? 'Add a new product'
            : `${original?.archived ? 'Restore' : 'Edit'} ${original?.name}`
        }
        description="From the first photo to the last topping, make every detail count."
      />
      {original?.archived && (
        <p className="admin-inline-note">
          This product is deleted. Saving restores it to the active list. Choose an active category
          and turn on “Available to order” when it is ready to sell.
        </p>
      )}
      <form className="admin-form" onSubmit={submit} aria-busy={busy}>
        <p className="sr-only" role="status">
          {busy ? 'Saving your product. Please wait.' : ''}
        </p>
        <div className="admin-product-form-grid">
          <div>
            <section className="admin-card">
              <div className="admin-card-heading">
                <h2>The essentials</h2>
                <span className="muted">Required fields *</span>
              </div>
              <div className="admin-card-padding admin-form">
                <label className="field">
                  Product name *
                  <input
                    required
                    maxLength={100}
                    value={draft.name}
                    onChange={(e) => {
                      set('name', e.target.value);
                      if (isNew) set('slug', makeSlug(e.target.value));
                    }}
                    placeholder="e.g. Smoky Paneer Pizza"
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    URL slug *
                    <input
                      required
                      maxLength={120}
                      value={draft.slug}
                      onChange={(e) => set('slug', e.target.value)}
                    />
                  </label>
                  <label className="field">
                    Category *
                    <select
                      required
                      value={draft.categoryId}
                      onChange={(e) => set('categoryId', e.target.value)}
                    >
                      <option value="">Choose a category</option>
                      {categories
                        .filter((c) => !c.archived)
                        .map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <label className="field">
                  Description *
                  <textarea
                    required
                    rows={4}
                    maxLength={1000}
                    value={draft.description}
                    onChange={(e) => set('description', e.target.value)}
                    placeholder="Tell your customers what makes this special…"
                  />
                </label>
                <div className="form-grid">
                  <label className="field">
                    {draft.gstInclusiveEnabled ? 'Final price / MRP (₹) *' : 'Base price (₹) *'}
                    <input
                      required
                      type="number"
                      min="0.01"
                      max="100000"
                      step="0.01"
                      value={draft.rupees}
                      onChange={(e) => {
                        set('rupees', e.target.value);
                        if (draft.sizes.length)
                          set(
                            'sizes',
                            draft.sizes.map((size, index) =>
                              index === 0 ? { ...size, rupees: e.target.value } : size,
                            ),
                          );
                      }}
                    />
                  </label>
                  <label className="field">
                    Menu badge
                    <input
                      value={draft.badge || ''}
                      maxLength={25}
                      onChange={(e) => set('badge', e.target.value)}
                      placeholder="e.g. Chef’s special"
                    />
                  </label>
                </div>
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.gstInclusiveEnabled}
                    onChange={(event) => set('gstInclusiveEnabled', event.target.checked)}
                  />
                  <span>
                    MRP / GST included in price
                    <small>
                      Use for a packaged item whose listed selling price already includes GST.
                    </small>
                  </span>
                </label>
                {draft.gstInclusiveEnabled && (
                  <>
                    <div className="form-grid">
                      <label className="field">
                        Total GST rate (%) *
                        <input
                          required
                          type="number"
                          min="0.02"
                          max="40"
                          step="0.02"
                          value={draft.gstRatePercent}
                          onChange={(event) => set('gstRatePercent', event.target.value)}
                        />
                      </label>
                      <label className="field">
                        HSN / SAC code *
                        <input
                          required
                          inputMode="numeric"
                          pattern="(?:[0-9]{4}|[0-9]{6}|[0-9]{8})"
                          maxLength={8}
                          value={draft.gstCode}
                          onChange={(event) => set('gstCode', event.target.value)}
                        />
                      </label>
                    </div>
                    <p className="muted">
                      Enter the correct tax rate and classification for this item. GST is split
                      equally into CGST and SGST within the listed price. Set each size to its final
                      selling price, at or below the printed MRP. Crusts and toppings are
                      unavailable.
                    </p>
                  </>
                )}
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.vegetarian}
                    onChange={(e) => set('vegetarian', e.target.checked)}
                  />
                  <span>
                    Vegetarian product<small>Uncheck for products containing meat or fish.</small>
                  </span>
                </label>
              </div>
            </section>
            <OptionEditor
              defaultPrice={draft.rupees || '0'}
              title="Sizes"
              description={
                draft.gstInclusiveEnabled
                  ? 'Each size uses its final selling price including GST. The first size matches the base price.'
                  : 'Each size uses a full price. The first size matches the base price.'
              }
              options={draft.sizes}
              onChange={(options) => {
                set('sizes', options);
                if (options.length) set('rupees', options[0].rupees);
              }}
            />
            <OptionEditor
              title="Crusts"
              disableAdd={draft.gstInclusiveEnabled}
              sizes={draft.sizes}
              description="Additional charges added to the base or size price."
              options={draft.crusts}
              onChange={(options) => set('crusts', options)}
            />
            <OptionEditor
              title="Toppings & extras"
              disableAdd={draft.gstInclusiveEnabled}
              sizes={draft.sizes}
              description="Customers may select multiple extras. Prices are per item."
              options={draft.toppings}
              onChange={(options) => set('toppings', options)}
            />
          </div>
          <div>
            <section className="admin-card">
              <div className="admin-card-heading">
                <h2>Product image</h2>
              </div>
              <div className="admin-card-padding admin-form">
                <div className="admin-image-preview">
                  {draft.image && !imageError ? (
                    <img
                      src={draft.image}
                      alt="Product preview"
                      onError={() => setImageError(true)}
                    />
                  ) : (
                    <div>
                      <ImagePlus size={32} />
                      <span>
                        {imageError ? 'Image could not be loaded' : 'Add something appetizing'}
                      </span>
                    </div>
                  )}
                </div>
                {!shared.enabled && (
                  <label className="btn btn-outline admin-upload-label">
                    <ImagePlus size={16} />
                    {uploading ? 'Reading image…' : 'Upload image'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (
                          !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
                          file.size > 1500000
                        ) {
                          toast.error('Use a JPG, PNG, or WebP image under 1.5 MB.');
                          return;
                        }
                        setUploading(true);
                        const reader = new FileReader();
                        reader.onload = () => {
                          set('image', String(reader.result));
                          setImageError(false);
                          setUploading(false);
                        };
                        reader.onerror = () => {
                          toast.error('Could not read image');
                          setUploading(false);
                        };
                        reader.readAsDataURL(file);
                      }}
                    />
                  </label>
                )}
                <small className="muted">
                  {shared.enabled
                    ? 'Images are saved with the shared menu. Use a public HTTPS image URL.'
                    : 'JPG, PNG, WebP · max 1.5 MB. Stored locally in this demo.'}
                </small>
                <label className="field">
                  Or use an image URL
                  <input
                    type="text"
                    value={draft.image.startsWith('data:') ? '' : draft.image}
                    onChange={(e) => {
                      set('image', e.target.value);
                      setImageError(false);
                    }}
                    placeholder="https://…"
                  />
                </label>
              </div>
            </section>
            <section className="admin-card admin-section-gap">
              <div className="admin-card-heading">
                <h2>Visibility & highlights</h2>
              </div>
              <div className="admin-card-padding admin-form">
                {[
                  {
                    key: 'available' as const,
                    label: 'Available to order',
                    description: 'Visible and orderable on the storefront.',
                  },
                  {
                    key: 'featured' as const,
                    label: 'Featured product',
                    description: 'Show in the homepage’s featured selection.',
                  },
                  {
                    key: 'bestseller' as const,
                    label: 'Bestseller',
                    description: 'Highlight this customer favorite.',
                  },
                ].map(({ key, label, description }) => (
                  <label className="admin-checkbox" key={key}>
                    <input
                      type="checkbox"
                      checked={draft[key]}
                      onChange={(e) => set(key, e.target.checked)}
                    />
                    <span>
                      {label}
                      <small>{description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>
            <div className="admin-inline-note admin-section-gap">
              {shared.enabled
                ? 'Saving updates the shared menu for every connected device.'
                : 'Printed menu. Saving updates this browser’s storefront immediately.'}
            </div>
          </div>
        </div>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="admin-form-footer">
          <Link href="/admin/products" className="btn btn-outline">
            Cancel
          </Link>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || uploading}
            aria-busy={busy}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" aria-hidden="true" />
            ) : (
              <Save size={16} aria-hidden="true" />
            )}
            {busy
              ? isNew
                ? 'Creating…'
                : 'Saving…'
              : isNew
                ? 'Create product'
                : original?.archived
                  ? 'Restore product'
                  : 'Save changes'}
          </button>
        </div>
      </form>
    </>
  );
}
