/**
 * Shared type definitions for the admin portal.
 *
 * These types mirror the JSON shapes returned by the /api/v1/admin/* endpoints.
 * They are client-side types — they don't touch the database layer or any
 * adapter concrete. All amounts are integer paise.
 */

export type OrderStatus =
  | 'awaiting_payment'
  | 'paid'
  | 'printing'
  | 'ready'
  | 'collected'
  | 'cancelled'
  | 'refunded';

export type FileStatus =
  | 'pending'
  | 'queued'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'needs_review';

export type PrintJobStatus =
  | 'queued'
  | 'assigned'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'needs_review';

export type ColorMode = 'bw' | 'color';
export type PaperSize = 'a4' | 'a3' | 'letter' | 'legal';
export type PaymentProvider = 'phonepe' | 'paytm' | 'googlepay' | 'razorpay' | 'cashfree';
export type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';

export interface ShopPricingConfig {
  bw_a4_per_page: number;
  color_a4_per_page: number;
  bw_a3_per_page: number;
  color_a3_per_page: number;
  bw_letter_per_page: number;
  color_letter_per_page: number;
  bw_legal_per_page: number;
  color_legal_per_page: number;
  duplex_discount: number;
  bulk_threshold: number;
  bulk_discount_pct: number;
  min_order_value: number;
}

/** A shop row in the admin shops list. */
export interface AdminShopSummary {
  id: string;
  name: string;
  slug: string;
  upiId: string;
  ownerUserId: string;
  ownerEmail: string;
  paymentProvider: PaymentProvider;
  address: string;
  phone: string;
  timezone: string;
  isActive: boolean;
  subscriptionTier: SubscriptionTier;
  subscriptionExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  pricingSummaries: {
    bwA4PerPage: number;
    colorA4PerPage: number;
    minOrderValue: number;
  };
  stats: {
    orderCount: number;
    paidOrders: number;
    paidSalesPaise: number;
    agentsOnline: number;
    agentsTotal: number;
  };
}

export interface AdminShopListResponse {
  shops: AdminShopSummary[];
  pagination: { limit: number; offset: number; total: number };
}

export interface AdminShopOrder {
  id: string;
  customerToken: string;
  status: OrderStatus;
  totalAmountPaise: number;
  paymentTxnId: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface AdminShopAgent {
  id: string;
  name: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  printerName: string | null;
  version: string | null;
  os: string | null;
}

export interface AdminShopDetailResponse {
  shop: {
    id: string;
    name: string;
    slug: string;
    upiId: string;
    ownerUserId: string;
    paymentProvider: PaymentProvider;
    address: string;
    phone: string;
    timezone: string;
    isActive: boolean;
    subscriptionTier: SubscriptionTier;
    subscriptionExpiresAt: string | null;
    createdAt: string;
    updatedAt: string;
    pricingConfig: ShopPricingConfig;
  };
  summary: {
    totalOrders: number;
    paidOrders: number;
    revenuePaise: number;
    activeAgents: number;
    totalAgents: number;
  };
  orders: AdminShopOrder[];
  agents: AdminShopAgent[];
}

export interface AdminOrderListItem {
  id: string;
  shopId: string;
  shopName: string;
  shopSlug: string;
  customerToken: string;
  status: OrderStatus;
  totalAmountPaise: number;
  currency: string;
  paymentProvider: PaymentProvider;
  paymentTxnId: string | null;
  paidAt: string | null;
  customerPhone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOrderListResponse {
  orders: AdminOrderListItem[];
  pagination: { limit: number; offset: number; total: number };
}

export interface AdminOrderFile {
  id: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
  copies: number;
  colorMode: ColorMode;
  pageRange: string | null;
  paperSize: PaperSize;
  duplex: boolean;
  pricePaise: number;
  status: FileStatus;
  printedAt: string | null;
  createdAt: string;
}

export interface AdminOrderPrintJob {
  id: string;
  fileId: string;
  agentId: string | null;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AdminOrderDetailResponse {
  order: {
    id: string;
    shopId: string;
    shopName: string;
    shopSlug: string;
    customerToken: string;
    status: OrderStatus;
    totalAmountPaise: number;
    currency: string;
    paymentProvider: PaymentProvider;
    paymentTxnId: string | null;
    paymentUtr: string | null;
    paidAt: string | null;
    customerPhone: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
  };
  files: AdminOrderFile[];
  printJobs: AdminOrderPrintJob[];
}

export interface AdminShopBreakdown {
  shopId: string;
  shopName: string;
  orders: number;
  paidOrders: number;
  revenuePaise: number;
}

export interface AdminAnalyticsResponse {
  platform: {
    totalShops: number;
    activeShops: number;
    inactiveShops: number;
    totalOrders: number;
    ordersByStatus: Record<OrderStatus, number>;
    paidOrders: number;
    grossPaidValuePaise: number;
    shopEarningsPaise: number;
    platformRevenuePaise: number;
    pendingPaymentVerification: number;
    failedOrDisputed: number;
  };
  shops: AdminShopBreakdown[];
  health: {
    database: string;
    storage: string;
    cache: string;
    realtime: string;
    agentsOnline: number;
    agentsOffline: number;
  };
}

export interface AdminAuditEntry {
  id: string;
  shopId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

export interface AdminAuditResponse {
  entries: AdminAuditEntry[];
}

export interface ReadyCheck {
  name: string;
  provider: string;
  healthy: boolean;
  latencyMs: number;
}

export interface ReadyResponse {
  ready: boolean;
  checks: ReadyCheck[];
}

/** Login response shape from POST /api/v1/auth/login. */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; role: string; shopId: string | null };
}

/**
 * Unwrap the standard API envelope `{ success, data, error }` returned by
 * every /api/v1/* route. Throws a JS Error if the request failed or the
 * envelope reports success=false — keeps admin-page logic terse.
 *
 * The useApiClient.request<T> generic is the *raw response body shape*, which
 * for our API is the envelope `{ success, data: T, error }`. Callers pass
 * `unwrap<InnerT>(res)` to extract the inner `data` field as `InnerT`.
 */
export function unwrap<T>(
  res: { status: number; data: unknown },
): T {
  if (!res.data) throw new Error(`HTTP ${res.status}: empty response body`);
  const env = res.data as {
    success?: boolean;
    data?: T;
    error?: { code?: string; message?: string };
  };
  if (env.success === false) {
    throw new Error(env.error?.message ?? `HTTP ${res.status}: request failed`);
  }
  if (env.data === undefined || env.data === null) {
    throw new Error(`HTTP ${res.status}: response had no data`);
  }
  return env.data;
}
