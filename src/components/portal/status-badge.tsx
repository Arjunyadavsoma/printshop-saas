'use client';

import { Badge } from '@/components/ui/badge';
import type { OrderStatus } from '@platform/core/domain';

/**
 * Stable colour mapping for every order status across the portal.
 *
 * Uses the PrintShop semantic design tokens (docs/DESIGN_SYSTEM.md):
 *   awaiting_payment → muted   (neutral, action needed)
 *   paid             → info    (settled, calm)
 *   printing         → warning (in-progress, attention)
 *   ready            → success (action: collect)
 *   collected        → success (terminal, success)
 *   cancelled        → danger  (terminal, negative)
 *   refunded         → muted   (terminal, neutral)
 *
 * These tokens are defined in src/app/globals.css :root + .dark and
 * bridged into Tailwind utilities via @theme inline.
 */
export const STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  awaiting_payment: 'bg-muted text-muted-foreground border-border',
  paid: 'bg-info-soft text-info-foreground border-info/30',
  printing: 'bg-warning-soft text-warning-foreground border-warning/30',
  ready: 'bg-success-soft text-success-foreground border-success/30',
  collected: 'bg-success/10 text-success-foreground border-success/20',
  cancelled: 'bg-danger-soft text-danger-foreground border-danger/30',
  refunded: 'bg-muted text-muted-foreground border-border',
};

/** Human label for each status — keeps capitalisation consistent. */
export const STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  printing: 'Printing',
  ready: 'Ready',
  collected: 'Collected',
  cancelled: 'Cancelled',
  refunded: 'Refunded',
};

export function StatusBadge({ status }: { status: OrderStatus | string }) {
  const cls = STATUS_BADGE_CLASS[status as OrderStatus] ?? 'bg-muted text-muted-foreground border-border';
  const label = STATUS_LABEL[status as OrderStatus] ?? status;
  return (
    <Badge variant="outline" className={`gap-1.5 font-medium ${cls}`} aria-label={`Order status: ${label}`}>
      <span className="inline-block size-1.5 rounded-full bg-current opacity-70" aria-hidden="true" />
      {label}
    </Badge>
  );
}
