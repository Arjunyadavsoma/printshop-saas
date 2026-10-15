import { z } from 'zod';
import {
  ORDER_STATUSES,
  PAYMENT_PROVIDERS,
  type OrderStatus,
  type PaymentProvider,
} from './enums';

/**
 * An order groups one or more customer-uploaded files into a single billable
 * unit. All money is stored in integer paise as a BIGINT-equivalent number.
 */
export interface Order {
  id: string;
  shopId: string;
  customerToken: string;
  status: OrderStatus;
  totalAmountPaise: number;
  currency: string;
  paymentProvider: PaymentProvider | null;
  paymentTxnId: string | null;
  paymentUtr: string | null;
  paidAt: Date | null;
  customerPhone: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const OrderSchema = z.object({
  id: z.string().uuid(),
  shopId: z.string().uuid(),
  customerToken: z.string().min(4).max(12),
  status: z.enum(ORDER_STATUSES as [OrderStatus, ...OrderStatus[]]),
  totalAmountPaise: z.number().int().nonnegative(),
  currency: z.string().length(3),
  paymentProvider: z
    .enum(PAYMENT_PROVIDERS as [PaymentProvider, ...PaymentProvider[]])
    .nullable(),
  paymentTxnId: z.string().nullable(),
  paymentUtr: z.string().nullable(),
  paidAt: z.date().nullable(),
  customerPhone: z.string().max(20).nullable(),
  notes: z.string().max(1000).nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** Allowed transitions to keep the state machine honest. */
export const ALLOWED_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  awaiting_payment: ['paid', 'cancelled'],
  paid: ['printing', 'cancelled', 'refunded'],
  printing: ['ready', 'cancelled'],
  ready: ['collected', 'cancelled'],
  collected: [],
  cancelled: [],
  refunded: [],
};

/** @returns true if moving from→to is a legal transition. */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  const allowed = ALLOWED_ORDER_TRANSITIONS[from];
  return allowed.includes(to);
}
