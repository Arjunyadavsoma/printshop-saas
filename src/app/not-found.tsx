import Link from 'next/link';
import { InfoShell } from '@/components/clear/info-shell';

export const metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
};

/**
 * 404 — spec screen 17: "Page not found", "The link may be old or
 * mistyped.", link rows Find a shop / My orders / Help, plus the
 * reference code line from the spec. Never a bare 404 with no way back.
 */
export default function NotFound() {
  const rows = [
    { href: '/', label: 'Find a shop' },
    { href: '/orders', label: 'My orders' },
    { href: '/help', label: 'Help' },
  ];

  return (
    <InfoShell>
      <p className="text-sm font-semibold text-[var(--label-2)]">Printelyx</p>
      <h1 className="mt-2 text-[28px] font-bold tracking-[-0.01em] text-[var(--label)]">Page not found</h1>
      <p className="mt-2 text-[16px] leading-[1.6] text-[var(--label-2)]">
        The link may be old or mistyped.
      </p>

      <div className="mt-6 overflow-hidden rounded-[14px] bg-[var(--surface)]">
        {rows.map((row, i) => (
          <Link
            key={row.href}
            href={row.href}
            className={`flex min-h-[56px] items-center justify-between gap-3 px-4 text-[16px] font-medium text-[var(--label)] ${
              i < rows.length - 1 ? 'border-b border-border' : ''
            }`}
          >
            {row.label}
            <span className="text-[var(--label-2)]" aria-hidden="true">›</span>
          </Link>
        ))}
      </div>

      <p className="mt-6 text-[14px] leading-[1.5] text-[var(--label-2)]">
        Reference 7F3A21. Share it if you ask for help.
      </p>
    </InfoShell>
  );
}
