import Link from 'next/link';

/**
 * SiteFooter — the one footer used by all public pages.
 *
 * Links EVERY public route (previously most of these were reachable only
 * via the sitemap — no header, footer or page linked them):
 *   /  /pricing  /track  /about  /contact  /help  /terms  /privacy
 *   /refund-policy  /how-it-works  /download-app  /shop/login  /shop/register
 *
 * Light Clear only — white surface, hairline top border, near-black text.
 * Centred in the same 1120px container as the site header and the
 * CustomerShell desktop content.
 *
 * This is chrome, not a shell: public routes render it below their page
 * content. It is deliberately NOT rendered by the root layout — the
 * shopkeeper portal (`/shop/*`) and admin have their own shells and must
 * not get the public footer.
 */

const LINK_GROUPS: { heading: string; links: { href: string; label: string }[] }[] = [
  {
    heading: 'Print',
    links: [
      { href: '/', label: 'Find a shop' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/how-it-works', label: 'How it works' },
      { href: '/track', label: 'Track order' },
      { href: '/download-app', label: 'Download app' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
      { href: '/help', label: 'Help' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/refund-policy', label: 'Refund policy' },
    ],
  },
  {
    heading: 'For shops',
    links: [
      { href: '/shop/login', label: 'Shop login' },
      { href: '/shop/register', label: 'Register your shop' },
    ],
  },
];

export interface SiteFooterProps {
  /** Optional extra classes on the <footer> element. */
  className?: string;
}

export function SiteFooter({ className = '' }: SiteFooterProps) {
  return (
    <footer
      className={[
        'mt-auto bg-[var(--surface)] border-t border-[var(--hairline)]',
        className,
      ]
        .join(' ')
        .trim()}
    >
      <div className="mx-auto w-full max-w-[1120px] px-4 py-10 lg:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          {/* Brand */}
          <div className="max-w-[280px]">
            <p className="flex items-center gap-2 text-[17px] font-semibold text-[var(--label)]">
              <span
                className="inline-block size-2 shrink-0 rounded-full bg-[var(--success)]"
                aria-hidden="true"
              />
              Printelyx
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--label-2)]">
              Print without the queue. You pay the shop directly by UPI — 0%
              commission, no extra fees.
            </p>
          </div>

          {/* Link groups — every public route */}
          <nav
            className="grid grid-cols-2 gap-8 sm:grid-cols-4"
            aria-label="Site footer"
          >
            {LINK_GROUPS.map((group) => (
              <div key={group.heading}>
                <p className="text-[13px] font-semibold text-[var(--label)]">
                  {group.heading}
                </p>
                <ul className="mt-3 space-y-2">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="inline-flex min-h-[24px] items-center text-[14px] text-[var(--label-2)] transition-colors hover:text-[var(--label)]"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <p className="mt-10 border-t border-[var(--hairline)] pt-4 text-[13px] text-[var(--label-3)]">
          © 2026 Printelyx · Your files are deleted 24 hours after pickup.
        </p>
      </div>
    </footer>
  );
}

export default SiteFooter;
