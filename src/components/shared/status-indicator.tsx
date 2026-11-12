'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Clock, CreditCard, CheckCircle2, XCircle, AlertCircle, Loader2,
  Package, Printer, PackageCheck, Ban, RotateCcw,
} from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Phase 8: Shared status indicator with icon + text + accessible name.
 * Status is NEVER communicated through color alone.
 */

export type StatusVariant =
  | 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

const VARIANT_CLASS: Record<StatusVariant, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  info: 'bg-info-soft text-info border-info-border',
  success: 'bg-success-soft text-success border-success-border',
  warning: 'bg-warning-soft text-warning-foreground border-warning-border',
  danger: 'bg-danger-soft text-danger border-danger-border',
  brand: 'bg-brand-soft text-brand border-brand-border',
};

const VARIANT_ICON: Record<StatusVariant, ReactNode> = {
  neutral: <Clock className="size-3.5" aria-hidden="true" />,
  info: <CreditCard className="size-3.5" aria-hidden="true" />,
  success: <CheckCircle2 className="size-3.5" aria-hidden="true" />,
  warning: <AlertCircle className="size-3.5" aria-hidden="true" />,
  danger: <XCircle className="size-3.5" aria-hidden="true" />,
  brand: <Package className="size-3.5" aria-hidden="true" />,
};

interface StatusIndicatorProps {
  variant: StatusVariant;
  label: string;
  icon?: ReactNode;
  className?: string;
}

export function StatusIndicator({
  variant, label, icon, className,
}: StatusIndicatorProps) {
  return (
    <Badge
      variant="outline"
      className={cn(VARIANT_CLASS[variant], 'gap-1.5 font-medium', className)}
      role="status"
      aria-label={label}
    >
      {icon ?? VARIANT_ICON[variant]}
      <span>{label}</span>
    </Badge>
  );
}

/**
 * Maps order status to presentation variant + label + icon.
 * Centralized so all pages show consistent status presentation.
 */
export const ORDER_STATUS_CONFIG: Record<string, { variant: StatusVariant; label: string; icon?: ReactNode }> = {
  awaiting_payment: { variant: 'warning', label: 'Awaiting payment', icon: <Clock className="size-3.5" aria-hidden="true" /> },
  paid: { variant: 'info', label: 'Paid', icon: <CreditCard className="size-3.5" aria-hidden="true" /> },
  printing: { variant: 'brand', label: 'Printing', icon: <Printer className="size-3.5" aria-hidden="true" /> },
  ready: { variant: 'success', label: 'Ready for pickup', icon: <PackageCheck className="size-3.5" aria-hidden="true" /> },
  collected: { variant: 'success', label: 'Completed', icon: <CheckCircle2 className="size-3.5" aria-hidden="true" /> },
  cancelled: { variant: 'danger', label: 'Cancelled', icon: <Ban className="size-3.5" aria-hidden="true" /> },
  refunded: { variant: 'neutral', label: 'Refunded', icon: <RotateCcw className="size-3.5" aria-hidden="true" /> },
};

export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  const config = ORDER_STATUS_CONFIG[status] ?? { variant: 'neutral' as StatusVariant, label: status };
  return (
    <StatusIndicator
      variant={config.variant}
      label={config.label}
      icon={config.icon}
      className={className}
    />
  );
}
