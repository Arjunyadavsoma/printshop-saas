'use client';

import Link from 'next/link';
import { CheckCircle2, MapPin, ArrowRight, Copy, Package } from 'lucide-react';
import type { PlacedOrder, ShopCapabilities } from '../types';
import { formatRupees } from '../types';

/**
 * Step 5 — Order Confirmation.
 *
 * Shown ONLY after the backend has confirmed the order was placed AND the
 * payment intent was submitted (UTR or counter). The shopkeeper still
 * confirms the actual payment — the confirmation message says exactly that.
 *
 * Displays the real order ID, shop name, amount, and a "Track order" link
 * to the order-tracking page (/o/[token]).
 */
export function StepConfirmation({
  placed, shop, shopName,
}: {
  placed: PlacedOrder;
  shop: ShopCapabilities;
  shopName: string;
}) {
  const copyOrderNumber = () => {
    navigator.clipboard?.writeText(placed.orderNumber).catch(() => {});
  };

  return (
    <div className="mx-auto max-w-[560px] px-4 py-10 sm:px-6">
      {/* Success check */}
      <div className="flex flex-col items-center text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-[#F0FDF4]">
          <CheckCircle2 className="size-9 text-[#16A34A]" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-[26px] font-bold text-[var(--label)]">Order submitted!</h1>
        <p className="mt-2 text-[15px] text-[var(--label-2)]">
          Your order is confirmed with <span className="font-semibold text-[var(--label)]">{shopName}</span>. The shopkeeper will verify your payment shortly.
        </p>
      </div>

      {/* Order details card */}
      <div className="mt-6 rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--hairline)] pb-4">
          <div>
            <p className="text-[12px] font-medium text-[var(--label-2)]">Order number</p>
            <button onClick={copyOrderNumber} className="mt-0.5 flex items-center gap-1.5 text-[20px] font-bold text-[var(--label)]">
              {placed.orderNumber}
              <Copy className="size-4 text-[var(--label-3)]" />
            </button>
          </div>
          <div className="text-right">
            <p className="text-[12px] font-medium text-[var(--label-2)]">Amount</p>
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
          <div className="flex items-center justify-between">
            <dt className="text-[13px] text-[var(--label-2)]">Payment</dt>
            <dd className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-tint)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--accent-tint-text)]">Submitted — awaiting shopkeeper confirmation</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-[13px] text-[var(--label-2)]">Status</dt>
            <dd className="text-[14px] font-semibold text-[var(--label)]">Awaiting payment confirmation</dd>
          </div>
        </dl>
      </div>

      {/* Next steps */}
      <div className="mt-4 rounded-[14px] border border-[var(--hairline)] bg-[var(--accent-tint)] p-5">
        <div className="flex items-start gap-3">
          <MapPin className="mt-0.5 size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
          <div>
            <p className="text-[14px] font-semibold text-[var(--label)]">What happens next?</p>
            <ul className="mt-1.5 space-y-1 text-[13px] text-[var(--label-2)]">
              <li>· The shopkeeper verifies your payment</li>
              <li>· Your documents are printed</li>
              <li>· You'll get a notification when your order is ready for pickup</li>
              <li>· Show your pickup code at the counter to collect</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link
          href={`/o/${placed.token}`}
          className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--accent-press)]"
        >
          <Package className="size-4" /> Track your order
        </Link>
        <Link
          href="/"
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-6 text-[15px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
        >
          Back to home <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}
