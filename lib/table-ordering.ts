import type { CartItem, OrderItem, OrderTax } from '../types';
import type { SharedCatalog } from './commerce/client';

export type TableContext = {
  table: { branchId: string; branchName: string; tableLabel: string; generation: number };
  catalog: SharedCatalog;
};
export type TableRequest = {
  id: string;
  number: string;
  branchId: string;
  tableLabel: string;
  generation: number;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  version: number;
  createdAt: string;
  expiresAt: string;
  items: OrderItem[];
  customerName?: string;
  /** Required for new branch QR requests; older retained requests may omit it. */
  customerPhone?: string;
  notes?: string;
  subtotal: number;
  tax?: OrderTax;
  /** Frozen signed paise adjustment; older requests may omit it. */
  roundOff?: number;
  roundOffPolicy?: 'nearest_rupee';
  total: number;
  acceptedOrderNumber?: string;
  /** Owner-only projection for current menu repricing. */
  selections?: CartItem[];
};
export type ManagedTable = {
  id: string;
  branchId: string;
  tableLabel: string;
  active: boolean;
  generation: number;
  version: number;
  token: string;
};
