export type Option = {
  id: string;
  name: string;
  price: number;
  /** Add-on charge by selected size ID; price is the fallback for other sizes. */
  sizePrices?: Record<string, number>;
};
export type Category = {
  id: string;
  name: string;
  slug: string;
  archived?: boolean;
  sortOrder: number;
};
export type Product = {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string;
  categoryId: string;
  vegetarian: boolean;
  price: number;
  available: boolean;
  archived?: boolean;
  featured: boolean;
  bestseller: boolean;
  sizes: Option[];
  crusts: Option[];
  toppings: Option[];
  badge?: string;
};
export type CartSelection = {
  productId: string;
  sizeId?: string;
  crustId?: string;
  toppingIds: string[];
  quantity: number;
  notes: string;
};
export type CartItem = CartSelection & { id: string };
export type Fulfillment = 'delivery' | 'pickup';
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'picked_up'
  | 'cancelled'
  | 'rejected';
export type PaymentStatus = 'initiated' | 'pending' | 'simulated_paid' | 'failed';
export type Customer = {
  name: string;
  phone: string;
  address: string;
  locality: string;
  postalCode: string;
  landmark: string;
  instructions: string;
};
export type SavedAddress = {
  id: string;
  ownerPhone: string;
  label: string;
  customer: Customer;
  isDefault: boolean;
};
export type OrderItem = {
  id: string;
  productId: string;
  name: string;
  image: string;
  options: string[];
  notes: string;
  quantity: number;
  unitPrice: number;
};
export type Order = {
  id: string;
  number: string;
  createdAt: string;
  customer: Customer;
  fulfillment: Fulfillment;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  total: number;
  coupon: string;
  paymentMethod: 'upi' | 'card' | 'cash';
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  branchId?: string;
  branchName?: string;
  branchAddress?: string;
  branchPhone?: string;
};
export type RestaurantSettings = {
  name: string;
  address: string;
  phone: string;
  openingHours: string;
  temporarilyClosed: boolean;
  acceptingOrders: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryFee: number;
  /** Food subtotal before coupons needed for free delivery; null disables the offer. */
  freeDeliveryThreshold: number | null;
  minimumOrder: number;
  servicePostalCodes: string[];
  preparationMinutes: number;
  paymentMethods: ('upi' | 'card' | 'cash')[];
  couponCode: string;
  couponPercent: number;
  couponMinimum: number;
  couponMaximum: number;
};
export type Branch = {
  id: string;
  slug: string;
  name: string;
  settings: RestaurantSettings;
};
export type CheckoutInput = {
  customer: Customer;
  fulfillment: Fulfillment;
  paymentMethod: 'upi' | 'card' | 'cash';
  paymentStatus: PaymentStatus;
  idempotencyKey: string;
  branchId?: string;
};
