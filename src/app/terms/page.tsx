import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoShell } from '../about/page';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The plain-language terms of using Printelyx: what the service does, how payments and files are handled, and your responsibilities.',
  alternates: { canonical: '/terms' },
};

/**
 * /terms — plain-language summary of the service terms, in short numbered
 * sections. This page is a PRODUCT surface: keep it short, specific and
 * honest. It is NOT a substitute for a lawyer-reviewed agreement.
 * File-deletion wording kept as-is (24 hours after pickup, 7 days max).
 */
const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'What Printelyx is',
    body: 'Printelyx is a marketplace that lets you send print orders to a participating shop and track them. We provide the ordering and tracking software. We are not a party to the contract between you and the shop — the shop prints your order, sets its rates, and confirms your payment.',
  },
  {
    title: 'Payments',
    body: 'You pay the shop directly by UPI to the shop\u2019s own UPI ID. Printelyx does not process, hold or refund payments. If you entered a wrong UTR, you can correct it on the tracking page; if you paid and the order is wrong, take it up with the shop first — then report it to us via the Contact page.',
  },
  {
    title: 'Your files',
    body: 'Upload only files you have the right to print. Do not upload content that is illegal, infringing, or that you do not have permission to reproduce. Files are used only to fulfil your order and are deleted 24 hours after pickup, or after 7 days if uncollected.',
  },
  {
    title: 'Liability',
    body: 'Printelyx provides the service as-is and connects you to independent shops. Print quality, turnaround and pricing disputes are between you and the shop. To the extent permitted by law, Printelyx is not liable for the shop\u2019s acts, for indirect or consequential losses, or for lost data beyond the retention described on the Privacy page.',
  },
  {
    title: 'Changes',
    body: 'We may update these terms as the product evolves; the review date above changes when we do. Continued use of the service means you accept the current version.',
  },
];

export default function TermsPage() {
  return (
    <InfoShell>
      <h1 className="text-[28px] font-bold tracking-[-0.01em] text-[var(--label)]">Terms of use</h1>
      <p className="mt-2 text-[15px] leading-[1.6] text-[var(--label-2)]">
        Plain-language summary, kept current in code. Last reviewed: November 2026.
      </p>

      <ol className="mt-6 space-y-6">
        {SECTIONS.map((section, i) => (
          <li key={section.title}>
            <h2 className="text-[18px] font-semibold text-[var(--label)]">
              {i + 1}. {section.title}
            </h2>
            <p className="mt-2 text-[16px] leading-[1.6] text-[var(--label-2)]">{section.body}</p>
          </li>
        ))}
      </ol>

      <p className="mt-10 text-[15px] leading-[1.6] text-[var(--label-2)]">
        Questions? See the <Link href="/contact" className="text-[var(--accent)] underline">Contact</Link> page,
        or read the <Link href="/privacy" className="text-[var(--accent)] underline">Privacy</Link> and{' '}
        <Link href="/refund-policy" className="text-[var(--accent)] underline">Refund policy</Link> pages.
      </p>
    </InfoShell>
  );
}
