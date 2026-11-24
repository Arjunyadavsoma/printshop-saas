import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The plain-language terms of using Printelyx: what the service does, how payments and files are handled, and your responsibilities.',
  alternates: { canonical: '/terms' },
};

/**
 * /terms — plain-language summary of the service terms. This page is a
 * PRODUCT surface: keep it short, specific and honest. It is NOT a
 * substitute for a lawyer-reviewed agreement — see the audit note.
 */
export default function TermsPage() {
  return (
    <div className="min-h-[100dvh] bg-[var(--ground)]">
      <main className="max-w-2xl mx-auto px-5 py-12">
        <h1 className="text-[24px] font-bold text-[var(--label)] tracking-[-0.01em]">Terms of use</h1>
        <p className="mt-2 text-[14px] text-[var(--label-2)]">
          Plain-language summary, kept current in code. Last reviewed: November 2026.
        </p>

        <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">What Printelyx is</h2>
        <p className="mt-2 text-[16px] text-[var(--label-2)] leading-[1.6]">
          Printelyx is a marketplace that lets you send print orders to a participating shop and
          track them. We provide the ordering and tracking software. We are not a party to the
          contract between you and the shop — the shop prints your order, sets its rates, and
          confirms your payment.
        </p>

        <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">Payments</h2>
        <p className="mt-2 text-[16px] text-[var(--label-2)] leading-[1.6]">
          You pay the shop directly by UPI to the shop&apos;s own UPI ID. Printelyx does not process,
          hold or refund payments. If you entered a wrong UTR, you can correct it on the tracking
          page; if you paid and the order is wrong, take it up with the shop first — then report
          it to us via the Contact page.
        </p>

        <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">Your files</h2>
        <p className="mt-2 text-[16px] text-[var(--label-2)] leading-[1.6]">
          Upload only files you have the right to print. Do not upload content that is illegal,
          infringing, or that you do not have permission to reproduce. Files are used only to
          fulfil your order and are deleted 24 hours after pickup, or after 7 days if uncollected.
        </p>

        <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">Liability</h2>
        <p className="mt-2 text-[16px] text-[var(--label-2)] leading-[1.6]">
          Printelyx provides the service as-is and connects you to independent shops. Print
          quality, turnaround and pricing disputes are between you and the shop. To the extent
          permitted by law, Printelyx is not liable for the shop&apos;s acts, for indirect or
          consequential losses, or for lost data beyond the retention described on the Privacy page.
        </p>

        <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">Changes</h2>
        <p className="mt-2 text-[16px] text-[var(--label-2)] leading-[1.6]">
          We may update these terms as the product evolves; the review date above changes when we
          do. Continued use of the service means you accept the current version. Questions? See
          the <Link href="/contact" className="text-[var(--accent)] underline">Contact</Link> page.
        </p>
      </main>
    </div>
  );
}
