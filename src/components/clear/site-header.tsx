import Link from 'next/link';

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
 */

export interface SiteHeaderProps {
  /** Shop display name on shop pages. Omit on platform pages → "Printelyx". */
  shopName?: string;
  /**
   * Open/closed status, shown after the shop name as ", open" / ", closed"
   * (spec: "● Sri Sai Xerox, open"). Omit to show just the name.
   */
  status?: 'open' | 'closed';
}

export function SiteHeader({ shopName, status }: SiteHeaderProps) {
  const name = shopName ?? 'Printelyx';
  return (
    <header className="bg-[var(--surface)] border-b border-[var(--hairline)]">
      <div className="mx-auto flex min-h-[56px] w-full max-w-[1120px] items-center justify-between gap-4 px-4 lg:px-8">
        {/* Left: green dot + name */}
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

        {/* Right: Help always; Track order + Pricing on desktop */}
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
      </div>
    </header>
  );
}

export default SiteHeader;
