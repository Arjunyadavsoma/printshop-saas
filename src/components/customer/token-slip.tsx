'use client';

import { QrCode } from 'lucide-react';

/**
 * TokenSlip — the physical "counter slip" metaphor for the order confirmation.
 *
 * When an order is placed, the customer gets a **pickup code** (e.g. "A-7")
 * that they show at the counter to collect their prints. This component
 * renders that code as the HERO of a slip that looks like the perforated
 * paper stubs Indian print shops have used for decades — dashed tear-edges
 * (`perforated-top` / `perforated-bottom`), curled-paper radius
 * (`radius-soft`), and a floating `shadow-slip` elevation.
 *
 * The pickup code is the single most important piece of information on the
 * post-payment screen, so it gets:
 *  - centered display
 *  - the largest type on the slip (text-2xl bold)
 *  - tabular numerals so digits don't shuffle when the code updates
 *  - a muted "Pickup code" label above so the meaning is unambiguous
 *
 * The slip also carries supporting context the counter staff need:
 *  - order number (the shop's internal ID)
 *  - shop name
 *  - order summary (e.g. "12 B&W · 3 Colour pages")
 *  - a QR code (rendered as a placeholder here; production generates the
 *    PNG/SVG server-side from `qrUrl` and the shop scans it to pull up the
 *    order without typing the pickup code).
 *
 * The QR is intentionally NOT the hero — customers scan QRs to pay, but at
 * the counter the human-readable code is faster and works without a scanner.
 * The QR is a fallback / verification, sized smaller than the pickup code.
 */

interface TokenSlipProps {
  /** The hero — what the customer reads aloud at the counter, e.g. "A-7". */
  pickupCode: string;
  /** The shop's internal order number, e.g. "ORD-1042". */
  orderNumber: string;
  /** Shop display name, e.g. "QuickPrint, Koramangala". */
  shopName: string;
  /** One-line order summary, e.g. "12 B&W · 3 Colour pages". */
  summary: string;
  /**
   * URL to the server-generated QR image. When provided, an <img> is
   * rendered. When omitted, a framed placeholder is shown instead so the
   * slip's layout is stable during development and on routes without a QR.
   */
  qrUrl?: string;
}

export function TokenSlip({
  pickupCode,
  orderNumber,
  shopName,
  summary,
  qrUrl,
}: TokenSlipProps) {
  return (
    <article
      className={[
        'relative',
        'rounded-[var(--radius-soft)]',
        'bg-[var(--color-surface)]',
        'perforated-top perforated-bottom',
        'shadow-[var(--shadow-slip)]',
        'overflow-hidden',
      ].join(' ')}
      aria-label="Pickup token slip"
    >
      <div className="px-5 py-6 flex flex-col items-center gap-4">
        {/* ── HERO: pickup code ── */}
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-xs uppercase tracking-wider text-[var(--color-muted)]">
            Pickup code
          </p>
          <p
            className="text-2xl font-bold text-[var(--color-ink)] tnum tabular-nums leading-tight"
            aria-label={`Pickup code ${pickupCode}`}
          >
            {pickupCode}
          </p>
        </div>

        {/* Hairline separator between the hero and the receipt metadata. */}
        <div
          className="w-full border-t border-dashed border-[var(--color-border-ink)]"
          aria-hidden="true"
        />

        {/* ── Receipt metadata ── */}
        <dl className="w-full flex flex-col gap-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--color-muted)]">Order</dt>
            <dd className="text-[var(--color-ink)] font-medium tnum text-right truncate">
              {orderNumber}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--color-muted)]">Shop</dt>
            <dd className="text-[var(--color-ink)] font-medium text-right truncate">
              {shopName}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--color-muted)]">Summary</dt>
            <dd className="text-[var(--color-ink)] font-medium tnum text-right">
              {summary}
            </dd>
          </div>
        </dl>

        {/* ── QR ── */}
        <div className="flex flex-col items-center gap-1.5 pt-1">
          {qrUrl ? (
            // Production: server renders the QR image. alt text describes
            // what scanning does so screen readers / non-visual users get
            // the same affordance as sighted users.
            <img
              src={qrUrl}
              alt="QR code linking to this order for the shop to scan"
              width={96}
              height={96}
              className="size-24 rounded-[var(--radius-tight)] border border-[var(--color-border-ink)]"
            />
          ) : (
            // Placeholder — same footprint as the eventual QR image so the
            // slip layout doesn't shift when the real QR loads. Shows a
            // QrCode glyph + a tiny "QR" caption.
            <div
              className="size-24 rounded-[var(--radius-tight)] border border-[var(--color-border-ink)] bg-[var(--color-paper)] flex flex-col items-center justify-center gap-1"
              role="img"
              aria-label="QR code placeholder"
            >
              <QrCode className="size-8 text-[var(--color-muted)]" aria-hidden="true" />
              <span className="text-[10px] text-[var(--color-muted)] uppercase tracking-wider">
                QR
              </span>
            </div>
          )}
          <p className="text-[10px] text-[var(--color-muted)] text-center max-w-[12rem]">
            Show this code or scan the QR at the counter.
          </p>
        </div>
      </div>
    </article>
  );
}
