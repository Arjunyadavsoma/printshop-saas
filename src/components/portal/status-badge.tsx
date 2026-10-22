'use client';

import { Badge } from '@/components/ui/badge';
import type { OrderStatus } from '@platform/core/domain';

/** Stable colour mapping for every order status across the portal. */
export const STATUS_BADGE_CLASS: Record<OrderStatus, string> = {
  awaiting_payment: 'bg-zinc-200 text-zinc-700 border-zinc-300',
  paid: 'bg-sky-100 text-sky-800 border-sky-200',
  printing: 'bg-amber-100 text-amber-800 border-amber-200',
  ready: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  collected: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled: 'bg-rose-100 text-rose-700 border-rose-200',
  refunded: 'bg-violet-100 text-violet-800 border-violet-200',
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
    <Badge variant="outline" className={`gap-1 font-medium ${cls}`}>
      <span className="inline-block size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </Badge>
  );
}
