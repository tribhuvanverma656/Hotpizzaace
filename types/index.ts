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
  /** Configured GST classification for a selling price that already includes tax (for example MRP). */
  gstInclusive?: { rateBps: number; code: string };
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
export type Fulfillment = 'delivery' | 'pickup' | 'dine_in';
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'picked_up'
  | 'served'
  | 'closed'
  | 'cancelled'
  | 'rejected';
export type PaymentStatus = 'initiated' | 'pending' | 'simulated_paid' | 'paid' | 'failed';
export type PaymentMode =
  | 'simulation'
  | 'razorpay_test'
  | 'razorpay_live'
  | 'phonepe_test'
  | 'phonepe_live'
  | 'counter_manual';
export type CounterSettlement = {
  source: 'staff';
  method: 'cash' | 'upi';
  amount: number;
  cashTendered?: number;
  change?: number;
  upiReference?: string;
  confirmedBy: string;
  confirmedAt: string;
};
export type BillingProfile = {
  businessName: string;
  address: string;
  gstin: string;
  fssaiNumber: string;
  stateName: string;
  stateCode: '09';
  sac: '996331';
  cgstRate: 2.5;
  sgstRate: 2.5;
};
export type OrderTax = {
  supplier: BillingProfile;
  taxableValue: number;
  cgst: number;
  sgst: number;
  total: number;
  /** Present only on orders containing explicitly configured GST-inclusive products. */
  version?: 2;
  includedTotal?: number;
  groups?: OrderTaxGroup[];
};
export type OrderTaxGroup = {
  pricing: 'exclusive' | 'inclusive';
  rateBps: number;
  code: string;
  grossValue: number;
  deliveryFee: number;
  discount: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  total: number;
};
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
  /** Immutable copy of the catalogue classification used when this order was priced. */
  gstInclusive?: { rateBps: number; code: string };
};
export type Order = {
  id: string;
  /** Server revision used to reject stale shared-order updates. */
  version?: number;
  /** Private receipt/tracking capability for a guest order, when available. */
  trackingUrl?: string;
  number: string;
  createdAt: string;
  completedAt?: string;
  channel?: 'website' | 'counter';
  /** Server-bound restaurant QR source; online orders use the website payment ledger. */
  qr?: { tableId: string; tableLabel: string; generation: number };
  environment?: 'development' | 'production';
  counter?: {
    entry?: 'staff' | 'table_qr';
    sourceRequestId?: string;
    tableLabel: string;
    payLater: boolean;
    payLaterReason?: string;
    createdBy: string;
    servedAt?: string;
    closedAt?: string;
  };
  settlement?: CounterSettlement;
  /** Audited removal of an accidentally paid software test; original invoice/receipt stays intact. */
  testVoid?: { kind: 'no_money_software_test'; recordedAt: string; reason: string };
  customer: Customer;
  fulfillment: Fulfillment;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  discount: number;
  /** Frozen signed final-payable adjustment in paise; absent on older unrounded bills. */
  roundOff?: number;
  /** New bills use nearest-rupee rounding with the MRP ceiling; unmarked adjustments are historical floors. */
  roundOffPolicy?: 'nearest_rupee';
  total: number;
  tax?: OrderTax;
  invoice?: { number: string; issuedAt: string; kind: 'tax_invoice' | 'test_bill' };
  coupon: string;
  paymentMethod: 'upi' | 'card' | 'cash';
  paymentStatus: PaymentStatus;
  /** Set by the server; provider test captures are distinct from real funds. */
  paymentMode?: PaymentMode;
  /** A late or second capture needs reconciliation without reviving fulfillment. */
  paymentReviewRequired?: boolean;
  /** Provider proves a refund, but complete processed details still need reconciliation. */
  refundSyncPending?: boolean;
  /** Provider-verified processed refunds; the original invoice and captured gross stay unchanged. */
  refund?: {
    amount: number;
    status: 'partial' | 'full';
    entries: {
      id: string;
      amount: number;
      processedAt: string;
      timestampSource: 'provider_event' | 'verified_at';
    }[];
  };
  status: OrderStatus;
  branchId?: string;
  branchName?: string;
  branchAddress?: string;
  branchPhone?: string;
};
export type RestaurantSettings = {
  billing?: BillingProfile;
  counterAcceptingOrders?: boolean;
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
