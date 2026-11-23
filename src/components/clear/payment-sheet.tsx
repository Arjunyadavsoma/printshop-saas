'use client';

import { useState } from 'react';
import { Copy, Check, ChevronRight } from 'lucide-react';

/**
 * Clear design system — UPI payment sheet body.
 *
 * The content that lives inside a Sheet (bottom mobile / right drawer
 * desktop) for collecting UPI payment. The host owns the sheet chrome;
 * this component is just the body.
 *
 * Two presentation modes:
 *  - Mobile (`isDesktop = false`, default): a vertical stack of UPI app
 *    buttons — Google Pay, PhonePe, Paytm, BHIM, Other. Each is a 56px
 *    row with the app NAME (text only, no brand logo) + a trailing
 *    chevron. Tapping fires `onAppTap(appId)` so the host can trigger the
 *    platform UPI intent.
 *  - Desktop (`isDesktop = true`): a QR placeholder (production generates
 *    the PNG server-side from `upiUri`), plus the same Copy-UPI-ID row.
 *
 * Below the apps (both modes): a "Copy UPI ID" row gives the manual
 * fallback for users whose UPI intent handler is missing.
 */

interface UpiApp {
  id: string;
  name: string;
}

const DEFAULT_APPS: UpiApp[] = [
  { id: 'googlepay', name: 'Google Pay' },
  { id: 'phonepe', name: 'PhonePe' },
  { id: 'paytm', name: 'Paytm' },
  { id: 'bhim', name: 'BHIM' },
  { id: 'other', name: 'Other UPI apps' },
];

interface PaymentSheetProps {
  upiId: string;
  upiUri: string;
  onAppTap: (appId: string) => void;
  isDesktop?: boolean;
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
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable in insecure contexts — the UPI ID
      // stays visible so the user can long-press to copy manually.
    }
  };

  return (
    <div className="bg-[var(--surface)] safe-bottom">
      <div className="px-4 pt-1 pb-2">
        <p className="text-sm text-[var(--label-2)]">
          {isDesktop
            ? 'Scan the QR with any UPI app to pay.'
            : 'Choose an app to pay. The shop confirms — never the app itself.'}
        </p>
      </div>

      {isDesktop ? (
        <div className="px-4 py-4 flex flex-col items-center gap-3">
          <div
            className="size-56 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--fill)] flex flex-col items-center justify-center gap-2 p-4"
            role="img"
            aria-label="UPI QR code"
          >
            {upiUri ? (
              <p className="text-[11px] text-[var(--label-2)] break-all text-center leading-tight tnum">
                {upiUri}
              </p>
            ) : (
              <p className="text-[13px] text-[var(--label-2)]">QR unavailable</p>
            )}
          </div>
        </div>
      ) : (
        <div className="px-2 py-1 flex flex-col gap-0" role="group" aria-label="UPI apps">
          {apps.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => onAppTap(app.id)}
              className={[
                'w-full min-h-[56px] flex items-center gap-3 px-3',
                'text-left transition-colors duration-150',
                'hover:bg-[var(--fill)] active:bg-[var(--fill)]',
                'border-b border-[var(--hairline)] last:border-b-0',
                'focus:outline-none',
              ].join(' ')}
            >
              <span className="flex-1 text-base text-[var(--label)] font-medium">
                {app.name}
              </span>
              <ChevronRight className="size-5 text-[var(--label-3)]" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 px-4 pb-4">
        <div className="flex items-center gap-3 rounded-[var(--radius-input)] border border-[var(--hairline)] bg-[var(--fill)] px-4 py-3">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-[var(--label-2)] leading-tight">Shop UPI ID</p>
            <p className="text-base text-[var(--label)] tnum font-medium truncate">
              {upiId}
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={`Copy UPI ID ${upiId}`}
            className={[
              'inline-flex items-center gap-2 px-3 min-h-[44px] rounded-full',
              'bg-[var(--surface)] border border-[var(--hairline)]',
              'text-sm text-[var(--label)] font-medium',
              'hover:bg-[var(--accent-tint)] active:bg-[var(--accent-tint)]',
              'transition-colors',
            ].join(' ')}
          >
            {copied ? (
              <>
                <Check className="size-4 text-[var(--success)]" aria-hidden="true" />
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

export { PaymentSheet as ClearPaymentSheet };
export default PaymentSheet;
