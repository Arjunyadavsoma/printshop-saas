'use client';

import { QrCode } from 'lucide-react';

/**
 * Clear design system — token slip.
 *
 * The hero of the post-payment screen. A surface card with a 22px radius,
 * the pickup code centred at 56px / 700 weight (the largest type on the
 * slip), a dashed perforation separator, and a receipt-style metadata
 * block (order number, shop name, summary) below.
 *
 * The QR is intentionally NOT the hero — customers scan QRs to pay, but
 * at the counter the human-readable code is faster. The QR is a
 * fallback / verification, sized smaller than the pickup code.
 *
 * Spec (from R8 reference):
 *  - pickup code: 56px / 700 / tabular numerals
 *  - dashed perforation between the hero + the metadata
 *  - "Show this at the counter" caption
 */

interface TokenSlipProps {
  pickupCode: string;
  orderNumber: string;
  shopName: string;
  summary: string;
  qrUrl?: string;
}

export function TokenSlip({ pickupCode, orderNumber, shopName, summary, qrUrl }: TokenSlipProps) {
  return (
    <article
      className={[
        'bg-[var(--surface)]',
        'rounded-[var(--radius-group)]',
        'shadow-[var(--shadow-card)]',
        'overflow-hidden',
      ].join(' ')}
      aria-label="Pickup token slip"
    >
      <div className="px-5 py-7 flex flex-col items-center gap-4">
        {/* Hero — pickup code */}
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-[13px] uppercase tracking-wider text-[var(--label-2)]">
            Pickup code
          </p>
          <p
            className="text-[56px] leading-none font-bold text-[var(--label)] tnum"
            aria-label={`Pickup code ${pickupCode}`}
          >
            {pickupCode}
          </p>
          <p className="text-[13px] text-[var(--label-2)] mt-1">
            Show this at the counter
          </p>
        </div>

        {/* Dashed perforation */}
        <div
          className="w-full border-t border-dashed border-[var(--hairline)]"
          aria-hidden="true"
        />

        {/* Receipt metadata */}
        <dl className="w-full flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--label-2)]">Order</dt>
            <dd className="text-[var(--label)] font-medium tnum text-right truncate">
              {orderNumber}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--label-2)]">Shop</dt>
            <dd className="text-[var(--label)] font-medium text-right truncate">
              {shopName}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--label-2)]">Summary</dt>
            <dd className="text-[var(--label)] font-medium tnum text-right">
              {summary}
            </dd>
          </div>
        </dl>

        {/* QR — smaller than the hero, verification fallback */}
        <div className="flex flex-col items-center gap-1.5 pt-1">
          {qrUrl ? (
            <img
              src={qrUrl}
              alt="QR code linking to this order for the shop to scan"
              width={96}
              height={96}
              className="size-24 rounded-[var(--radius-thumb)] border border-[var(--hairline)]"
            />
          ) : (
            <div
              className="size-24 rounded-[var(--radius-thumb)] border border-[var(--hairline)] bg-[var(--fill)] flex flex-col items-center justify-center gap-1"
              role="img"
              aria-label="QR code placeholder"
            >
              <QrCode className="size-8 text-[var(--label-3)]" aria-hidden="true" />
              <span className="text-[10px] text-[var(--label-3)] uppercase tracking-wider">
                QR
              </span>
            </div>
          )}
          <p className="text-[11px] text-[var(--label-3)] text-center max-w-[12rem]">
            Show this code or scan the QR at the counter.
          </p>
        </div>
      </div>
    </article>
  );
}

export { TokenSlip as ClearTokenSlip };
export default TokenSlip;
