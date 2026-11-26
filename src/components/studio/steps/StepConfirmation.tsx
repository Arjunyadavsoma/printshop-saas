'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Copy,
  Package,
  ArrowRight,
  RotateCcw,
  Banknote,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import type { PlacedOrder, ShopCapabilities } from '../types';
import { formatRupees } from '../types';
import { PrimaryButton, ClearButton } from '@/components/clear/button';

/**
 * Step 5 — Order Confirmation / Payment Result.
 *
 * Renders one of five payment-status states. The parent owns the polling
 * that determines which state to show — this component just renders the
 * right card + actions and calls back via `onRefresh()` / `onRetry()`.
 *
 *   submitted  — payment intent accepted; awaiting shopkeeper confirmation.
 *   confirmed  — shop confirmed; order is being printed.
 *   rejected   — shop rejected the UTR / payment didn't reconcile.
 *   cancelled  — order was cancelled (by customer or shop).
 *   unknown    — couldn't confirm the status (network / server error). The
 *                backend will reconcile silently — the customer can still
 *                track via /o/[token].
 */
export type PaymentStatus = 'submitted' | 'confirmed' | 'rejected' | 'cancelled' | 'unknown';

export interface StepConfirmationProps {
  placed: PlacedOrder;
  shop: ShopCapabilities;
  shopName: string;
  paymentStatus: PaymentStatus;
  /** Reason the shop gave when rejecting the UTR (null when none). */
  rejectReason?: string | null;
  /** Trigger a fresh GET /o/[token] poll (manual "Refresh" button). */
  onRefresh: () => void;
  /** Go back to the payment step to retry (rejected state only). */
  onRetry: () => void;
  /** Order tracking token — for the /o/[token] deep-link. */
  token: string;
}

/** Tiny "copied" toast helper (avoids repeating setTimeout boilerplate). */
function useCopiedFlag() {
  const [active, setActive] = useState(false);
  const trigger = () => {
    setActive(true);
    window.setTimeout(() => setActive(false), 2000);
  };
  return { active, trigger };
}

/** Shared order-details card body — shown in every state. */
function OrderDetailsCard({
  placed,
  shopName,
}: {
  placed: PlacedOrder;
  shopName: string;
}) {
  const copied = useCopiedFlag();
  return (
    <div className="rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.12)]">
      <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">Order number</p>
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(placed.orderNumber).then(() => copied.trigger()).catch(() => {})}
            className="mt-0.5 flex items-center gap-1.5 text-[20px] font-bold text-[var(--label)]"
            aria-label="Copy order number"
          >
            {placed.orderNumber}
            {copied.active ? (
              <CheckCircle2 className="size-4 text-[#16A34A]" aria-hidden="true" />
            ) : (
              <Copy className="size-4 text-[var(--label-3)]" aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--label-3)]">Amount</p>
          <p className="text-[20px] font-bold text-[var(--accent)]">{formatRupees(placed.totalPaise)}</p>
        </div>
      </div>

      <dl className="mt-4 space-y-2.5">
        {placed.pickupCode && (
          <div className="flex items-center justify-between">
            <dt className="text-[13px] text-[var(--label-2)]">Pickup code</dt>
            <dd className="font-mono text-[15px] font-bold text-[var(--label)]">{placed.pickupCode}</dd>
          </div>
        )}
        <div className="flex items-center justify-between">
          <dt className="text-[13px] text-[var(--label-2)]">Shop</dt>
          <dd className="text-[14px] font-semibold text-[var(--label)]">{shopName}</dd>
        </div>
      </dl>
    </div>
  );
}

export function StepConfirmation({
  placed,
  shop,
  shopName,
  paymentStatus,
  rejectReason,
  onRefresh,
  onRetry,
  token,
}: StepConfirmationProps) {
  const trackingHref = `/o/${token}`;

  // Each state renders its own header card. The shared order-details card
  // + actions sit below.

  if (paymentStatus === 'confirmed') {
    return (
      <ConfirmationShell>
        <StatusHeader
          tone="success"
          icon={<CheckCircle2 className="size-9" aria-hidden="true" />}
          title="Order confirmed!"
          subtitle={`Payment confirmed by ${shopName}. Your documents are being printed — you'll be notified when they're ready for pickup.`}
        />

        <OrderDetailsCard placed={placed} shopName={shopName} />

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link
            href={trackingHref}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--accent-press)]"
          >
            <Package className="size-4" aria-hidden="true" /> Track your order
          </Link>
          <Link
            href="/find-a-shop"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-6 text-[15px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
          >
            Continue browsing <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>

        <p className="mt-4 text-center text-[12px] text-[var(--label-3)]">
          Show your pickup code at the counter to collect.
        </p>
      </ConfirmationShell>
    );
  }

  if (paymentStatus === 'rejected') {
    return (
      <ConfirmationShell>
        <StatusHeader
          tone="danger"
          icon={<XCircle className="size-9" aria-hidden="true" />}
          title="Payment not confirmed by the shop"
          subtitle="The shopkeeper couldn't verify your payment reference. You can retry with a new UTR or pay at the counter instead."
        />

        {rejectReason && (
          <div className="mt-[-12px] rounded-[12px] border border-[#FCA5A5]/40 bg-[#FEF2F2] p-4">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#991B1B]">Reason</p>
            <p className="mt-1 text-[14px] text-[#7F1D1D]">{rejectReason}</p>
          </div>
        )}

        <OrderDetailsCard placed={placed} shopName={shopName} />

        <div className="mt-4 flex flex-col gap-3">
          <PrimaryButton
            type="button"
            className="w-full"
            leadingIcon={<RotateCcw className="size-4" aria-hidden="true" />}
            onClick={onRetry}
          >
            Retry payment
          </PrimaryButton>
          {/* Show "Pay at counter" only if the shop accepts counter payment. */}
          {(shop.paymentMethods === 'cash' || shop.paymentMethods === 'both' || shop.paymentMethods === 'split') && (
            <Link
              href={trackingHref}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-6 text-[15px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
            >
              <Banknote className="size-4" aria-hidden="true" /> Pay at counter instead
            </Link>
          )}
          <Link
            href={trackingHref}
            className="text-center text-[13px] font-semibold text-[var(--accent)] hover:underline"
          >
            View order status
          </Link>
        </div>
      </ConfirmationShell>
    );
  }

  if (paymentStatus === 'cancelled') {
    return (
      <ConfirmationShell>
        <StatusHeader
          tone="muted"
          icon={<XCircle className="size-9" aria-hidden="true" />}
          title="Order cancelled"
          subtitle="This order was cancelled. Place a new order whenever you're ready."
        />

        <OrderDetailsCard placed={placed} shopName={shopName} />

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link
            href={`/s/${shop.slug}`}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-6 text-[15px] font-semibold text-white hover:bg-[var(--accent-press)]"
          >
            Place a new order <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
          <Link
            href="/find-a-shop"
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-6 text-[15px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
          >
            Find another shop
          </Link>
        </div>
      </ConfirmationShell>
    );
  }

  if (paymentStatus === 'unknown') {
    return (
      <ConfirmationShell>
        <StatusHeader
          tone="warning"
          icon={<AlertTriangle className="size-9" aria-hidden="true" />}
          title="We couldn't confirm your payment status"
          subtitle="There was a technical issue reaching the server. Your payment submission is still recorded — the backend will reconcile it shortly."
        />

        <OrderDetailsCard placed={placed} shopName={shopName} />

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link
            href={trackingHref}
            className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-6 text-[15px] font-semibold text-white hover:bg-[var(--accent-press)]"
          >
            <Package className="size-4" aria-hidden="true" /> Check order status
          </Link>
          <ClearButton
            type="button"
            variant="text"
            className="min-h-[48px]"
            leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
            onClick={onRefresh}
          >
            Refresh status
          </ClearButton>
        </div>

        <p className="mt-4 text-center text-[12px] text-[var(--label-3)]">
          If the issue persists, contact {shopName} directly.
        </p>
      </ConfirmationShell>
    );
  }

  // Default: 'submitted' — payment intent accepted, awaiting confirmation.
  return (
    <ConfirmationShell>
      <StatusHeader
        tone="pending"
        icon={<Clock className="size-9" aria-hidden="true" />}
        title="Payment submitted"
        subtitle={`We've received your payment reference. ${shopName} will confirm it shortly — you'll see the live status here.`}
      />

      <OrderDetailsCard placed={placed} shopName={shopName} />

      {/* Awaiting-confirmation explainer. */}
      <div className="mt-4 rounded-[14px] border border-[var(--hairline)] bg-[var(--accent-tint)] p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
          <div>
            <p className="text-[14px] font-semibold text-[var(--accent-tint-text)]">What happens next?</p>
            <ul className="mt-1.5 space-y-1 text-[13px] text-[var(--accent-tint-text)]">
              <li>The shopkeeper verifies your payment reference</li>
              <li>Your documents are queued for printing</li>
              <li>You'll get a notification when your order is ready for pickup</li>
              <li>Show your pickup code at the counter to collect</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Link
          href={trackingHref}
          className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-6 text-[15px] font-semibold text-white hover:bg-[var(--accent-press)]"
        >
          <Package className="size-4" aria-hidden="true" /> Track your order
        </Link>
        <ClearButton
          type="button"
          variant="text"
          className="min-h-[48px]"
          leadingIcon={<RefreshCw className="size-4" aria-hidden="true" />}
          onClick={onRefresh}
        >
          Refresh status
        </ClearButton>
      </div>

      <div className="mt-4 flex items-start gap-3 rounded-[12px] bg-[var(--ground)] p-3">
        <MapPin className="mt-0.5 size-4 shrink-0 text-[var(--label-2)]" aria-hidden="true" />
        <p className="text-[12px] text-[var(--label-2)]">
          If confirmation takes more than a few minutes, contact {shopName} directly. Your order is reserved with reference <span className="font-mono font-semibold text-[var(--label)]">{placed.orderNumber}</span>.
        </p>
      </div>
    </ConfirmationShell>
  );
}

/* ── Presentational helpers ─────────────────────────────────────────────── */

function ConfirmationShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[560px] space-y-4 px-4 py-8 sm:px-6 sm:py-10">
      {children}
    </div>
  );
}

interface StatusHeaderProps {
  tone: 'success' | 'danger' | 'warning' | 'pending' | 'muted';
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}

function StatusHeader({ tone, icon, title, subtitle }: StatusHeaderProps) {
  const toneClasses: Record<StatusHeaderProps['tone'], { bg: string; iconText: string; title: string }> = {
    success: { bg: 'bg-[#F0FDF4]', iconText: 'text-[#16A34A]', title: 'text-[var(--label)]' },
    danger: { bg: 'bg-[#FEF2F2]', iconText: 'text-[#DC2626]', title: 'text-[var(--label)]' },
    warning: { bg: 'bg-[#FFFBEB]', iconText: 'text-[#D97706]', title: 'text-[var(--label)]' },
    pending: { bg: 'bg-[var(--accent-tint)]', iconText: 'text-[var(--accent)]', title: 'text-[var(--label)]' },
    muted: { bg: 'bg-[var(--ground)]', iconText: 'text-[var(--label-2)]', title: 'text-[var(--label)]' },
  };
  const cls = toneClasses[tone];
  return (
    <div className="flex flex-col items-center text-center">
      <div className={['flex size-16 items-center justify-center rounded-full', cls.bg].join(' ')}>
        <span className={cls.iconText}>{icon}</span>
      </div>
      <h1 className="mt-4 text-[24px] font-bold sm:text-[26px] text-[var(--label)]">{title}</h1>
      <p className="mt-2 max-w-[460px] text-[15px] leading-relaxed text-[var(--label-2)]">{subtitle}</p>
    </div>
  );
}
