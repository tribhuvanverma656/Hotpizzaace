'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { toast } from 'sonner';
import { normalizeCustomerPhone, verifyDemoCustomerLogin } from './customer-auth';
import {
  getCustomerAddresses,
  getDefaultCustomerAddress,
  parseCustomerAddress,
  customerAddressFingerprint,
  sameCustomerAddress,
  sanitizeSavedAddresses,
  MAX_SAVED_ADDRESSES,
  type CustomerAddressSaveOptions,
} from './customer-addresses';
import { STORE_VERSION, migrateDemoState } from './persistence';
import { DEFAULT_BRANCH_ID, getOrderBranchId } from './branches';
import type {
  CartItem,
  CartSelection,
  Category,
  CheckoutInput,
  Order,
  OrderStatus,
  PaymentStatus,
  Product,
  RestaurantSettings,
  Branch,
  SavedAddress,
} from '../types';
import {
  initialBranches,
  initialCategories,
  initialOrders,
  initialProducts,
  initialSettings,
} from './data';
import {
  getAllowedOrderStatuses,
  getCartTotals,
  getItemOptions,
  getUnitPrice,
  validateCoupon,
  validateSelection,
} from './pricing';
import {
  categorySchema,
  branchSchema,
  parseOrThrow,
  productSchema,
  settingsSchema,
  validateCheckout,
} from './validation';

export type DemoState = {
  products: Product[];
  categories: Category[];
  orders: Order[];
  settings: RestaurantSettings;
  branches: Branch[];
  selectedBranchId: string;
  adminBranchId: string;
  cartBranchId: string | null;
  cart: CartItem[];
  coupon: string;
  hydrated: boolean;
  adminSession: boolean;
  customerSession: { phone: string } | null;
  savedAddresses: SavedAddress[];
  persistenceError: string | null;
  idempotencyKeys: Record<string, string>;
  setHydrated: (hydrated: boolean) => void;
  addToCart: (selection: CartSelection) => void;
  updateQuantity: (id: string, quantity: number) => void;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  applyCoupon: (code: string) => void;
  clearCoupon: () => void;
  createOrder: (input: CheckoutInput) => Order;
  updateOrderStatus: (id: string, status: OrderStatus) => void;
  updatePaymentStatus: (id: string, status: PaymentStatus) => void;
  saveProduct: (product: Product) => void;
  archiveProduct: (id: string) => void;
  saveCategory: (category: Category) => void;
  archiveCategory: (id: string) => void;
  deleteCategory: (id: string) => void;
  reorderCategory: (id: string, direction: 'up' | 'down') => void;
  updateSettings: (settings: RestaurantSettings) => void;
  saveBranch: (branch: Branch) => void;
  selectBranch: (id: string, clearCart?: boolean) => void;
  selectAdminBranch: (id: string) => void;
  login: (email: string, password: string) => boolean;
  logout: () => void;
  loginCustomer: (phone: string, code: string) => void;
  logoutCustomer: () => void;
  saveCustomerAddress: (
    input: Omit<SavedAddress, 'ownerPhone'>,
    options?: CustomerAddressSaveOptions,
  ) => void;
  removeCustomerAddress: (id: string, expected?: SavedAddress) => void;
  setDefaultCustomerAddress: (id: string) => void;
};

const STORAGE_KEY = 'hot-pizza-ace-demo-v1';
let isRehydrating = false;
let allowMigrationWrite = false;

function reportPersistenceError(): void {
  const message =
    'Browser storage could not save your demo changes. They will be lost on refresh. Free some storage or use a smaller product image.';
  queueMicrotask(() => {
    if (useDemoStore.getState().persistenceError === message) return;
    useDemoStore.setState({ persistenceError: message });
    toast.error(message, { id: 'demo-persistence-error', duration: 12000 });
  });
}

function makeId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
}

function configuration(selection: CartSelection): string {
  return JSON.stringify([
    selection.productId,
    selection.sizeId ?? '',
    selection.crustId ?? '',
    [...selection.toppingIds].sort(),
    selection.notes.trim(),
  ]);
}

function validCouponAfterChange(cart: CartItem[], state: DemoState): string {
  if (!state.coupon || !cart.length) return '';
  try {
    return validateCoupon(
      state.coupon,
      state.settings,
      getCartTotals(cart, state.products, state.settings).subtotal,
    );
  } catch {
    return '';
  }
}

/** Browser-local demonstration store. adminSession is a cosmetic gate, never production authorization. */
export const useDemoStore = create<DemoState>()(
  persist(
    (set, get) => ({
      products: structuredClone(initialProducts),
      categories: structuredClone(initialCategories),
      orders: structuredClone(initialOrders),
      settings: structuredClone(initialSettings),
      branches: structuredClone(initialBranches),
      selectedBranchId: DEFAULT_BRANCH_ID,
      adminBranchId: DEFAULT_BRANCH_ID,
      cartBranchId: null,
      cart: [],
      coupon: '',
      hydrated: false,
      adminSession: false,
      customerSession: null,
      savedAddresses: [],
      persistenceError: null,
      idempotencyKeys: {},
      setHydrated: (hydrated) => set({ hydrated }),
      addToCart: (selection) => {
        const state = get();
        if (
          state.cart.length &&
          state.cartBranchId &&
          state.cartBranchId !== state.selectedBranchId
        )
          throw new Error(
            'Your cart belongs to another branch. Change branch or clear the cart first.',
          );
        const product = state.products.find((item) => item.id === selection.productId);
        if (!product) throw new Error('This item is no longer on the menu.');
        const normalized = {
          ...selection,
          notes: selection.notes.trim(),
          toppingIds: [...selection.toppingIds].sort(),
        };
        validateSelection(product, normalized);
        const same = state.cart.find((item) => configuration(item) === configuration(normalized));
        if (same && same.quantity + normalized.quantity > 20)
          throw new Error('You can order up to 20 of the same item at once.');
        const cart = same
          ? state.cart.map((item) =>
              item.id === same.id
                ? { ...item, quantity: item.quantity + normalized.quantity }
                : item,
            )
          : [...state.cart, { ...normalized, id: makeId('cart') }];
        set({
          cart,
          cartBranchId: state.selectedBranchId,
          coupon: validCouponAfterChange(cart, state),
        });
      },
      updateQuantity: (id, quantity) => {
        const state = get();
        const item = state.cart.find((candidate) => candidate.id === id);
        if (!item) throw new Error('This cart item no longer exists.');
        if (quantity === 0) {
          get().removeFromCart(id);
          return;
        }
        const product = state.products.find((candidate) => candidate.id === item.productId);
        if (!product) throw new Error('This item is no longer on the menu. Please remove it.');
        validateSelection(product, { ...item, quantity });
        const cart = state.cart.map((candidate) =>
          candidate.id === id ? { ...candidate, quantity } : candidate,
        );
        set({ cart, coupon: validCouponAfterChange(cart, state) });
      },
      removeFromCart: (id) => {
        const state = get();
        const cart = state.cart.filter((item) => item.id !== id);
        set({ cart, coupon: validCouponAfterChange(cart, state) });
      },
      clearCart: () => set({ cart: [], cartBranchId: null, coupon: '' }),
      applyCoupon: (code) => {
        const state = get();
        if (!state.cart.length) throw new Error('Add something delicious to your cart first.');
        const subtotal = getCartTotals(state.cart, state.products, state.settings).subtotal;
        set({ coupon: validateCoupon(code, state.settings, subtotal) });
      },
      clearCoupon: () => set({ coupon: '' }),
      createOrder: (input) => {
        const state = get();
        const branch = state.branches.find((branch) => branch.id === state.selectedBranchId);
        if (
          !branch ||
          (input.branchId && input.branchId !== branch.id) ||
          (state.cart.length && state.cartBranchId && state.cartBranchId !== branch.id)
        )
          throw new Error('Your branch has changed. Review your cart before checking out.');
        const previousId = state.idempotencyKeys[input.idempotencyKey];
        if (previousId) {
          const previous = state.orders.find((order) => order.id === previousId);
          if (previous) {
            if (getOrderBranchId(previous) !== branch.id)
              throw new Error('This checkout belongs to another branch. Start a new checkout.');
            return structuredClone(previous);
          }
        }
        if (!state.cart.length)
          throw new Error('Your cart is empty. Add a favourite before checking out.');
        const totals = getCartTotals(
          state.cart,
          state.products,
          state.settings,
          state.coupon,
          input.fulfillment,
        );
        const validated = validateCheckout(input, state.settings, totals.subtotal, totals.total);
        if (state.coupon) validateCoupon(state.coupon, state.settings, totals.subtotal);
        const id = makeId('order');
        const order: Order = {
          branchId: branch.id,
          branchName: branch.name,
          branchAddress: state.settings.address,
          branchPhone: state.settings.phone,
          id,
          number: `HPA-${Date.now().toString(36).toUpperCase()}-${id.slice(-4).toUpperCase()}`,
          createdAt: new Date().toISOString(),
          customer: structuredClone(validated.customer),
          fulfillment: validated.fulfillment,
          items: state.cart.map((item) => {
            const product = state.products.find((candidate) => candidate.id === item.productId)!;
            return {
              id: item.id,
              productId: product.id,
              name: product.name,
              image: product.image,
              options: getItemOptions(product, item),
              notes: item.notes,
              quantity: item.quantity,
              unitPrice: getUnitPrice(product, item),
            };
          }),
          ...totals,
          coupon: state.coupon,
          paymentMethod: validated.paymentMethod,
          paymentStatus: validated.paymentStatus,
          status: 'pending',
        };
        const completed =
          order.paymentStatus === 'simulated_paid' || order.paymentMethod === 'cash';
        set({
          orders: [order, ...state.orders],
          idempotencyKeys: { ...state.idempotencyKeys, [validated.idempotencyKey]: id },
          ...(completed ? { cart: [], coupon: '' } : {}),
        });
        return structuredClone(order);
      },
      updateOrderStatus: (id, status) => {
        const order = get().orders.find((item) => item.id === id);
        if (!order) throw new Error('This order could not be found.');
        if (order.status === status) return;
        if (!getAllowedOrderStatuses(order).includes(status))
          throw new Error(
            `Cannot change an order from ${order.status.replaceAll('_', ' ')} to ${status.replaceAll('_', ' ')}.`,
          );
        set((state) => ({
          orders: state.orders.map((item) => (item.id === id ? { ...item, status } : item)),
        }));
      },
      updatePaymentStatus: (id, status) => {
        const state = get();
        const order = state.orders.find((item) => item.id === id);
        if (!order) throw new Error('This order could not be found.');
        if (order.paymentStatus === status) return;
        if (order.status === 'cancelled' || order.status === 'rejected')
          throw new Error('Payment cannot be retried for a cancelled or rejected order.');
        if (order.paymentStatus === 'simulated_paid')
          throw new Error('A completed demo payment cannot be changed to an unpaid state.');
        if (!['initiated', 'pending', 'simulated_paid', 'failed'].includes(status))
          throw new Error('Choose a valid demo payment state.');
        if (order.paymentMethod === 'cash' && status !== 'simulated_paid')
          throw new Error('Cash orders await collection or can be marked collected in this demo.');
        const matchingCart =
          getOrderBranchId(order) === state.selectedBranchId &&
          state.cart.length === order.items.length &&
          state.cart.every((item) =>
            order.items.some(
              (ordered) => ordered.id === item.id && ordered.quantity === item.quantity,
            ),
          );
        set({
          orders: state.orders.map((item) =>
            item.id === id ? { ...item, paymentStatus: status } : item,
          ),
          ...(status === 'simulated_paid' && matchingCart ? { cart: [], coupon: '' } : {}),
        });
      },
      saveProduct: (input) => {
        const product = parseOrThrow(productSchema, input);
        const state = get();
        const previous = state.products.find((candidate) => candidate.id === product.id);
        if (product.sizes.length && product.sizes[0].price !== product.price) {
          const baseChanged = previous && previous.price !== product.price;
          const firstSizeChanged = !previous || previous.sizes[0]?.price !== product.sizes[0].price;
          if (baseChanged && !firstSizeChanged)
            product.sizes[0] = { ...product.sizes[0], price: product.price };
          else if (!baseChanged && firstSizeChanged && previous)
            product.price = product.sizes[0].price;
          else throw new Error('The base price must match the first size’s full price.');
        }
        if (
          !state.categories.some(
            (category) => category.id === product.categoryId && !category.archived,
          )
        )
          throw new Error('Choose an active category.');
        if (
          state.products.some(
            (candidate) => candidate.id !== product.id && candidate.slug === product.slug,
          )
        )
          throw new Error('Another product already uses that slug.');
        const products = state.products.some((item) => item.id === product.id)
          ? state.products.map((item) => (item.id === product.id ? structuredClone(product) : item))
          : [...state.products, structuredClone(product)];
        set({ products, coupon: validCouponAfterChange(state.cart, { ...state, products }) });
      },
      archiveProduct: (id) => {
        const state = get();
        if (!state.products.some((product) => product.id === id))
          throw new Error('This product could not be found.');
        const products = state.products.map((product) =>
          product.id === id ? { ...product, archived: true, available: false } : product,
        );
        set({ products, coupon: validCouponAfterChange(state.cart, { ...state, products }) });
      },
      saveCategory: (input) => {
        const category = parseOrThrow(categorySchema, input);
        const state = get();
        if (state.categories.some((item) => item.id !== category.id && item.slug === category.slug))
          throw new Error('Another category already uses that slug.');
        if (
          category.archived &&
          state.products.some((product) => product.categoryId === category.id && !product.archived)
        )
          throw new Error('Move or archive this category’s products first.');
        set({
          categories: state.categories.some((item) => item.id === category.id)
            ? state.categories.map((item) => (item.id === category.id ? category : item))
            : [...state.categories, category],
        });
      },
      archiveCategory: (id) => {
        const state = get();
        if (!state.categories.some((category) => category.id === id))
          throw new Error('This category could not be found.');
        if (state.products.some((product) => product.categoryId === id && !product.archived))
          throw new Error('Move or archive this category’s products first.');
        set({
          categories: state.categories.map((category) =>
            category.id === id ? { ...category, archived: true } : category,
          ),
        });
      },
      deleteCategory: (id) => {
        const state = get();
        const category = state.categories.find((item) => item.id === id);
        if (!category) throw new Error('This category could not be found.');
        if (!category.archived)
          throw new Error('Archive this category before deleting it permanently.');
        if (state.products.some((product) => product.categoryId === id))
          throw new Error(
            'Move all linked products, including deleted products, to another category before deleting this category.',
          );
        set({ categories: state.categories.filter((item) => item.id !== id) });
      },
      reorderCategory: (id, direction) => {
        const active = [...get().categories]
          .filter((category) => !category.archived)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        const index = active.findIndex((category) => category.id === id);
        if (index < 0) throw new Error('This category could not be found.');
        const next = direction === 'up' ? index - 1 : index + 1;
        if (next < 0 || next >= active.length) return;
        [active[index], active[next]] = [active[next], active[index]];
        const sortOrders = new Map(active.map((category, sortOrder) => [category.id, sortOrder]));
        set((state) => ({
          categories: state.categories.map((category) => ({
            ...category,
            sortOrder: sortOrders.get(category.id) ?? category.sortOrder,
          })),
        }));
      },
      updateSettings: (input) => {
        const settings = parseOrThrow(settingsSchema, input);
        const state = get();
        const branch = state.branches.find((branch) => branch.id === state.adminBranchId);
        if (!branch) throw new Error('Choose a branch before saving settings.');
        const branches = state.branches.map((branch) =>
          branch.id === state.adminBranchId
            ? { ...branch, settings: structuredClone(settings) }
            : branch,
        );
        if (state.adminBranchId !== state.selectedBranchId) {
          set({ branches });
          return;
        }
        set({
          branches,
          settings: structuredClone(settings),
          coupon: validCouponAfterChange(state.cart, { ...state, settings }),
        });
      },
      saveBranch: (input) => {
        const branch = parseOrThrow(branchSchema, input);
        const state = get();
        if (state.branches.some((item) => item.id !== branch.id && item.slug === branch.slug))
          throw new Error('Another branch already uses that URL name.');
        branch.settings.servicePostalCodes = [...new Set(branch.settings.servicePostalCodes)];
        const branches = state.branches.some((item) => item.id === branch.id)
          ? state.branches.map((item) => (item.id === branch.id ? structuredClone(branch) : item))
          : [...state.branches, structuredClone(branch)];
        set({
          branches,
          ...(branch.id === state.selectedBranchId
            ? {
                settings: structuredClone(branch.settings),
                coupon: validCouponAfterChange(state.cart, { ...state, settings: branch.settings }),
              }
            : {}),
        });
      },
      selectAdminBranch: (id) => {
        if (!get().branches.some((branch) => branch.id === id))
          throw new Error('Choose an existing branch.');
        set({ adminBranchId: id });
      },
      selectBranch: (id, clearCart = false) => {
        const state = get();
        const branch = state.branches.find((branch) => branch.id === id);
        if (!branch) throw new Error('This branch is not available.');
        if (id === state.selectedBranchId) return;
        if (state.cart.length && !clearCart)
          throw new Error(
            'Your cart belongs to another branch. Clear it before changing branches.',
          );
        set({
          selectedBranchId: id,
          settings: structuredClone(branch.settings),
          cart: [],
          cartBranchId: null,
          coupon: '',
        });
      },
      login: (email, password) => {
        const valid =
          email.trim().toLowerCase() === 'owner@hotpizzaace.in' && password === 'Demo@1234';
        set({ adminSession: valid });
        return valid;
      },
      logout: () => set({ adminSession: false }),
      // A deliberately simulated session. Supabase must enforce identity in Phase 2.
      loginCustomer: (phone, code) =>
        set({ customerSession: verifyDemoCustomerLogin(phone, code) }),
      logoutCustomer: () => set({ customerSession: null }),
      saveCustomerAddress: (input, options) => {
        const state = get();
        if (!state.customerSession) throw new Error('Sign in to save an address.');
        const address = parseCustomerAddress(input, state.customerSession.phone);
        if (options && normalizeCustomerPhone(options.expectedOwnerPhone) !== address.ownerPhone)
          throw new Error('Your signed-in account changed. Reopen the address form before saving.');
        const own = getCustomerAddresses(state.savedAddresses, address.ownerPhone);
        const existing = state.savedAddresses.find((item) => item.id === address.id);
        if (existing && !own.some((item) => item.id === existing.id))
          throw new Error('This address is not available for your signed-in mobile number.');
        if (options?.mode === 'update') {
          if (!existing)
            throw new Error('This address was removed. Reopen your saved addresses before saving.');
          if (!sameCustomerAddress(existing, options.expected))
            throw new Error(
              'This address changed in another tab. Load the latest address before saving.',
            );
        } else if (existing) {
          throw new Error('This address already exists. Reopen it to edit the latest details.');
        }
        if (
          own.some(
            (item) =>
              item.id !== address.id &&
              customerAddressFingerprint(item) === customerAddressFingerprint(address),
          )
        )
          throw new Error('This address is already saved. Edit the existing address instead.');
        if (!existing && own.length >= MAX_SAVED_ADDRESSES)
          throw new Error('You can save up to 10 addresses. Remove one before adding another.');
        const defaultId = address.isDefault
          ? address.id
          : (getDefaultCustomerAddress(state.savedAddresses, address.ownerPhone)?.id ?? address.id);
        const ownedIds = new Set([...own.map((item) => item.id), address.id]);
        const savedAddresses = existing
          ? state.savedAddresses.map((item) => (item.id === address.id ? address : item))
          : [...state.savedAddresses, address];
        set({
          savedAddresses: savedAddresses.map((item) =>
            ownedIds.has(item.id) ? { ...item, isDefault: item.id === defaultId } : item,
          ),
        });
      },
      removeCustomerAddress: (id, expected) => {
        const state = get();
        if (!state.customerSession) throw new Error('Sign in to manage saved addresses.');
        const owner = normalizeCustomerPhone(state.customerSession.phone);
        const own = getCustomerAddresses(state.savedAddresses, owner);
        const existing = own.find((item) => item.id === id);
        if (!existing)
          throw new Error('This address is not available for your signed-in mobile number.');
        if (expected && !sameCustomerAddress(existing, expected))
          throw new Error(
            'This address changed in another tab. Review its latest details before removing it.',
          );
        const remaining = own.filter((item) => item.id !== id);
        const defaultId = remaining.find((item) => item.isDefault)?.id ?? remaining[0]?.id;
        const ownedIds = new Set(remaining.map((item) => item.id));
        set({
          savedAddresses: state.savedAddresses
            .filter((item) => item.id !== id)
            .map((item) =>
              ownedIds.has(item.id) ? { ...item, isDefault: item.id === defaultId } : item,
            ),
        });
      },
      setDefaultCustomerAddress: (id) => {
        const state = get();
        if (!state.customerSession) throw new Error('Sign in to manage saved addresses.');
        const own = getCustomerAddresses(state.savedAddresses, state.customerSession.phone);
        if (!own.some((item) => item.id === id))
          throw new Error('This address is not available for your signed-in mobile number.');
        const ownedIds = new Set(own.map((item) => item.id));
        set({
          savedAddresses: state.savedAddresses.map((item) =>
            ownedIds.has(item.id) ? { ...item, isDefault: item.id === id } : item,
          ),
        });
      },
    }),
    {
      name: STORAGE_KEY,
      version: STORE_VERSION,
      migrate: (state, version) => {
        allowMigrationWrite = true;
        return migrateDemoState(state, version) as DemoState;
      },
      skipHydration: true,
      merge: (saved, current) => {
        const state = { ...current, ...((saved ?? {}) as Partial<DemoState>) };
        return {
          ...state,
          savedAddresses: sanitizeSavedAddresses(state.savedAddresses),
          coupon: validCouponAfterChange(state.cart, state),
        };
      },
      storage: createJSONStorage(() => ({
        getItem: (name) => {
          if (typeof window === 'undefined') return null;
          try {
            return window.localStorage.getItem(name);
          } catch {
            reportPersistenceError();
            return null;
          }
        },
        setItem: (name, value) => {
          if (typeof window === 'undefined' || (isRehydrating && !allowMigrationWrite)) return;
          allowMigrationWrite = false;
          try {
            window.localStorage.setItem(name, value);
          } catch {
            reportPersistenceError();
          }
        },
        removeItem: (name) => {
          if (typeof window === 'undefined') return;
          try {
            window.localStorage.removeItem(name);
          } catch {
            reportPersistenceError();
          }
        },
      })),
      partialize: (state) => ({
        products: state.products,
        categories: state.categories,
        orders: state.orders,
        settings: state.settings,
        branches: state.branches,
        selectedBranchId: state.selectedBranchId,
        adminBranchId: state.adminBranchId,
        cartBranchId: state.cartBranchId,
        cart: state.cart,
        coupon: state.coupon,
        adminSession: state.adminSession,
        customerSession: state.customerSession,
        savedAddresses: state.savedAddresses,
        idempotencyKeys: state.idempotencyKeys,
      }),
      onRehydrateStorage: () => {
        isRehydrating = true;
        allowMigrationWrite = false;
        return (state, error) => {
          if (state) state.setHydrated(true);
          else useDemoStore.setState({ hydrated: true });
          isRehydrating = false;
          if (error) reportPersistenceError();
        };
      },
    },
  ),
);

/** Keep customer tracking and admin updates in sync across tabs on this browser. */
export function attachDemoStoreSync(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY && event.newValue) void useDemoStore.persist.rehydrate();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
