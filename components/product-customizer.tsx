'use client';
import { useState } from 'react';
import { Check, Minus, Plus, ShoppingBag, Flame } from 'lucide-react';
import { toast } from 'sonner';
import { Product } from '@/types';
import { useDemoStore } from '@/lib/store';
import { getOptionPrice, getUnitPrice } from '@/lib/pricing';
import { money } from '@/lib/utils';
import { Button } from '@/components/ui/button';
export function ProductCustomizer({
  product,
  onAdded,
}: {
  product: Product;
  onAdded?: () => void;
}) {
  const [sizeId, setSizeId] = useState(product.sizes[0]?.id);
  const [crustId, setCrustId] = useState(product.crusts[0]?.id);
  const [toppingIds, setToppingIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const add = useDemoStore((s) => s.addToCart);
  const selection = { productId: product.id, sizeId, crustId, toppingIds, quantity, notes };
  let price = product.price;
  try {
    price = getUnitPrice(product, selection);
  } catch {}
  const addItem = () => {
    try {
      add(selection);
      toast.success(`${product.name} added to your cart`);
      onAdded?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unable to add item');
    }
  };
  return (
    <div className="customizer">
      <div className="customizer-photo">
        <img src={product.image} alt={product.name} />
        <span className={`diet-mark ${product.vegetarian ? 'veg' : 'nonveg'}`}>
          <i />
        </span>
        {product.bestseller && (
          <span className="photo-tag">
            <Flame size={12} /> CROWD FAVOURITE
          </span>
        )}
      </div>
      <div className="customizer-body">
        <span className="eyebrow">MAKE IT YOURS</span>
        <h2>{product.name}</h2>
        <p className="muted">{product.description}</p>
        {product.sizes.length > 0 && (
          <fieldset className="option-group">
            <legend>
              Choose your size <span>Required</span>
            </legend>
            <div className="size-options">
              {product.sizes.map((o) => (
                <label key={o.id} className={`option-tile ${sizeId === o.id ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name={`size-${product.id}`}
                    value={o.id}
                    checked={sizeId === o.id}
                    onChange={() => setSizeId(o.id)}
                  />
                  <span>{o.name}</span>
                  <strong>{money(o.price)}</strong>
                  {sizeId === o.id && <Check size={14} />}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {product.crusts.length > 0 && (
          <fieldset className="option-group">
            <legend>Pick your crust</legend>
            {product.crusts.map((o) => (
              <label key={o.id} className="option-line">
                <span>
                  <input
                    type="radio"
                    name={`crust-${product.id}`}
                    checked={crustId === o.id}
                    onChange={() => setCrustId(o.id)}
                  />
                  {o.name}
                </span>
                <b>
                  {getOptionPrice(o, sizeId) ? `+ ${money(getOptionPrice(o, sizeId))}` : 'Included'}
                </b>
              </label>
            ))}
          </fieldset>
        )}
        {product.toppings.length > 0 && (
          <details className="customizer-disclosure">
            <summary>
              Add toppings{' '}
              <span>{toppingIds.length ? `${toppingIds.length} selected` : 'Optional'}</span>
            </summary>
            <fieldset className="option-group">
              <legend className="sr-only">Extra toppings</legend>
              <div className="topping-grid">
                {product.toppings.map((o) => (
                  <label key={o.id} className="option-line">
                    <span>
                      <input
                        type="checkbox"
                        checked={toppingIds.includes(o.id)}
                        onChange={() =>
                          setToppingIds(
                            toppingIds.includes(o.id)
                              ? toppingIds.filter((i) => i !== o.id)
                              : [...toppingIds, o.id],
                          )
                        }
                      />
                      {o.name}
                    </span>
                    <b>+{money(getOptionPrice(o, sizeId))}</b>
                  </label>
                ))}
              </div>
            </fieldset>
          </details>
        )}
        <details className="customizer-disclosure">
          <summary>
            Kitchen note <span>{notes ? 'Added' : 'Optional'}</span>
          </summary>
          <label className="field">
            A note for the kitchen <span className="optional">Optional</span>
            <textarea
              maxLength={200}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Less spicy? Extra crispy? Tell us here."
              rows={2}
            />
          </label>
        </details>
        <div className="customizer-bottom">
          <div className="quantity-control">
            <button
              disabled={quantity <= 1}
              onClick={() => setQuantity(quantity - 1)}
              aria-label="Decrease quantity"
            >
              <Minus size={16} />
            </button>
            <span>{quantity}</span>
            <button
              disabled={quantity >= 20}
              onClick={() => setQuantity(quantity + 1)}
              aria-label="Increase quantity"
            >
              <Plus size={16} />
            </button>
          </div>
          <Button onClick={addItem} disabled={!product.available || product.archived}>
            <ShoppingBag size={17} />
            {product.available ? 'Add to cart' : 'Currently unavailable'}
            <strong>{money(price * quantity)}</strong>
          </Button>
        </div>
      </div>
    </div>
  );
}
