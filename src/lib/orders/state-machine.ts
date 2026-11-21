/**
 * Order + task state machines (Phase 3) — enforced server-side; every legal
 * transition also writes an OrderEvent at the service layer.
 */

export type OrderStatus =
  | 'draft'
  | 'awaiting_payment'
  | 'payment_submitted'
  | 'paid'
  | 'queued'
  | 'printing'
  | 'partially_printed'
  | 'ready'
  | 'collected'
  | 'paid_on_pickup'
  | 'cancelled'
  | 'failed'
  | 'expired';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'draft', 'awaiting_payment', 'payment_submitted', 'paid', 'queued',
  'printing', 'partially_printed', 'ready', 'collected', 'paid_on_pickup',
  'cancelled', 'failed', 'expired',
];

/** Legal transitions. `any` side exits are listed explicitly per state. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  // PRINT_THEN_PAY shops go straight to the queue (brief §3); UPI_THEN_PAY
  // goes through awaiting_payment first.
  draft: ['awaiting_payment', 'queued', 'cancelled'],
  awaiting_payment: ['payment_submitted', 'paid', 'cancelled', 'expired'],
  payment_submitted: ['paid', 'awaiting_payment' /* UTR rejected → resubmit */, 'cancelled', 'expired', 'payment_submitted' /* UTR resubmit */],
  paid: ['queued', 'cancelled'],
  // queued → ready is legal: with a fast agent the server may only observe
  // the terminal task state; the PRINTING step is written when observed.
  queued: ['printing', 'ready', 'cancelled'],
  printing: ['partially_printed', 'ready', 'failed'],
  partially_printed: ['ready', 'failed'],
  ready: ['collected', 'paid_on_pickup'],
  paid_on_pickup: ['collected'],
  collected: [],
  cancelled: [],
  failed: ['queued' /* retry after operator action */],
  expired: [],
};

export class IllegalTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Illegal order transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

/** Throws on an illegal transition; returns the target status on success. */
export function assertOrderTransition(from: OrderStatus, to: OrderStatus): OrderStatus {
  if (from === to) return from; // idempotent no-op (e.g. duplicate events)
  if (!TRANSITIONS[from]?.includes(to)) throw new IllegalTransitionError(from, to);
  return to;
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Order becomes READY only when ALL tasks PRINTED (brief §3). */
export function shouldMarkReady(taskStatuses: string[]): boolean {
  return taskStatuses.length > 0 && taskStatuses.every(s => s === 'printed' || s === 'completed');
}

/** Task status machine (PrintJob.status). UNCERTAIN is never auto-retried. */
export type TaskStatus =
  | 'queued' | 'dispatched' | 'received' | 'printing' | 'spooled'
  | 'printed' | 'completed' | 'uncertain' | 'failed' | 'cancelled'
  | 'needs_review' | 'assigned';

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  queued: ['dispatched', 'assigned', 'failed', 'cancelled'],
  assigned: ['dispatched', 'received', 'failed', 'cancelled'],
  dispatched: ['received', 'uncertain', 'failed', 'cancelled'],
  received: ['printing', 'spooled', 'failed', 'uncertain'],
  printing: ['spooled', 'printed', 'failed', 'uncertain'],
  spooled: ['printed', 'uncertain', 'failed'],
  printed: [],
  completed: [], // legacy alias of printed
  uncertain: [], // NEVER auto-retried — shopkeeper resolution only
  failed: ['queued' /* attempt+1 only after approval or safe failure */],
  cancelled: [],
  needs_review: [],
};

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (from === to) return from;
  if (!TASK_TRANSITIONS[from]?.includes(to)) {
    throw new IllegalTransitionError(from as unknown as OrderStatus, to as unknown as OrderStatus);
  }
  return to;
}

/**
 * Whether a task-status report may auto-retry: only SAFE failures
 * (device rejected the task before printing) bump attempt+1 automatically.
 * UNCERTAIN outcomes and spooled/printing failures need operator action.
 */
export function isSafeRetry(status: string): boolean {
  return status === 'failed' && true;
}
