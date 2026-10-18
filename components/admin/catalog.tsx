'use client';
import Link from 'next/link';
import { useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Archive,
  ArrowUp,
  ArrowDown,
  Layers3,
  Trash2,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useDemoStore } from '@/lib/store';
import { money } from '@/lib/utils';
import type { Category, Product } from '@/types';
import { ConfirmAction, PageHeading } from './shared';
import './catalog.css';

export function ProductsPage() {
  const { products, categories, archiveProduct, saveProduct } = useDemoStore();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [availability, setAvailability] = useState('all');
  const [view, setView] = useState<'active' | 'deleted'>('active');
  const [deleting, setDeleting] = useState<Product | null>(null);
  const activeCount = products.filter((p) => !p.archived).length;
  const deletedCount = products.filter((p) => p.archived).length;
  const visible = products.filter(
    (p) =>
      Boolean(p.archived) === (view === 'deleted') &&
      (category === 'all' || p.categoryId === category) &&
      (availability === 'all' || p.available === (availability === 'available')) &&
      p.name.toLowerCase().includes(search.toLowerCase()),
  );
  const restore = (product: Product, available = false) => {
    try {
      const current = useDemoStore.getState().products.find((p) => p.id === product.id);
      if (!current) throw new Error('This product could not be found.');
      if (!categories.some((c) => c.id === current.categoryId && !c.archived))
        throw new Error(
          'Use Edit to choose an active category, then save to restore this product.',
        );
      saveProduct({ ...current, archived: false, available });
      toast.success(
        available
          ? 'Product restored to the menu'
          : 'Product restored as unavailable. Edit to make it available.',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to restore product');
    }
  };
  const changeView = (next: 'active' | 'deleted') => {
    setView(next);
    setCategory('all');
    setAvailability('all');
  };
  return (
    <>
      <PageHeading
        eyebrow="CRAFT YOUR MENU"
        title="Menu & products"
        description="Great food deserves a great menu. Keep yours fresh."
      >
        <Link className="btn btn-primary" href="/admin/products/new">
          <Plus size={17} /> Add product
        </Link>
      </PageHeading>
      <div className="admin-catalog-stats">
        <span>
          <strong>{activeCount}</strong> active products
        </span>
        <span>
          <strong>{products.filter((p) => !p.archived && p.available).length}</strong> available now
        </span>
        <span>
          <strong>{deletedCount}</strong> deleted items
        </span>
      </div>
      <section className="admin-card">
        <div className="admin-product-views" role="group" aria-label="Product list">
          <button
            type="button"
            aria-pressed={view === 'active'}
            onClick={() => changeView('active')}
          >
            Active products <span>{activeCount}</span>
          </button>
          <button
            type="button"
            aria-pressed={view === 'deleted'}
            onClick={() => changeView('deleted')}
          >
            <Trash2 size={15} /> Deleted items <span>{deletedCount}</span>
          </button>
        </div>
        {view === 'deleted' && (
          <p className="admin-deleted-note">
            Deleted items are hidden from customers. Restore an item here, then edit its
            availability. Previous orders and receipts are kept.
          </p>
        )}
        <div className="filter-bar">
          <div className="admin-search">
            <Search size={17} />
            <input
              aria-label="Search products"
              placeholder="Find something on your menu…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">All categories</option>
            {categories
              .filter((c) => view === 'deleted' || !c.archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.archived ? ' (archived)' : ''}
                </option>
              ))}
          </select>
          <select
            aria-label="Filter availability"
            value={availability}
            disabled={view === 'deleted'}
            onChange={(e) => setAvailability(e.target.value)}
          >
            <option value="all">All availability</option>
            <option value="available">Available</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </div>
        <div className="admin-table-wrap">
          <table className="data-table admin-products-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Category</th>
                <th>Base price</th>
                <th>Availability</th>
                <th>Highlights</th>
                <th className="admin-product-action-cell">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="admin-product-cell">
                      <img src={p.image} alt="" />
                      <div>
                        <Link className="admin-table-link" href={`/admin/products/${p.id}/edit`}>
                          {p.name}
                        </Link>
                        <small>
                          <span className={`admin-food-dot ${p.vegetarian ? 'veg' : 'nonveg'}`} />
                          {p.vegetarian ? 'Vegetarian' : 'Non-vegetarian'}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{categories.find((c) => c.id === p.categoryId)?.name || 'Uncategorized'}</td>
                  <td>
                    <strong>{money(p.price)}</strong>
                    <small>
                      {p.sizes.length} sizes · {p.toppings.length} extras
                    </small>
                  </td>
                  <td>
                    <span
                      className={`status-pill ${p.available ? 'status-delivered' : 'status-cancelled'}`}
                    >
                      {p.archived ? 'Deleted' : p.available ? 'Available' : 'Unavailable'}
                    </span>
                  </td>
                  <td>
                    <div className="admin-flags">
                      {p.featured && <span className="badge">Featured</span>}
                      {p.bestseller && <span className="badge">Bestseller</span>}
                      {!p.featured && !p.bestseller && <span className="muted">—</span>}
                    </div>
                  </td>
                  <td className="admin-product-action-cell">
                    <div className="admin-row-actions">
                      <Link
                        className="admin-icon-link admin-product-action"
                        href={`/admin/products/${p.id}/edit`}
                        aria-label={`Edit ${p.name}`}
                      >
                        <Pencil size={16} />
                        Edit
                      </Link>
                      {p.archived ? (
                        <button
                          type="button"
                          className="admin-icon-link admin-product-action"
                          aria-label={`Restore ${p.name}`}
                          onClick={() => restore(p)}
                        >
                          <RotateCcw size={15} /> Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="admin-icon-link admin-product-action admin-product-delete"
                          aria-label={`Delete ${p.name}`}
                          onClick={() => setDeleting(p)}
                        >
                          <Trash2 size={15} /> Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && (
            <div className="empty-state">
              <h3>{view === 'deleted' ? 'No deleted items found' : 'No products found'}</h3>
              <p>
                {view === 'deleted'
                  ? 'Deleted products appear here so you can restore them later.'
                  : 'Try a different filter or add your next crowd favorite.'}
              </p>
              {view === 'active' && (
                <Link className="btn btn-primary" href="/admin/products/new">
                  Add a product
                </Link>
              )}
            </div>
          )}
        </div>
      </section>
      <ConfirmAction
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.name || 'product'}?`}
        description="This item will be removed from the customer menu. You can restore it from Deleted items. Existing orders and receipts will be kept."
        destructive
        label="Delete product"
        onConfirm={() => {
          if (deleting) {
            try {
              const original = deleting;
              archiveProduct(original.id);
              toast.success('Product deleted. Find it in Deleted items.', {
                action: { label: 'Undo', onClick: () => restore(original, original.available) },
              });
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Unable to delete product');
            }
          }
        }}
      />
    </>
  );
}

export function CategoriesPage() {
  const { categories, products, saveCategory, archiveCategory, deleteCategory, reorderCategory } =
    useDemoStore();
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState('');
  const [archive, setArchive] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [view, setView] = useState<'active' | 'archived'>('active');
  const active = categories.filter((c) => !c.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const archived = categories.filter((c) => c.archived).sort((a, b) => a.sortOrder - b.sortOrder);
  const visible = view === 'active' ? active : archived;
  const reset = () => {
    setEditing(null);
    setName('');
    setSlug('');
    setError('');
  };
  const makeSlug = (value: string) =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  const restore = (id: string) => {
    try {
      const category = useDemoStore.getState().categories.find((item) => item.id === id);
      if (!category) throw new Error('This category could not be found.');
      saveCategory({ ...category, archived: false });
      toast.success(`${category.name} restored to Active categories.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to restore category');
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="A PLACE FOR EVERY CRAVING"
        title="Categories"
        description="Organize your menu so every good thing is easy to find."
      />
      <div className="admin-category-layout">
        <section className="admin-card admin-categories-card">
          <div className="admin-card-heading">
            <h2>Menu categories</h2>
            <span className="muted">
              {active.length} active · {archived.length} archived
            </span>
          </div>
          <div
            className="admin-product-views admin-category-views"
            role="group"
            aria-label="Category list"
          >
            <button
              type="button"
              aria-pressed={view === 'active'}
              onClick={() => setView('active')}
            >
              Active categories <span>{active.length}</span>
            </button>
            <button
              type="button"
              aria-pressed={view === 'archived'}
              onClick={() => setView('archived')}
            >
              <Archive size={15} /> Archived categories <span>{archived.length}</span>
            </button>
          </div>
          <p className="admin-deleted-note">
            {view === 'archived'
              ? 'Restore a category to use it again, or permanently delete an unused category. Permanent deletion cannot be undone.'
              : 'Archive an empty category to remove it from the menu. Find it later in Archived categories.'}
          </p>
          <div className="admin-category-list">
            {visible.map((c, index) => {
              const count = products.filter((p) => p.categoryId === c.id && !p.archived).length;
              const linkedCount = products.filter((p) => p.categoryId === c.id).length;
              return (
                <div key={c.id}>
                  <span className="admin-category-order">{String(index + 1).padStart(2, '0')}</span>
                  <span className="admin-category-icon">
                    <Layers3 size={20} />
                  </span>
                  <span className="admin-category-name">
                    <strong>{c.name}</strong>
                    <small>
                      /{c.slug} · {count} products
                    </small>
                    {view === 'archived' && linkedCount > 0 && (
                      <small className="admin-category-protection">
                        {linkedCount} linked {linkedCount === 1 ? 'product' : 'products'}, including
                        deleted items. Move them to another category before permanently deleting
                        this category.
                      </small>
                    )}
                  </span>
                  <div className="admin-row-actions">
                    {view === 'active' ? (
                      <>
                        <button
                          type="button"
                          className="admin-icon-link"
                          disabled={index === 0}
                          aria-label={`Move ${c.name} up`}
                          onClick={() => {
                            reorderCategory(c.id, 'up');
                            toast.success('Category order updated');
                          }}
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          type="button"
                          className="admin-icon-link"
                          disabled={index === active.length - 1}
                          aria-label={`Move ${c.name} down`}
                          onClick={() => {
                            reorderCategory(c.id, 'down');
                            toast.success('Category order updated');
                          }}
                        >
                          <ArrowDown size={16} />
                        </button>
                        <button
                          type="button"
                          className="admin-icon-link admin-category-action"
                          aria-label={`Edit ${c.name}`}
                          onClick={() => {
                            setEditing(c);
                            setName(c.name);
                            setSlug(c.slug);
                            setError('');
                          }}
                        >
                          <Pencil size={16} /> Edit
                        </button>
                        <button
                          type="button"
                          className="admin-icon-link admin-category-action admin-danger-text"
                          aria-label={`Archive ${c.name}`}
                          onClick={() => {
                            if (count)
                              toast.error(
                                'Move or archive all products in this category before archiving it.',
                              );
                            else setArchive(c);
                          }}
                        >
                          <Archive size={16} /> Archive
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="admin-icon-link admin-category-action"
                          aria-label={`Restore ${c.name}`}
                          onClick={() => restore(c.id)}
                        >
                          <RotateCcw size={16} /> Restore
                        </button>
                        <button
                          type="button"
                          className="admin-icon-link admin-category-action admin-product-delete"
                          aria-label={`Delete ${c.name} permanently`}
                          onClick={() => {
                            if (linkedCount)
                              toast.error(
                                'Move all linked products, including deleted products, to another category first.',
                              );
                            else setDeleting(c);
                          }}
                        >
                          <Trash2 size={16} /> Delete permanently
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {!visible.length && (
              <div className="empty-state">
                <h3>
                  {view === 'archived' ? 'No archived categories' : 'Make room for a new category'}
                </h3>
                <p>
                  {view === 'archived'
                    ? 'Categories you archive will appear here with a Restore option.'
                    : 'Use the form to create your first menu category.'}
                </p>
              </div>
            )}
          </div>
        </section>
        <section className="admin-card admin-category-form">
          <div className="admin-card-heading">
            <h2>{editing ? 'Edit category' : 'Add a category'}</h2>
          </div>
          <form
            className="admin-form admin-card-padding"
            onSubmit={(e) => {
              e.preventDefault();
              const cleanSlug = makeSlug(slug);
              if (name.trim().length < 2) {
                setError('Use at least 2 characters for the category name.');
                return;
              }
              if (!cleanSlug) {
                setError('Enter a valid category URL slug.');
                return;
              }
              if (categories.some((c) => c.slug === cleanSlug && c.id !== editing?.id)) {
                setError('That category URL slug is already in use.');
                return;
              }
              try {
                saveCategory({
                  id: editing?.id || crypto.randomUUID(),
                  name: name.trim(),
                  slug: cleanSlug,
                  sortOrder:
                    editing?.sortOrder ?? Math.max(-1, ...categories.map((c) => c.sortOrder)) + 1,
                  archived: false,
                });
                toast.success(editing ? 'Category updated' : 'Category created');
                reset();
                setView('active');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Unable to save category');
              }
            }}
          >
            <label className="field">
              Category name
              <input
                required
                value={name}
                maxLength={60}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!editing) setSlug(makeSlug(e.target.value));
                }}
                placeholder="e.g. Signature pizzas"
              />
            </label>
            <label className="field">
              URL slug
              <input
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="signature-pizzas"
              />
              <small>Lowercase words separated by hyphens.</small>
            </label>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn-primary" type="submit">
              {editing ? 'Save changes' : 'Create category'}
            </button>
            {editing && (
              <button className="btn btn-outline" type="button" onClick={reset}>
                Cancel editing
              </button>
            )}
            <p className="admin-inline-note">
              Categories containing active products cannot be archived. Reassign or archive their
              products first.
            </p>
          </form>
        </section>
      </div>
      <ConfirmAction
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Permanently delete ${deleting?.name || 'category'}?`}
        description="This unused category will be removed completely. It will no longer appear in Archived categories and cannot be restored. Existing products and order receipts will be kept."
        destructive
        label="Delete permanently"
        onConfirm={() => {
          if (!deleting) return;
          try {
            deleteCategory(deleting.id);
            if (editing?.id === deleting.id) reset();
            toast.success(`${deleting.name} permanently deleted.`);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Unable to delete category');
          }
        }}
      />
      <ConfirmAction
        open={Boolean(archive)}
        onOpenChange={(open) => {
          if (!open) setArchive(null);
        }}
        title={`Archive ${archive?.name || 'category'}?`}
        description="This category will be hidden from the customer menu. You can restore it from Archived categories. Previous orders and receipts are kept."
        destructive
        label="Archive category"
        onConfirm={() => {
          if (archive) {
            try {
              archiveCategory(archive.id);
              if (editing?.id === archive.id) reset();
              const archivedId = archive.id;
              toast.success('Category archived. Find it in Archived categories.', {
                action: { label: 'Undo', onClick: () => restore(archivedId) },
              });
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Unable to archive category');
            }
          }
        }}
      />
    </>
  );
}
