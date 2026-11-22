/**
 * order-status-mapping — single source of truth for mapping the API's 13
 * order statuses to the design system's two customer-facing surfaces:
 *
 *  1. A 5-step numbered timeline (Placed → Payment → Printing → Ready →
 *     Collected). The brief allows numbering for true sequences — the order
 *     lifecycle IS a sequence.
 *  2. A compact {@link StatusPill} variant (pending / printing / ready /
 *     collected / error) used inline beside order numbers and in list rows.
 *
 * All 13 backend statuses (draft, awaiting_payment, payment_submitted,
 * paid, queued, printing, partially_printed, ready, collected,
 * paid_on_pickup, cancelled, failed, expired) collapse into these two
 * surfaces. The mapping is exported so the tracking page and the "My
 * orders" page render the same colour + label for the same status.
 */

import type { OrderStatus as PillStatus } from '@/components/customer/status-pill';
import type { StepStatus, TimelineStep } from '@/components/customer/status-timeline';

/** The 5 named lifecycle steps shown to the customer. */
export const TIMELINE_LABELS = ['Placed', 'Payment', 'Printing', 'Ready', 'Collected'] as const;

/**
 * Map an API order status to the matching {@link StatusPill} variant.
 *
 *  - pending   → awaiting payment or submitted-but-unverified (amber)
 *  - printing  → paid / queued / printing / partially_printed (cyan)
 *  - ready     → ready or pay-on-pickup (green)
 *  - collected → collected (green + check)
 *  - error     → cancelled / failed / expired (red)
 */
export function mapToPill(status: string): PillStatus {
  switch (status) {
    case 'draft':
    case 'awaiting_payment':
    case 'payment_submitted':
      return 'pending';
    case 'paid':
    case 'queued':
    case 'printing':
    case 'partially_printed':
      return 'printing';
    case 'ready':
    case 'paid_on_pickup':
      return 'ready';
    case 'collected':
      return 'collected';
    case 'cancelled':
    case 'failed':
    case 'expired':
      return 'error';
    default:
      return 'pending';
  }
}

/** Default human label for an API status (used when the StatusPill label is shown standalone). */
export function statusLabel(status: string): string {
  const pill = mapToPill(status);
  switch (status) {
    case 'draft': return 'Draft';
    case 'awaiting_payment': return 'Payment pending';
    case 'payment_submitted': return 'Payment submitted';
    case 'paid': return 'Paid';
    case 'queued': return 'Queued for print';
    case 'printing': return 'Printing';
    case 'partially_printed': return 'Partially printed';
    case 'ready': return 'Ready for pickup';
    case 'paid_on_pickup': return 'Ready — pay at counter';
    case 'collected': return 'Collected';
    case 'cancelled': return 'Cancelled';
    case 'failed': return 'Failed';
    case 'expired': return 'Expired';
    default: return pill.charAt(0).toUpperCase() + pill.slice(1);
  }
}

/**
 * The lifecycle index of an order status (0 = placed, 4 = collected).
 * Returns -1 when the order is in a terminal error state (cancelled /
 * failed / expired) — the caller should render the timeline with NO step
 * current and a separate "cancelled" panel instead.
 */
function lifecycleIndex(status: string): number {
  switch (status) {
    case 'draft':
      return 0;
    case 'awaiting_payment':
    case 'payment_submitted':
      return 1; // Payment step
    case 'paid':
    case 'queued':
    case 'printing':
    case 'partially_printed':
      return 2; // Printing step
    case 'ready':
    case 'paid_on_pickup':
      return 3; // Ready step
    case 'collected':
      return 4; // Collected step
    case 'cancelled':
    case 'failed':
    case 'expired':
      return -1;
    default:
      return 0;
  }
}

/** Whether the order is in a terminal state where no further polling is useful. */
export function isTerminalStatus(status: string): boolean {
  return ['collected', 'cancelled', 'failed', 'expired'].includes(status);
}

/** Whether the order is in a cancelled/expired/failed state (i.e. NOT a happy ending). */
export function isCancelledStatus(status: string): boolean {
  return ['cancelled', 'failed', 'expired'].includes(status);
}

/** Whether the customer can still cancel the order (only before printing starts). */
export function canCancel(status: string): boolean {
  return ['draft', 'awaiting_payment', 'payment_submitted', 'paid', 'queued'].includes(status);
}

/**
 * Build the 5 timeline steps for the {@link StatusTimeline} component.
 *
 *  - For a normal happy-path status, steps before the current one are
 *    `done`, the current is `current`, and the rest are `future`.
 *  - For a cancelled / failed / expired status, every completed step up to
 *    the cancellation point is `done`, and the current + future steps are
 *    `future` (the caller renders a separate cancellation panel).
 *
 * @param status   The API order status.
 * @param timestamps  Optional ISO-string timestamps per step, keyed by label.
 */
export function buildTimeline(
  status: string,
  timestamps: Partial<Record<typeof TIMELINE_LABELS[number], string>> = {},
): TimelineStep[] {
  const idx = lifecycleIndex(status);
  const cancelled = isCancelledStatus(status);

  return TIMELINE_LABELS.map((label, i) => {
    let stepStatus: StepStatus;
    if (cancelled) {
      // Render done up to the cancellation point, future after.
      stepStatus = idx >= 0 && i <= idx ? 'done' : 'future';
    } else if (i < idx) {
      stepStatus = 'done';
    } else if (i === idx) {
      stepStatus = 'current';
    } else {
      stepStatus = 'future';
    }
    const ts = timestamps[label];
    return ts ? { label, status: stepStatus, timestamp: ts } : { label, status: stepStatus };
  });
}

/** Format an ISO timestamp as "2:14 PM, today" (or "Mon, 4 Dec" if older). */
export function formatStepTimestamp(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (sameDay) return `${time}, today`;
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
