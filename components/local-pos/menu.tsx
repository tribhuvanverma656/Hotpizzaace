'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Layers3,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { Category, Option, Product } from '@/types';
import type { CommerceCatalog } from '@/lib/commerce/domain';
import type { LocalRole, LocalUser } from '@/lib/local-pos/database';
import { money } from '@/lib/utils';
import { createClientUuid } from '@/lib/client-uuid';
import { LocalPosSidebar } from './sidebar';
import styles from './menu.module.css';

type Catalog = CommerceCatalog;
type View = 'products' | 'categories';
type DraftOption = { id: string; name: string; price: string; sizePrices?: Record<string, string> };
type ProductDraft = {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string;
  categoryId: string;
  vegetarian: boolean;
  available: boolean;
  featured: boolean;
  bestseller: boolean;
  badge: string;
  price: string;
  sizes: DraftOption[];
  crusts: DraftOption[];
  toppings: DraftOption[];
  gstInclusive: boolean;
  gstRate: string;
  gstCode: string;
};

const roleLabels: Record<LocalRole, string> = {
  super_user: 'Super User',
  pos_manager: 'POS Manager',
  kitchen: 'Kitchen Staff',
};

async function getJson<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? 'The local POS request failed.');
  return result;
}

function draftFromProduct(product: Product): ProductDraft {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    image: product.image,
    categoryId: product.categoryId,
    vegetarian: product.vegetarian,
    available: product.available,
    featured: product.featured,
    bestseller: product.bestseller,
    badge: product.badge ?? '',
    price: String(product.price / 100),
    sizes: product.sizes.map((option) => ({ id: option.id, name: option.name, price: String(option.price / 100) })),
    crusts: product.crusts.map((option) => ({
      id: option.id,
      name: option.name,
      price: String(option.price / 100),
      ...(option.sizePrices
        ? { sizePrices: Object.fromEntries(Object.entries(option.sizePrices).map(([id, value]) => [id, String(value / 100)])) }
        : {}),
    })),
    toppings: product.toppings.map((option) => ({
      id: option.id,
      name: option.name,
      price: String(option.price / 100),
      ...(option.sizePrices
        ? { sizePrices: Object.fromEntries(Object.entries(option.sizePrices).map(([id, value]) => [id, String(value / 100)])) }
        : {}),
    })),
    gstInclusive: !!product.gstInclusive,
    gstRate: product.gstInclusive ? String(product.gstInclusive.rateBps / 100) : '',
    gstCode: product.gstInclusive?.code ?? '',
  };
}

function newProduct(categoryId: string): ProductDraft {
  return {
    id: createClientUuid(),
    name: '',
    slug: '',
    description: '',
    image: '',
    categoryId,
    vegetarian: true,
    available: true,
    featured: false,
    bestseller: false,
    badge: '',
    price: '',
    sizes: [],
    crusts: [],
    toppings: [],
    gstInclusive: false,
    gstRate: '',
    gstCode: '',
  };
}

function makeSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function LocalMenu() {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [view, setView] = useState<View>('products');
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<ProductDraft | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<Category | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const session = await getJson<{ user: LocalUser | null }>('/api/local-pos/session');
      if (!session.user || !['super_user', 'pos_manager'].includes(session.user.role)) {
        setUser(null);
        setCatalog(null);
        return;
      }
      setUser(session.user);
      const result = await getJson<Catalog>('/api/local-pos/catalog');
      if (!Array.isArray(result.products) || !Array.isArray(result.categories))
        throw new Error('The saved menu could not be loaded.');
      setCatalog(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The menu could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeProducts = useMemo(
    () => catalog?.products.filter((product) => !product.archived) ?? [],
    [catalog],
  );
  const archivedProducts = useMemo(
    () => catalog?.products.filter((product) => product.archived) ?? [],
    [catalog],
  );
  const activeCategories = useMemo(
    () => [...(catalog?.categories ?? [])].filter((category) => !category.archived).sort((a, b) => a.sortOrder - b.sortOrder),
    [catalog],
  );
  const visibleProducts = useMemo(() => {
    const source = showArchived ? archivedProducts : activeProducts;
    const query = search.trim().toLowerCase();
    return source.filter((product) =>
      `${product.name} ${product.description}`.toLowerCase().includes(query),
    );
  }, [activeProducts, archivedProducts, search, showArchived]);

  async function mutate(action: string, args: unknown, success: string): Promise<boolean> {
    if (!catalog || busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await getJson<{ catalog: Catalog }>('/api/local-pos/catalog', 'PATCH', {
        action,
        args,
        expectedRevision: catalog.revision,
      });
      setCatalog(result.catalog);
      setNotice(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The menu update failed.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !catalog || busy) return;
    const price = Number(editing.price);
    if (!Number.isFinite(price) || price <= 0 || price > 100000) {
      setError('Enter a base price between ₹0.01 and ₹1,00,000.');
      return;
    }
    if (!editing.image.trim()) {
      setError('Add an image URL or a local image path.');
      return;
    }
    const convert = (options: DraftOption[]): Option[] =>
      options.map((option) => ({
        id: option.id.trim(),
        name: option.name.trim(),
        price: Math.round(Number(option.price) * 100),
        ...(option.sizePrices
          ? {
              sizePrices: Object.fromEntries(
                Object.entries(option.sizePrices).map(([id, value]) => [
                  id,
                  Math.round(Number(value) * 100),
                ]),
              ),
            }
          : {}),
      }));
    const slug = makeSlug(editing.slug || editing.name);
    const product: Product = {
      id: editing.id,
      name: editing.name.trim(),
      slug,
      description: editing.description.trim(),
      image: editing.image.trim(),
      categoryId: editing.categoryId,
      vegetarian: editing.vegetarian,
      available: editing.available,
      featured: editing.featured,
      bestseller: editing.bestseller,
      ...(editing.badge.trim() ? { badge: editing.badge.trim() } : {}),
      price: Math.round(price * 100),
      sizes: convert(editing.sizes),
      crusts: convert(editing.crusts),
      toppings: convert(editing.toppings),
      ...(editing.gstInclusive
        ? {
            gstInclusive: {
              rateBps: Math.round(Number(editing.gstRate) * 100),
              code: editing.gstCode.trim(),
            },
          }
        : {}),
    };
    if (product.sizes.length && product.price !== product.sizes[0].price) {
      setError('Base price must match the first size price. Set the same price in both fields.');
      return;
    }
    if (await mutate('saveProduct', { product }, 'Product saved to the local menu.'))
      setEditing(null);
  }

  if (loading && !user)
    return <main className={styles.statePage}><div className={styles.spinner} />Loading menu tools…</main>;
  if (!user)
    return (
      <main className={styles.statePage}>
        <h1>POS Manager sign-in required</h1>
        <p>Sign in as the Super User or POS Manager to manage products and categories.</p>
        <Link href="/local-pos">Go to POS sign in</Link>
      </main>
    );

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <Link href="/local-pos/dashboard"><Image src="/brand/hot-pizza-ace.gif" alt="" width={1806} height={1440} unoptimized /></Link>
          <div><strong>HOT PIZZA ACE</strong><span>MENU MANAGEMENT</span></div>
        </div>
        <div className={styles.topActions}>
          <span>{roleLabels[user.role]}</span><Link href="/local-pos">Team access</Link>
        </div>
      </header>
      <div className={styles.layout}>
        <LocalPosSidebar role={user.role} active="menu" />
        <section className={styles.content}>
          <div className={styles.heading}>
            <div><p>CATALOG MANAGEMENT</p><h1>Menu &amp; products</h1><span>Manage the locally saved menu used by the register.</span></div>
            <button className={styles.primary} onClick={() => { setError(''); setEditing(newProduct(activeCategories[0]?.id ?? '')); }}>
              <Plus size={16} /> Add product
            </button>
          </div>
          <section className={styles.stats}>
            <Metric label="Active products" value={String(activeProducts.length)} />
            <Metric label="Available to order" value={String(activeProducts.filter((product) => product.available).length)} />
            <Metric label="Deleted items" value={String(archivedProducts.length)} />
            <Metric label="Categories" value={String(activeCategories.length)} />
          </section>
          <div className={styles.tabs}>
            <button className={view === 'products' ? styles.tabActive : ''} onClick={() => setView('products')}>Products</button>
            <button className={view === 'categories' ? styles.tabActive : ''} onClick={() => setView('categories')}>Categories</button>
            {view === 'products' && <button className={showArchived ? styles.tabActive : ''} onClick={() => setShowArchived((value) => !value)}><Trash2 size={14} /> {showArchived ? 'Show active' : 'Deleted items'}</button>}
          </div>
          {error && <p className={styles.error} role="alert"><CircleAlert size={16} />{error}</p>}
          {notice && <p className={styles.notice} role="status"><Check size={16} />{notice}</p>}

          {view === 'products' ? (
            <section className={styles.panel}>
              <label className={styles.search}><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" /></label>
              <div className={styles.tableWrap}>
                <table>
                  <thead><tr><th>Product</th><th>Category</th><th>Base price</th><th>Availability</th><th>Actions</th></tr></thead>
                  <tbody>
                    {visibleProducts.map((product) => (
                      <tr key={product.id}>
                        <td><div className={styles.productCell}>{product.image && <img src={product.image} alt="" />}<span><b>{product.name}</b><small>{product.vegetarian ? 'Vegetarian' : 'Non-vegetarian'} · {product.sizes.length} sizes · {product.toppings.length} extras</small></span></div></td>
                        <td>{catalog?.categories.find((category) => category.id === product.categoryId)?.name ?? 'Uncategorized'}</td>
                        <td>{money(product.price)}</td>
                        <td><span className={`${styles.badge} ${product.available && !product.archived ? styles.available : ''}`}>{product.archived ? 'Deleted' : product.available ? 'Available' : 'Unavailable'}</span></td>
                        <td className={styles.actions}>
                          {!product.archived && <button aria-label={`Edit ${product.name}`} onClick={() => { setError(''); setEditing(draftFromProduct(product)); }}><Pencil size={15} /> Edit</button>}
                          {product.archived ? (
                            <button onClick={() => void mutate('restoreProduct', { id: product.id }, 'Product restored as unavailable.')}><RotateCcw size={15} /> Restore</button>
                          ) : (
                            <button className={styles.danger} onClick={() => void mutate('archiveProduct', { id: product.id }, 'Product moved to deleted items.')}><Archive size={15} /> Delete</button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!visibleProducts.length && <tr><td colSpan={5} className={styles.empty}>No products match this view.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <CategoryManager
              categories={catalog?.categories ?? []}
              products={catalog?.products ?? []}
              busy={busy}
              onMutate={mutate}
              onEdit={(category) => setCategoryDraft(category)}
              onAdd={() => setCategoryDraft({
                id: createClientUuid(), name: '', slug: '', sortOrder: activeCategories.length,
              })}
            />
          )}
        </section>
      </div>
      {editing && (
        <ProductEditor
          draft={editing}
          categories={activeCategories}
          busy={busy}
          error={error}
          setError={setError}
          setDraft={setEditing}
          onClose={() => { setEditing(null); setError(''); }}
          onSubmit={(event) => void saveProduct(event)}
        />
      )}
      {categoryDraft && (
        <CategoryEditor
          initial={categoryDraft}
          busy={busy}
          onClose={() => setCategoryDraft(null)}
          onSave={async (category) => {
            if (await mutate('saveCategory', { category }, 'Category saved.'))
              setCategoryDraft(null);
          }}
        />
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className={styles.metric}><span>{label}</span><strong>{value}</strong></article>;
}

function ProductEditor({
  draft,
  categories,
  busy,
  error,
  setError,
  setDraft,
  onClose,
  onSubmit,
}: {
  draft: ProductDraft;
  categories: Category[];
  busy: boolean;
  error: string;
  setError: (message: string) => void;
  setDraft: (draft: ProductDraft | null) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  function update<K extends keyof ProductDraft>(key: K, value: ProductDraft[K]) {
    setDraft({ ...draft, [key]: value });
  }
  function updateOptions(key: 'sizes' | 'crusts' | 'toppings', options: DraftOption[]) {
    update(key, options);
  }
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className={styles.editor} onSubmit={onSubmit} aria-label="Product editor">
        <header><div><h2>{draft.name ? `Edit ${draft.name}` : 'Add product'}</h2><p>Product details and pricing options</p></div><button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
        <div className={styles.editorBody}>
          {draft.image && (
            <div className={styles.imagePreview}>
              <img src={draft.image} alt="Product image preview" />
              <span>Current menu image preview</span>
            </div>
          )}
          <div className={styles.formGrid}>
            <label>Product name<input required minLength={2} maxLength={100} value={draft.name} onChange={(event) => update('name', event.target.value)} /></label>
            <label>URL slug<input value={draft.slug} placeholder={makeSlug(draft.name)} onChange={(event) => update('slug', event.target.value)} /></label>
            <label className={styles.wide}>Description<textarea required minLength={10} maxLength={1000} rows={3} value={draft.description} onChange={(event) => update('description', event.target.value)} /></label>
            <label className={styles.wide}>Image URL or local path<input required value={draft.image} placeholder="/images/menu/item.jpg" onChange={(event) => update('image', event.target.value)} /></label>
            <label className={styles.wide}>Upload product photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
                    setError('Choose a JPEG, PNG, WebP or GIF image.');
                    return;
                  }
                  if (file.size > 2_000_000) {
                    setError('Product images must be 2 MB or smaller.');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result !== 'string') {
                      setError('The selected image could not be read.');
                      return;
                    }
                    update('image', reader.result);
                    setError('');
                  };
                  reader.onerror = () => setError('The selected image could not be read.');
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            <label>Category<select required value={draft.categoryId} onChange={(event) => update('categoryId', event.target.value)}>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label>Base price (₹)<input type="number" required min="0.01" max="100000" step="0.01" value={draft.price} onChange={(event) => update('price', event.target.value)} /></label>
            <label>Menu badge <span className={styles.fieldHint}>Optional</span><input maxLength={40} value={draft.badge} onChange={(event) => update('badge', event.target.value)} placeholder="New, spicy, limited…" /></label>
          </div>
          <fieldset className={styles.checks}>
            <label><input type="checkbox" checked={draft.vegetarian} onChange={(event) => update('vegetarian', event.target.checked)} /> Vegetarian</label>
            <label><input type="checkbox" checked={draft.available} onChange={(event) => update('available', event.target.checked)} /> Available to order</label>
            <label><input type="checkbox" checked={draft.featured} onChange={(event) => update('featured', event.target.checked)} /> Featured</label>
            <label><input type="checkbox" checked={draft.bestseller} onChange={(event) => update('bestseller', event.target.checked)} /> Bestseller</label>
          </fieldset>
          <OptionEditor title="Sizes" options={draft.sizes} onChange={(options) => updateOptions('sizes', options)} />
          <OptionEditor title="Crusts" sizes={draft.sizes} options={draft.crusts} onChange={(options) => updateOptions('crusts', options)} />
          <OptionEditor title="Extra toppings" sizes={draft.sizes} options={draft.toppings} onChange={(options) => updateOptions('toppings', options)} />
          <fieldset className={styles.tax}>
            <legend>GST treatment</legend>
            <label><input type="checkbox" checked={draft.gstInclusive} onChange={(event) => update('gstInclusive', event.target.checked)} /> Price includes GST (printed MRP)</label>
            {draft.gstInclusive && <div className={styles.formGrid}><label>Total GST rate %<input type="number" required min="0.02" max="40" step="0.02" value={draft.gstRate} onChange={(event) => update('gstRate', event.target.value)} /></label><label>HSN / SAC code<input required pattern="(?:\d{4}|\d{6}|\d{8})" value={draft.gstCode} onChange={(event) => update('gstCode', event.target.value)} /></label></div>}
          </fieldset>
          {error && <p className={styles.error} role="alert"><CircleAlert size={15} />{error}</p>}
        </div>
        <footer><button type="button" onClick={onClose}>Cancel</button><button className={styles.primary} disabled={busy}><Check size={15} />{busy ? 'Saving…' : 'Save product'}</button></footer>
      </form>
    </div>
  );
}

function OptionEditor({
  title,
  sizes = [],
  options,
  onChange,
}: {
  title: string;
  sizes?: DraftOption[];
  options: DraftOption[];
  onChange: (options: DraftOption[]) => void;
}) {
  return (
    <section className={styles.optionEditor}>
      <div className={styles.optionHeading}><strong>{title}</strong><button type="button" onClick={() => onChange([...options, { id: createClientUuid().slice(0, 8), name: '', price: '0' }])}><Plus size={14} /> Add option</button></div>
      {options.map((option, index) => (
        <div className={styles.optionRow} key={option.id}>
          <label>Name<input required value={option.name} onChange={(event) => onChange(options.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} /></label>
          <label>Option ID<input required pattern="[A-Za-z0-9_-]+" value={option.id} onChange={(event) => onChange(options.map((item, i) => i === index ? { ...item, id: event.target.value } : item))} /></label>
          <label>Price (₹)<input type="number" required min="0" max="100000" step="0.01" value={option.price} onChange={(event) => onChange(options.map((item, i) => i === index ? { ...item, price: event.target.value } : item))} /></label>
          <button type="button" aria-label={`Remove ${title} option`} onClick={() => onChange(options.filter((_, i) => i !== index))}><Trash2 size={15} /></button>
          {title !== 'Sizes' && sizes.length > 0 && (
            <label className={styles.bySize}>
              <input
                type="checkbox"
                checked={!!option.sizePrices}
                onChange={(event) => onChange(options.map((item, i) => i === index
                  ? {
                      ...item,
                      sizePrices: event.target.checked
                        ? Object.fromEntries(sizes.map((size) => [size.id, item.price]))
                        : undefined,
                    }
                  : item))}
              />
              Charge by size
            </label>
          )}
          {option.sizePrices && sizes.map((size) => (
            <label key={size.id}>Price for {size.name || size.id} (₹)
              <input type="number" required min="0" max="100000" step="0.01" value={option.sizePrices?.[size.id] ?? option.price} onChange={(event) => onChange(options.map((item, i) => i === index
                ? { ...item, sizePrices: { ...item.sizePrices, [size.id]: event.target.value } }
                : item))} />
            </label>
          ))}
        </div>
      ))}
      {!options.length && <p>No options configured.</p>}
    </section>
  );
}

function CategoryManager({
  categories,
  products,
  busy,
  onMutate,
  onEdit,
  onAdd,
}: {
  categories: Category[];
  products: Product[];
  busy: boolean;
  onMutate: (action: string, args: unknown, success: string) => Promise<boolean>;
  onEdit: (category: Category) => void;
  onAdd: () => void;
}) {
  const active = categories.filter((category) => !category.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const archived = categories.filter((category) => category.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <section className={styles.panel}>
      <div className={styles.categoryHeader}><div><h2>Menu categories</h2><p>Reorder categories and archive unused ones.</p></div><button className={styles.primary} onClick={onAdd}><Plus size={15} /> Add category</button></div>
      <div className={styles.categoryList}>
        {active.map((category, index) => {
          const linked = products.filter((product) => product.categoryId === category.id && !product.archived).length;
          return (
            <article key={category.id}>
              <span className={styles.categoryIcon}><Layers3 size={17} /></span>
              <span className={styles.categoryInfo}><b>{category.name}</b><small>/{category.slug} · {linked} products</small></span>
              <div className={styles.actions}>
                <button aria-label={`Move ${category.name} up`} disabled={busy || index === 0} onClick={() => void onMutate('reorderCategory', { id: category.id, direction: 'up' }, 'Category order updated.')}><ArrowUp size={15} /></button>
                <button aria-label={`Move ${category.name} down`} disabled={busy || index === active.length - 1} onClick={() => void onMutate('reorderCategory', { id: category.id, direction: 'down' }, 'Category order updated.')}><ArrowDown size={15} /></button>
                <button aria-label={`Edit ${category.name}`} onClick={() => onEdit(category)}><Pencil size={15} /></button>
                <button className={styles.danger} disabled={busy || linked > 0} title={linked ? 'Move or archive its products first' : 'Archive category'} onClick={() => void onMutate('archiveCategory', { id: category.id }, 'Category archived.')}><Archive size={15} /></button>
              </div>
            </article>
          );
        })}
        {!active.length && <p className={styles.empty}>No active categories.</p>}
      </div>
      {!!archived.length && <details className={styles.archived}><summary>Archived categories ({archived.length})</summary>{archived.map((category) => {
        const linked = products.filter((product) => product.categoryId === category.id).length;
        return <article key={category.id}><span className={styles.categoryIcon}><Layers3 size={17} /></span><span className={styles.categoryInfo}><b>{category.name}</b><small>/{category.slug} · {linked} linked products</small></span><div className={styles.actions}><button disabled={busy} onClick={() => void onMutate('restoreCategory', { id: category.id }, 'Category restored.')}><RotateCcw size={15} /> Restore</button><button className={styles.danger} disabled={busy || linked > 0} onClick={() => void onMutate('deleteCategory', { id: category.id }, 'Category permanently deleted.')}><Trash2 size={15} /></button></div></article>;
      })}</details>}
    </section>
  );
}

function CategoryEditor({
  initial,
  busy,
  onClose,
  onSave,
}: {
  initial: Category;
  busy: boolean;
  onClose: () => void;
  onSave: (category: Category) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className={styles.categoryEditor} onSubmit={(event) => {
        event.preventDefault();
        void onSave({ ...initial, name: name.trim(), slug: makeSlug(slug || name) });
      }}>
        <header><h2>{initial.name ? 'Edit category' : 'Add category'}</h2><button type="button" onClick={onClose}><X size={18} /></button></header>
        <label>Category name<input required minLength={2} maxLength={80} value={name} onChange={(event) => { setName(event.target.value); if (!initial.name) setSlug(makeSlug(event.target.value)); }} /></label>
        <label>URL slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={slug} onChange={(event) => setSlug(event.target.value)} /></label>
        <footer><button type="button" onClick={onClose}>Cancel</button><button className={styles.primary} disabled={busy}><Check size={15} />Save category</button></footer>
      </form>
    </div>
  );
}
