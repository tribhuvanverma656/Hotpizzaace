import type {
  Category,
  CheckoutInput,
  Order,
  OrderStatus,
  PaymentStatus,
  Product,
  RestaurantSettings,
} from '../../types';

/** Async interfaces deliberately match future server-backed repositories. */
export interface MenuRepository {
  listProducts(): Promise<Product[]>;
  findProduct(idOrSlug: string): Promise<Product | null>;
  saveProduct(product: Product): Promise<void>;
  archiveProduct(id: string): Promise<void>;
  listCategories(): Promise<Category[]>;
  saveCategory(category: Category): Promise<void>;
  archiveCategory(id: string): Promise<void>;
}
export interface OrderRepository {
  listOrders(): Promise<Order[]>;
  findOrder(id: string): Promise<Order | null>;
  createOrder(input: CheckoutInput): Promise<Order>;
  updateStatus(id: string, status: OrderStatus): Promise<void>;
  updatePaymentStatus(id: string, status: PaymentStatus): Promise<void>;
}
export interface SettingsRepository {
  getSettings(): Promise<RestaurantSettings>;
  saveSettings(settings: RestaurantSettings): Promise<void>;
}
