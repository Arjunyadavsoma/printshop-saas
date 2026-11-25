import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

/**
 * SiteHeader — the slim white top bar shared by public pages (spec §A.6).
 *
 * Left: green dot + shop name on shop pages, or "Printelyx" on platform
 * pages. Right: Help link on every viewport; Track order + Pricing on
 * desktop only (`hidden md:inline-flex`).
 *
 * Light Clear only — white surface, hairline bottom border, near-black
 * text. Centred in the same 1120px container as the footer and the
 * CustomerShell desktop content.
 *
 * This is chrome, not a shell: public routes render it above their page
 * content. It is deliberately NOT rendered by the root layout — the
 * shopkeeper portal (`/shop/*`) and admin have their own shells and must
 * not get the public header.
 *
 * Optional `onBack` renders a back chevron before the logo (pages that
 * used to render their own AppBar, e.g. order tracking); optional
 * `actions` renders extra controls at the right (e.g. the status pill).
 * Both default off, so existing callers are unaffected.
 */

export interface SiteHeaderProps {
  /** Shop display name on shop pages. Omit on platform pages → "Printelyx". */
  shopName?: string;
  /**
   * Open/closed status, shown after the shop name as ", open" / ", closed"
   * (spec: "● Sri Sai Xerox, open"). Omit to show just the name.
   */
  status?: 'open' | 'closed';
  /** Back action — renders a back chevron before the logo. */
  onBack?: () => void;
  /** Extra header actions, rendered at the right after the nav. */
  actions?: ReactNode;
}

export function SiteHeader({ shopName, status, onBack, actions }: SiteHeaderProps) {
  const name = shopName ?? 'Printelyx';
  return (
    <header className="bg-[var(--surface)] border-b border-[var(--hairline)]">
      <div className="mx-auto flex min-h-[56px] w-full max-w-[1120px] items-center justify-between gap-4 px-4 lg:px-8">
        {/* Left: back chevron (optional) + green dot + name */}
        <div className="flex min-w-0 items-center gap-1">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Go back"
              className="touch-target -ml-2 flex shrink-0 items-center justify-center text-[var(--label)]"
            >
              <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2 py-2"
            aria-label={shopName ? `${shopName} — home` : 'Printelyx — home'}
          >
            <span
              className="inline-block size-2 shrink-0 rounded-full bg-[var(--success)]"
              aria-hidden="true"
            />
            <span className="truncate text-[17px] font-semibold text-[var(--label)]">
              {name}
              {status ? (
                <span className="font-normal text-[var(--label-2)]">
                  {status === 'open' ? ', open' : ', closed'}
                </span>
              ) : null}
            </span>
          </Link>
        </div>

        {/* Right: Help always; Track order + Pricing on desktop; actions */}
        <div className="flex shrink-0 items-center gap-1">
          <nav className="flex shrink-0 items-center gap-1" aria-label="Site">
            <Link
              href="/track"
              className="hidden min-h-[48px] items-center px-3 text-[15px] font-medium text-[var(--label-2)] transition-colors hover:text-[var(--label)] md:inline-flex"
            >
              Track order
            </Link>
            <Link
              href="/pricing"
              className="hidden min-h-[48px] items-center px-3 text-[15px] font-medium text-[var(--label-2)] transition-colors hover:text-[var(--label)] md:inline-flex"
            >
              Pricing
            </Link>
            <Link
              href="/help"
              className="inline-flex min-h-[48px] items-center px-3 text-[15px] font-medium text-[var(--label-2)] transition-colors hover:text-[var(--label)]"
            >
              Help
            </Link>
          </nav>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      </div>
    </header>
  );
}

export default SiteHeader;
