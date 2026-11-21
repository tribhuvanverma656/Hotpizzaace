import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';
import type { Branch, Category, CartSelection, Product } from '../../../types';
import { getUnitPrice, validateSelection } from '../../../lib/pricing';
import { addLine, changeQuantity, restoreCart, type Line } from './cart';
import { WEBSITE_URL } from './config';
export type Catalog = {
  products: Product[];
  categories: Category[];
  branches: Branch[];
  revision: number;
  mode?: string;
};
type Store = {
  catalog: Catalog | null;
  branch: Branch | undefined;
  branchId: string;
  cart: Line[];
  favourites: string[];
  loading: boolean;
  ready: boolean;
  error: string;
  storageError: string;
  refresh: () => Promise<void>;
  chooseBranch: (id: string) => void;
  add: (s: CartSelection) => void;
  quantity: (id: string, n: number) => void;
  clear: () => void;
  favourite: (id: string) => void;
};
const Context = createContext<Store | null>(null);
const KEY = `hpa-customer-app-v1:${WEBSITE_URL}`;
export function CustomerProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [branchId, setBranchId] = useState('');
  const [cart, setCart] = useState<Line[]>([]);
  const [favourites, setFavourites] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const pending = useRef<AbortController | null>(null);
  const writes = useRef(Promise.resolve());
  const cartRef = useRef(cart);
  const branchRef = useRef('');
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!active || !raw) return;
        try {
          const saved = restoreCart(JSON.parse(raw));
          branchRef.current = saved.branchId;
          setBranchId(saved.branchId);
          cartRef.current = saved.cart;
          setCart(saved.cart);
          setFavourites(saved.favourites);
        } catch {
          setStorageError('The saved cart could not be restored. Please choose your items again.');
        }
      })
      .catch(() => {
        if (active)
          setStorageError(
            'Phone storage is unavailable. Your cart may not survive an app restart.',
          );
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    const raw = JSON.stringify({ branchId, cart, favourites });
    writes.current = writes.current
      .then(() => AsyncStorage.setItem(KEY, raw))
      .catch(() => setStorageError('Your changes could not be saved on this phone.'));
  }, [branchId, cart, favourites, hydrated]);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const timer = setTimeout(() => controller.abort(), 25000);
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        Platform.OS === 'web' ? '/mobile-catalog' : `${WEBSITE_URL}/api/commerce/catalog`,
        { headers: { Accept: 'application/json' }, credentials: 'omit', signal: controller.signal },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'The restaurant menu could not be loaded.');
      if (
        !Array.isArray(data.products) ||
        !Array.isArray(data.categories) ||
        !Array.isArray(data.branches) ||
        !data.branches.length ||
        !Number.isSafeInteger(data.revision)
      )
        throw new Error('The restaurant returned an incomplete menu.');
      if (pending.current !== controller) return;
      setCatalog(data);
      if (!data.branches.some((b: Branch) => b.id === branchRef.current)) {
        if (cartRef.current.length) {
          cartRef.current = [];
          setCart([]);
          setStorageError(
            'Your previous branch is no longer available. Please choose your food again.',
          );
        }
        branchRef.current = data.branches[0].id;
        setBranchId(data.branches[0].id);
      }
    } catch (e) {
      if (pending.current === controller)
        setError(
          e instanceof Error && e.name !== 'AbortError'
            ? e.message
            : 'The connection timed out. Check your internet and try again.',
        );
    } finally {
      clearTimeout(timer);
      if (pending.current === controller) {
        pending.current = null;
        setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) void refresh();
    });
    return () => {
      mounted = false;
      pending.current?.abort();
      pending.current = null;
    };
  }, [hydrated, refresh]);
  const branch = catalog?.branches.find((b) => b.id === branchId);
  const ready = hydrated && !!catalog && !!branch && !loading && !error;
  return (
    <Context.Provider
      value={{
        catalog,
        branch,
        branchId,
        cart,
        favourites,
        loading,
        ready,
        error,
        storageError,
        refresh,
        chooseBranch: (id) => {
          if (!catalog?.branches.some((b) => b.id === id))
            throw new Error('Choose an available branch.');
          if (cart.length && id !== branchId)
            throw new Error('Clear the cart before changing restaurant branches.');
          branchRef.current = id;
          setBranchId(id);
        },
        add: (selection) => {
          if (!ready) throw new Error('Refresh the restaurant menu before adding food.');
          const product = catalog.products.find((p) => p.id === selection.productId);
          if (!product) throw new Error('This item is no longer available.');
          validateSelection(product, selection);
          const next = addLine(cartRef.current, selection);
          cartRef.current = next;
          setCart(next);
        },
        quantity: (id, n) => {
          const next = changeQuantity(cartRef.current, id, n);
          cartRef.current = next;
          setCart(next);
        },
        clear: () => {
          cartRef.current = [];
          setCart([]);
        },
        favourite: (id) =>
          setFavourites((current) =>
            current.includes(id) ? current.filter((v) => v !== id) : [...current, id].slice(0, 200),
          ),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useCustomer() {
  const context = useContext(Context);
  if (!context) throw new Error('Customer provider is missing.');
  return context;
}
export function linePrice(product: Product, line: CartSelection) {
  return getUnitPrice(product, line);
}
