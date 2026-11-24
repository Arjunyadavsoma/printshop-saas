import Link from 'next/link';
import { ShieldCheck, FileText, Share2, BarChart3, UserCheck } from 'lucide-react';

import { AppBar } from '@/components/clear/app-bar';

/**
 * /privacy — Plain-language privacy + file retention policy.
 *
 * Server-rendered (no client state). Six sections covering what we collect,
 * what we don't, file retention, data sharing, analytics, and customer
 * rights. The tone is plain English — no legalese, no headings like
 * "Information Collection Practices".
 *
 * The file-retention numbers (24h after pickup, 7d auto-delete) are the
 * product's actual retention SLA — they match the cron job at
 * `/api/v1/cron/cleanup`.
 */

/** Kept in code so the shipped page always states a real, correct date. */
const LAST_UPDATED = '24 November 2026';

/** Retention SLA — mirrors /api/v1/cron/cleanup. Rendered as a table. */
const RETENTION: Array<{ what: string; kept: string; then: string }> = [
  { what: 'Uploaded files', kept: 'Until pickup, max 7 days', then: 'Deleted automatically from storage' },
  { what: 'Normalized print PDFs', kept: 'With the order', then: 'Deleted with the order files' },
  { what: 'Order metadata (totals, status, timestamps)', kept: '90 days', then: 'Aggregated and anonymised for accounting' },
  { what: 'Payment UTR (the 12-digit reference)', kept: 'With the order', then: 'Deleted with order metadata' },
  { what: 'Analytics events (page views, order volume)', kept: 'Aggregates only', then: 'No personal data stored at all' },
];

interface Section {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
}

const SECTIONS: Section[] = [
  {
    icon: FileText,
    title: 'What we collect',
    body: 'Your phone number (optional — only if you choose to share it), your uploaded files (temporarily), and your order details (shop, file names, page counts, totals, status).',
  },
  {
    icon: ShieldCheck,
    title: "What we don't collect",
    body: 'Your payment details. You pay the shop directly via UPI — we never see your card number, UPI PIN, or the contents of your UPI app. The 12-digit UTR you submit is shared only with the shop you ordered from, so they can match it against their payment receipt.',
  },
  {
    icon: Share2,
    title: 'Data sharing',
    body: 'We do not share your data with anyone except the shop you ordered from. We do not sell your data. We do not use it for advertising. The shop sees your order, your files (until deletion), and any contact details you provided — they need this to print your order.',
  },
  {
    icon: BarChart3,
    title: 'Analytics',
    body: 'We use privacy-friendly analytics to count page visits and aggregate order volume. No personal data, no file names, and no UTR numbers are tracked. We cannot identify you from our analytics data.',
  },
  {
    icon: UserCheck,
    title: 'Your rights',
    body: 'You can request deletion of your data at any time by contacting the shop you ordered from. They will mark your order as "delete on next cleanup" and your files will be purged within 24 hours. For privacy questions, use the Contact page.',
  },
];

export const metadata = {
  title: 'Privacy',
  description: 'What Printelyx collects, what it never collects, and exactly how long your files are kept.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="customer-flow">
      <AppBar title="Privacy" subtitle="What we collect, and what we don't" />

      <main className="mx-auto max-w-xl px-4 py-6 space-y-6 safe-bottom">
        {/* Intro — short, plain English */}
        <section className="text-sm text-[var(--color-muted)] leading-relaxed">
          <p>
            Printelyx is built so that you pay the shop directly — we never
            handle your money, and your files are deleted automatically.
            This page explains what data we touch and how long we keep it.
          </p>
        </section>

        {/* The six sections, each a card with an icon + title + body */}
        <ul className="space-y-3">
          {SECTIONS.map((section, idx) => {
            const Icon = section.icon;
            return (
              <li key={idx}>
                <article
                  className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-default)] bg-[rgb(0_111_166_/_0.12)] text-[var(--color-cyan-ink)]"
                      aria-hidden="true"
                    >
                      <Icon className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h2 className="text-sm font-semibold text-[var(--color-ink)]">
                        {section.title}
                      </h2>
                      <p className="mt-1 text-sm text-[var(--color-muted)] leading-relaxed">
                        {section.body}
                      </p>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>

        {/* ── Retention table — the concrete SLA, mirroring the cleanup cron ── */}
        <section
          className="rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] p-4"
          aria-labelledby="retention-heading"
        >
          <h2 id="retention-heading" className="text-sm font-semibold text-[var(--color-ink)]">
            Exactly how long we keep things
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-muted)]">
                  <th className="py-2 pr-3 font-medium">Data</th>
                  <th className="py-2 pr-3 font-medium">Kept</th>
                  <th className="py-2 font-medium">After that</th>
                </tr>
              </thead>
              <tbody className="text-[var(--color-muted)]">
                {RETENTION.map((r) => (
                  <tr key={r.what} className="border-t border-[var(--color-border-ink)]">
                    <td className="py-2 pr-3 align-top">{r.what}</td>
                    <td className="py-2 pr-3 align-top">{r.kept}</td>
                    <td className="py-2 align-top">{r.then}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Effective date — a real date, kept in code ── */}
        <p className="text-xs text-[var(--color-muted)] text-center">
          This policy was last updated on {LAST_UPDATED}.
          If we make material changes, we will surface a banner on the home page.
        </p>

        {/* ── Footer links ── */}
        <nav className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-[var(--color-muted)] pt-2">
          <Link href="/" className="underline hover:text-[var(--color-ink)]">Home</Link>
          <Link href="/contact" className="underline hover:text-[var(--color-ink)]">Contact</Link>
          <Link href="/help" className="underline hover:text-[var(--color-ink)]">Help</Link>
        </nav>
      </main>
    </div>
  );
}
