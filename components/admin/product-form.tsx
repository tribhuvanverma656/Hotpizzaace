'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ImagePlus, Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import type { Product, Option } from '@/types';
import { useDemoStore } from '@/lib/store';
import { PageHeading } from './shared';

type OptionDraft = {
  id: string;
  name: string;
  rupees: string;
  sizePrices?: Record<string, string>;
};
type Draft = Omit<Product, 'price' | 'sizes' | 'crusts' | 'toppings'> & {
  rupees: string;
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
}: {
  title: string;
  description: string;
  options: OptionDraft[];
  onChange: (options: OptionDraft[]) => void;
  defaultPrice?: string;
  sizes?: OptionDraft[];
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
  const { products, categories, saveProduct } = useDemoStore();
  const router = useRouter();
  const original = products.find((p) => p.id === id);
  const [draft, setDraft] = useState<Draft>(() =>
    original
      ? {
          ...original,
          rupees: String(original.price / 100),
          sizes: optionsToDraft(original.sizes),
          crusts: optionsToDraft(original.crusts),
          toppings: optionsToDraft(original.toppings),
        }
      : {
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
          sizes: [],
          crusts: [],
          toppings: [],
          badge: '',
          archived: false,
        },
  );
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState(false);
  const [uploading, setUploading] = useState(false);
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
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
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
    try {
      const { rupees, ...fields } = draft;
      void rupees;
      saveProduct({
        ...fields,
        archived: false,
        name: draft.name.trim(),
        slug,
        description: draft.description.trim(),
        price: Math.round(price * 100),
        sizes: convert(draft.sizes),
        crusts: convert(draft.crusts),
        toppings: convert(draft.toppings),
      });
      toast.success(
        isNew
          ? 'Product added to your menu'
          : original?.archived
            ? 'Product restored'
            : 'Product updated',
      );
      router.push('/admin/products');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this product.');
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
      <form className="admin-form" onSubmit={submit}>
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
                    Base price (₹) *
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
              description="Each size uses a full price. The first size matches the base price."
              options={draft.sizes}
              onChange={(options) => {
                set('sizes', options);
                if (options.length) set('rupees', options[0].rupees);
              }}
            />
            <OptionEditor
              title="Crusts"
              sizes={draft.sizes}
              description="Additional charges added to the base or size price."
              options={draft.crusts}
              onChange={(options) => set('crusts', options)}
            />
            <OptionEditor
              title="Toppings & extras"
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
                <small className="muted">
                  JPG, PNG, WebP · max 1.5 MB. Stored locally in this demo.
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
              Printed menu. Saving updates this browser’s storefront immediately.
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
          <button type="submit" className="btn btn-primary" disabled={uploading}>
            <Save size={16} />
            {isNew ? 'Create product' : original?.archived ? 'Restore product' : 'Save changes'}
          </button>
        </div>
      </form>
    </>
  );
}
