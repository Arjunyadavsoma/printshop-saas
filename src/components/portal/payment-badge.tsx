'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Shared payment-status badge.
 *
 * Consolidates the 2 inline copies that previously lived in:
 *   - src/app/shop/orders/[id]/page.tsx (took status + paidAt)
 *   - src/app/shop/orders/page.tsx     (took status: PaymentFilter — different signature)
 *
 * The canonical signature accepts the payment status string + optional paidAt.
 * Callers that previously passed a filter value should map it to a status first.
 *
 * Uses PrintShop semantic tokens (docs/DESIGN_SYSTEM.md):
 *   pending / awaiting → warning
 *   paid / verified    → success
 *   failed / disputed  → danger
 *   refunded           → muted
 */

export type PaymentStatusLike =
  | 'pending' | 'awaiting' | 'awaiting_payment'
  | 'paid' | 'verified' | 'manual_verified' | 'auto_verified'
  | 'failed' | 'disputed' | 'cancelled'
  | 'refunded'
  | string;

const PAYMENT_BADGE_CLASS: Record<string, string> = {
  pending: 'bg-warning-soft text-warning-foreground border-warning/30',
  awaiting: 'bg-warning-soft text-warning-foreground border-warning/30',
  awaiting_payment: 'bg-warning-soft text-warning-foreground border-warning/30',
  paid: 'bg-success-soft text-success-foreground border-success/30',
  verified: 'bg-success-soft text-success-foreground border-success/30',
  manual_verified: 'bg-success-soft text-success-foreground border-success/30',
  auto_verified: 'bg-success-soft text-success-foreground border-success/30',
  failed: 'bg-danger-soft text-danger-foreground border-danger/30',
  disputed: 'bg-danger-soft text-danger-foreground border-danger/30',
  cancelled: 'bg-muted text-muted-foreground border-border',
  refunded: 'bg-muted text-muted-foreground border-border',
};

const PAYMENT_LABEL: Record<string, string> = {
  pending: 'Pending',
  awaiting: 'Awaiting',
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  verified: 'Verified',
  manual_verified: 'Verified (manual)',
  auto_verified: 'Verified (auto)',
  failed: 'Failed',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export function PaymentBadge({
  status,
  paidAt,
  className,
  showDot = true,
}: {
  status: PaymentStatusLike;
  paidAt?: string | Date | number | null;
  className?: string;
  showDot?: boolean;
}) {
  const key = String(status ?? '').toLowerCase();
  const cls = PAYMENT_BADGE_CLASS[key] ?? 'bg-muted text-muted-foreground border-border';
  const label = PAYMENT_LABEL[key] ?? (status || 'Unknown');
  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 font-medium', cls, className)}
      aria-label={`Payment status: ${label}`}
    >
      {showDot && (
        <span className="inline-block size-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      )}
      {label}
    </Badge>
  );
}
