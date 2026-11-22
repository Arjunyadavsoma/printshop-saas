'use client';

import { useState } from 'react';
import { Copy, Check, QrCode } from 'lucide-react';

/**
 * PaymentSheet — the CONTENT that lives inside a bottom sheet (or a desktop
 * modal) for collecting UPI payment.
 *
 * This component is intentionally NOT a BottomSheet itself — the drawer
 * chrome (drag handle, scrim, spring animation) is the host's concern. This
 * keeps the payment UI reusable: the same content slides up on mobile and
 * sits in a centered dialog on desktop.
 *
 * Two presentation modes:
 *  - **Mobile** (`isDesktop = false`, default): a vertical stack of UPI app
 *    buttons. Tapping one fires `onAppTap(appId)` so the host can trigger the
 *    platform UPI intent (`upi://pay?…`). Below the apps, a "Copy UPI ID" row
 *    gives the manual fallback for users whose UPI intent handler is missing
 *    or for shops that haven't whitelisted deep links.
 *  - **Desktop** (`isDesktop = true`): a QR code rendered from `upiUri`, plus
 *    the same "Copy UPI ID" row. Desktop users can't tap into a phone UPI app,
 *    so the QR is the primary path and the apps are hidden.
 *
 * Every interactive element meets the 48px touch-target minimum (WCAG 2.5.5).
 * Brand dots are decorative — the app NAME is the accessible label, never
 * colour alone.
 */

/** A UPI app the customer might have installed. */
interface UpiApp {
  /** Stable identifier passed to `onAppTap`, e.g. "googlepay". */
  id: string;
  /** Display name on the button. */
  name: string;
  /** Brand colour as a CSS var or hex — used only for the decorative dot. */
  brandColor: string;
}

/**
 * The default UPI app row order. Brands are listed in rough market-share
 * order on Indian phones, then "Other UPI apps" as the catch-all that hands
 * off to the OS UPI intent picker. Hosts can override by passing their own
 * list — this default is just a convenience.
 */
const DEFAULT_APPS: UpiApp[] = [
  { id: 'googlepay', name: 'Google Pay', brandColor: '#0F9D58' },
  { id: 'phonepe', name: 'PhonePe', brandColor: '#5F259F' },
  { id: 'paytm', name: 'Paytm', brandColor: '#00B9F1' },
  { id: 'bhim', name: 'BHIM', brandColor: '#F47216' },
  { id: 'other', name: 'Other UPI apps', brandColor: '#5B6675' },
];

interface PaymentSheetProps {
  /** The shop's UPI ID (e.g. "quickprint@okaxis"). Shown for manual copy. */
  upiId: string;
  /**
   * The full `upi://pay?…` URI used to (a) launch an app via intent on
   * mobile, and (b) generate the QR payload on desktop. The host generates
   * this; this component just renders it.
   */
  upiUri: string;
  /** Fired when the customer taps an app button. Host triggers the intent. */
  onAppTap: (appId: string) => void;
  /** When true, render the QR path instead of the app list. */
  isDesktop?: boolean;
  /** Optional override of the app list. Defaults to {@link DEFAULT_APPS}. */
  apps?: UpiApp[];
}

export function PaymentSheet({
  upiId,
  upiUri,
  onAppTap,
  isDesktop = false,
  apps = DEFAULT_APPS,
}: PaymentSheetProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(upiId);
      setCopied(true);
      // Reset after 2s so the affordance feels like a tap, not a stuck state.
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable in insecure contexts; the UPI ID stays
      // visible so the user can long-press to copy manually.
    }
  };

  return (
    <div className="bg-[var(--color-surface)] safe-bottom-bar">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-base font-semibold text-[var(--color-ink)]">
          Pay with UPI
        </h2>
        <p className="text-sm text-[var(--color-muted)] mt-0.5">
          {isDesktop
            ? 'Scan the QR with any UPI app to pay.'
            : 'Choose an app to pay. We confirm automatically.'}
        </p>
      </div>

      {/* ── Mode 1: QR (desktop) ── */}
      {isDesktop ? (
        <div className="px-4 py-4 flex flex-col items-center gap-3">
          {/* QR placeholder. In production the QR PNG/SVG is rendered
              server-side from `upiUri` (see /api/v1/dev/qr and /api/v1/qr).
              Here we render a framed box that shows the URI so the layout is
              honest about what's missing. */}
          <div
            className="size-56 rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-paper)] flex flex-col items-center justify-center gap-2 p-4"
            role="img"
            aria-label="UPI QR code"
          >
            {upiUri ? (
              <>
                <QrCode className="size-12 text-[var(--color-ink)]" aria-hidden="true" />
                <p className="text-[10px] text-[var(--color-muted)] break-all text-center leading-tight tnum">
                  {upiUri}
                </p>
              </>
            ) : (
              <p className="text-xs text-[var(--color-muted)]">QR unavailable</p>
            )}
          </div>
        </div>
      ) : (
        /* ── Mode 2: app buttons (mobile) ── */
        <div className="px-4 py-2 flex flex-col gap-2" role="group" aria-label="UPI apps">
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => onAppTap(app.id)}
              className="touch-target w-full min-h-[48px] flex items-center gap-3 px-4 rounded-[var(--radius-default)] bg-[var(--color-surface)] border border-[var(--color-border-ink)] hover:bg-[var(--color-paper)] active:bg-[var(--color-paper)] transition-colors text-left"
            >
              {/* Brand dot — decorative only. The app name is the accessible
                  label; colour never carries meaning on its own. */}
              <span
                className="size-3 rounded-full shrink-0"
                style={{ backgroundColor: app.brandColor }}
                aria-hidden="true"
              />
              <span className="flex-1 text-base text-[var(--color-ink)] font-medium">
                {app.name}
              </span>
              <ChevronRight />
            </button>
          ))}
        </div>
      )}

      {/* ── Copy UPI ID row — present in both modes ── */}
      <div className="mt-2 px-4 pb-4">
        <div className="flex items-center gap-3 rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-paper)] px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[var(--color-muted)] leading-tight">Shop UPI ID</p>
            <p className="text-base text-[var(--color-ink)] tnum font-medium truncate">
              {upiId}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={`Copy UPI ID ${upiId}`}
            className="touch-target inline-flex items-center gap-2 px-3 min-h-[48px] rounded-[var(--radius-default)] bg-[var(--color-surface)] border border-[var(--color-border-ink)] text-sm text-[var(--color-ink)] font-medium hover:bg-[var(--color-paper)] active:bg-[var(--color-paper)] transition-colors"
          >
            {copied ? (
              <>
                <Check className="size-4 text-[var(--color-success)]" aria-hidden="true" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="size-4" aria-hidden="true" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small inline chevron — kept local so we don't pull a second icon import. */
function ChevronRight() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--color-muted)] shrink-0"
      aria-hidden="true"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
