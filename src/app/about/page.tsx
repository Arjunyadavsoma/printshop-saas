import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoShell } from '@/components/clear/info-shell';

export const metadata: Metadata = {
  title: 'About',
  description: 'What Printelyx is: a direct line from your phone to your local print shop. 0% commission, files deleted after pickup.',
  alternates: { canonical: '/about' },
};

/**
 * /about — spec screen 13 copy: 0% commission, private files, works with
 * your shop. File-deletion wording kept as-is (24 hours after pickup).
 */
export default function AboutPage() {
  return (
    <InfoShell>
      <p className="text-sm font-semibold text-[var(--label-2)]">Printelyx</p>
      <h1 className="mt-2 text-[28px] font-bold tracking-[-0.01em] text-[var(--label)]">About</h1>
      <p className="mt-2 text-[16px] leading-[1.6] text-[var(--label-2)]">Print without the queue.</p>

      <div className="mt-6 overflow-hidden rounded-[14px] bg-[var(--surface)]">
        {[
          {
            title: '0% commission',
            body: 'You pay the shop directly by UPI. Shops keep every rupee.',
          },
          {
            title: 'Private files',
            body: 'Deleted 24 hours after pickup.',
          },
          {
            title: 'Works with your shop',
            body: 'Scan the shop\u2019s QR code to start.',
          },
        ].map((row, i, arr) => (
          <div
            key={row.title}
            className={`px-4 py-4 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}
          >
            <p className="text-[16px] font-semibold text-[var(--label)]">{row.title}</p>
            <p className="mt-0.5 text-[15px] leading-[1.5] text-[var(--label-2)]">{row.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-[14px] bg-[var(--surface)]">
        <Link href="/help" className="flex items-center justify-between gap-3 px-4 py-4">
          <span>
            <span className="block text-[16px] font-semibold text-[var(--label)]">Questions?</span>
            <span className="mt-0.5 block text-[15px] leading-[1.5] text-[var(--label-2)]">
              Visit Help, or call your shop from your order page.
            </span>
          </span>
          <span className="text-[var(--label-2)]" aria-hidden="true">›</span>
        </Link>
      </div>

      <p className="mt-6 text-[15px] leading-[1.6] text-[var(--label-2)]">
        See <Link href="/pricing" className="text-[var(--accent)] underline">typical prices</Link> or{' '}
        <Link href="/how-it-works" className="text-[var(--accent)] underline">how ordering works</Link>.
      </p>
    </InfoShell>
  );
}
