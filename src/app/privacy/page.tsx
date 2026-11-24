import Link from 'next/link';

import { hasSupportEmail, supportMailto } from '@/lib/customer/support-config';
import { InfoShell } from '@/components/clear/info-shell';

/**
 * /privacy — spec screen 15 copy. The retention numbers are the product's
 * real SLA (24h after pickup, 7d max) — they mirror the cleanup cron.
 * "Last updated" is left-aligned like all other body text (diagnosis fix).
 */

/** Kept in code so the shipped page always states a real, correct date. */
const LAST_UPDATED = '24 November 2026';

export const metadata = {
  title: 'Privacy',
  description: 'What Printelyx collects, what it never collects, and exactly how long your files are kept.',
  alternates: { canonical: '/privacy' },
};

const ROWS: { title: string; body: string }[] = [
  {
    title: 'What we collect',
    body: 'Phone number (optional), your files for a short time, order details.',
  },
  {
    title: 'What we never collect',
    body: 'Card or UPI details. You pay the shop directly.',
  },
  {
    title: 'How long we keep files',
    body: '24 hours after pickup, 7 days at most. Then deleted automatically.',
  },
  {
    title: 'Who sees your data',
    body: 'Only the shop you order from. Never sold, never used for ads.',
  },
  {
    title: 'Analytics',
    body: 'Privacy-friendly counts only — no personal data, no file names, no UTRs.',
  },
];

export default function PrivacyPage() {
  return (
    <InfoShell>
      <p className="text-sm font-semibold text-[var(--label-2)]">Printelyx</p>
      <h1 className="mt-2 text-[28px] font-bold tracking-[-0.01em] text-[var(--label)]">Privacy</h1>
      {/* Left-aligned, like all other body text — never centred. */}
      <p className="mt-2 text-left text-[16px] leading-[1.6] text-[var(--label-2)]">
        Last updated {LAST_UPDATED}
      </p>

      <div className="mt-6 overflow-hidden rounded-[14px] bg-[var(--surface)]">
        {ROWS.map((row, i) => (
          <div
            key={row.title}
            className={`px-4 py-4 ${i < ROWS.length - 1 ? 'border-b border-border' : ''}`}
          >
            <p className="text-[16px] font-semibold text-[var(--label)]">{row.title}</p>
            <p className="mt-0.5 text-[15px] leading-[1.5] text-[var(--label-2)]">{row.body}</p>
          </div>
        ))}
        <div className="border-t border-border px-4 py-4">
          {hasSupportEmail() ? (
            <a
              href={supportMailto('Printelyx privacy request', 'I would like my data deleted. My order token (if known):')}
              className="flex items-center justify-between gap-3"
            >
              <span>
                <span className="block text-[16px] font-semibold text-[var(--label)]">Delete my data</span>
                <span className="mt-0.5 block text-[15px] leading-[1.5] text-[var(--label-2)]">
                  Ask the shop or email us — files purge within 24 hours.
                </span>
              </span>
              <span className="text-[var(--label-2)]" aria-hidden="true">›</span>
            </a>
          ) : (
            <div>
              <p className="text-[16px] font-semibold text-[var(--label)]">Delete my data</p>
              <p className="mt-0.5 text-[15px] leading-[1.5] text-[var(--label-2)]">
                Ask the shop you ordered from — files purge within 24 hours.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-[14px] bg-[var(--surface)]">
        <Link href="/help" className="flex min-h-[48px] items-center justify-between gap-3 border-b border-border px-4 text-[15px] font-medium text-[var(--label)]">
          Questions?
          <span className="text-[var(--label-2)]" aria-hidden="true">›</span>
        </Link>
        <Link href="/" className="flex min-h-[48px] items-center justify-between gap-3 px-4 text-[15px] font-medium text-[var(--label)]">
          Home
          <span className="text-[var(--label-2)]" aria-hidden="true">›</span>
        </Link>
      </div>
    </InfoShell>
  );
}
