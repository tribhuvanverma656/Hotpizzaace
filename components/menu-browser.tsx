'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowUpRight, Star, Search, Plus, Minus, Leaf } from 'lucide-react';
import { toast } from 'sonner';
import { useDemoStore } from '@/lib/store';
import { Product } from '@/types';
import { money } from '@/lib/utils';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ProductCustomizer } from './product-customizer';
import { ProductImage } from './product-image';
import { FoodCategoryIcon } from './food-category-icon';
export function ProductCard({
  product,
  onCustomize,
}: {
  product: Product;
  onCustomize: (p: Product) => void;
}) {
  const categories = useDemoStore((state) => state.categories);
  const cart = useDemoStore((state) => state.cart);
  const addToCart = useDemoStore((state) => state.addToCart);
  const updateQuantity = useDemoStore((state) => state.updateQuantity);
  const configurations = cart.filter((item) => item.productId === product.id);
  const quantity = configurations.reduce((sum, item) => sum + item.quantity, 0);
  const lastConfiguration = () =>
    useDemoStore
      .getState()
      .cart.filter((item) => item.productId === product.id)
      .at(-1);
  const configurable =
    product.sizes.length > 0 || product.crusts.length > 0 || product.toppings.length > 0;
  const unavailable = !product.available || product.archived;
  const increase = () => {
    try {
      const last = lastConfiguration();
      if (last) {
        addToCart({
          productId: product.id,
          sizeId: last.sizeId,
          crustId: last.crustId,
          toppingIds: [...last.toppingIds],
          notes: last.notes,
          quantity: 1,
        });
      } else if (configurable) {
        onCustomize(product);
      } else {
        addToCart({ productId: product.id, toppingIds: [], quantity: 1, notes: '' });
        toast.success(`${product.name} added to your cart`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to add this item.');
    }
  };
  const decrease = () => {
    const last = lastConfiguration();
    if (!last) return;
    try {
      updateQuantity(last.id, last.quantity - 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to update this item.');
    }
  };
  return (
    <article className={`product-card ${unavailable ? 'unavailable' : ''}`}>
      <Link href={`/menu/${product.slug}`} className="product-photo">
        <ProductImage
          src={product.image}
          alt={product.name}
          sizes="(max-width: 700px) 80px, (max-width: 1150px) 45vw, 300px"
        />
        <span
          className={`diet-mark ${product.vegetarian ? 'veg' : 'nonveg'}`}
          title={product.vegetarian ? 'Vegetarian' : 'Non-vegetarian'}
        >
          <i />
        </span>
        {(product.badge || product.bestseller) && (
          <span className="photo-tag">
            {product.bestseller ? (
              <Star size={12} />
            ) : (
              <FoodCategoryIcon
                category={categories.find((c) => c.id === product.categoryId)}
                size={14}
              />
            )}
            {product.badge || 'BESTSELLER'}
          </span>
        )}
        {unavailable && <span className="sold-out">Back soon</span>}
      </Link>
      <div className="product-body">
        <div className="product-category">
          {product.vegetarian ? 'VEGETARIAN' : 'NON-VEGETARIAN'} <span>•</span> FRESHLY MADE
        </div>
        <h3>
          <Link href={`/menu/${product.slug}`}>{product.name}</Link>
        </h3>
        <p>{product.description}</p>
        <div className="product-bottom">
          <div>
            <span>{product.sizes.length ? 'From' : 'Price'}</span>
            <strong>{money(product.price)}</strong>
          </div>
          {quantity > 0 ? (
            <div
              className="quantity-control card-quantity"
              role="group"
              aria-label={`${product.name} quantity in cart`}
            >
              <button
                type="button"
                onClick={decrease}
                aria-label={`Remove one ${product.name} from the last configuration`}
              >
                <Minus size={16} />
              </button>
              <span aria-live="polite" aria-atomic="true">
                {quantity}
              </span>
              <button
                type="button"
                disabled={unavailable}
                onClick={increase}
                aria-label={`Add one ${product.name} with the last configuration`}
              >
                <Plus size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="add-button"
              disabled={unavailable}
              onClick={increase}
              aria-label={`Add ${product.name}`}
            >
              Add <Plus size={16} />
            </button>
          )}
        </div>
        {configurable ? (
          <button
            type="button"
            className="customizable customizable-button"
            onClick={() => onCustomize(product)}
            aria-label={`Customise ${product.name}`}
          >
            Customise it your way
          </button>
        ) : (
          <span className="customizable">Made fresh to order</span>
        )}
        {configurations.length > 1 && (
          <small className="cart-config-note" aria-live="polite">
            {configurations.length} customisations in cart · + and − update the last one
          </small>
        )}
      </div>
    </article>
  );
}
export function MenuBrowser({ home = false }: { home?: boolean }) {
  const { products, categories, settings } = useDemoStore();
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [veg, setVeg] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  useEffect(() => {
    if (home) return;
    const requested = new URLSearchParams(window.location.search).get('category');
    if (!requested) return;
    const match = categories.find(
      (item) => !item.archived && (item.id === requested || item.slug === requested),
    );
    if (match) setCategory(match.id);
  }, [home, categories]);
  const visible = products.filter(
    (p) =>
      !p.archived &&
      (category === 'all' || p.categoryId === category) &&
      (!veg || p.vegetarian) &&
      `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  const homeSelection =
    category === 'all' && !search.trim() ? visible.filter((product) => product.featured) : visible;
  const shown = home ? homeSelection.slice(0, 4) : visible;
  return (
    <section className={`menu-section ${home ? 'home-menu' : ''}`} id="menu">
      <div className={home ? 'container' : 'container menu-layout'}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">EXPLORE OUR MENU</span>
            {settings.billing && (
              <p className="muted">
                GST is itemized at checkout. Any GST already included in an item’s price is not
                added again.
              </p>
            )}
            <h2>
              {home ? (
                <>
                  Find your next <em>favourite.</em>
                </>
              ) : (
                <>
                  Your favourites, <em>freshly prepared.</em>
                </>
              )}
            </h2>
          </div>
          {home ? (
            <Link href="/menu" className="text-link">
              Explore full menu <ArrowUpRight size={18} />
            </Link>
          ) : (
            <span className="menu-count">{visible.length} menu items</span>
          )}
        </div>
        <div className={home ? 'home-menu-navigation' : 'menu-navigation'}>
          <div className="category-row" aria-label="Menu categories">
            <button
              onClick={() => setCategory('all')}
              aria-pressed={category === 'all'}
              className={category === 'all' ? 'category active' : 'category'}
            >
              <span>
                <FoodCategoryIcon />
              </span>
              All items
            </button>
            {categories
              .filter((c) => !c.archived)
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((c) => {
                return (
                  <button
                    key={c.id}
                    className={category === c.id ? 'category active' : 'category'}
                    onClick={() => setCategory(c.id)}
                    aria-pressed={category === c.id}
                  >
                    <span>
                      <FoodCategoryIcon category={c} />
                    </span>
                    {c.name}
                  </button>
                );
              })}
          </div>
          <div className="menu-tools">
            {!home && (
              <label className="menu-category-picker">
                <span>Category</span>
                <select
                  aria-label="Choose menu category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="all">All items</option>
                  {categories
                    .filter((item) => !item.archived)
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <label className="search-field">
              <Search size={18} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find your favourite pizza, side or drink…"
                aria-label="Search menu"
              />
            </label>
            <button
              className={`veg-filter ${veg ? 'selected' : ''}`}
              onClick={() => setVeg(!veg)}
              aria-pressed={veg}
            >
              <Leaf size={17} /> Veg only{' '}
              <span className="toggle">
                <i />
              </span>
            </button>
          </div>
        </div>
        {shown.length ? (
          <div className="product-grid">
            {shown.map((p) => (
              <ProductCard key={p.id} product={p} onCustomize={setSelected} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <FoodCategoryIcon size={38} />
            <h3>No dishes found</h3>
            <p>Try a different category or search.</p>
            <button
              className="btn btn-outline"
              onClick={() => {
                setCategory('all');
                setSearch('');
                setVeg(false);
              }}
            >
              Reset filters
            </button>
          </div>
        )}
        {home && (
          <p className="menu-footnote">
            Prices from our printed menu. Dish photos from our Zomato listing; presentation may
            vary.
          </p>
        )}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent className="product-dialog">
          <DialogTitle className="sr-only">Customise {selected?.name}</DialogTitle>
          <DialogDescription className="sr-only">
            Choose your size, crust, and extras, then add to your cart.
          </DialogDescription>
          {selected && (
            <ProductCustomizer
              key={selected.id}
              product={selected}
              onAdded={() => setSelected(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
