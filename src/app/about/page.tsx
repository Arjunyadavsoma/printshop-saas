import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About',
  description: 'What Printelyx is: a direct line from your phone to your local print shop. 0% commission, files deleted after pickup.',
  alternates: { canonical: '/about' },
};

/** /about — what the product is, in plain words. */
export default function AboutPage() {
  return (
    <div className="min-h-[100dvh] bg-[var(--ground)]">
      <main className="max-w-2xl mx-auto px-5 py-12">
        <h1 className="text-[24px] font-bold text-[var(--label)] tracking-[-0.01em]">About Printelyx</h1>

        <p className="mt-4 text-[16px] text-[var(--label-2)] leading-[1.6]">
          Printelyx connects your phone directly to a local print shop. You scan the shop&apos;s QR
          code, upload your files, choose how they should be printed, pay the shop by UPI, and
          track the order until your prints are ready. No app to install, no queue at the counter.
        </p>

        <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">0% commission</h2>
        <p className="mt-2 text-[16px] text-[var(--label-2)] leading-[1.6]">
          Your payment goes straight to the shop&apos;s own UPI ID. Printelyx never touches your
          money, takes no cut, and stores no card details. The shop confirms your payment against
          the UTR number on your UPI receipt.
        </p>

        <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">How your files are handled</h2>
        <p className="mt-2 text-[16px] text-[var(--label-2)] leading-[1.6]">
          Uploaded files are used only to print your order. They are deleted 24 hours after pickup,
          and automatically if the order is not collected within 7 days. See the{' '}
          <Link href="/privacy" className="text-[var(--accent)] underline">Privacy</Link> page for the full policy.
        </p>

        <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">For shopkeepers</h2>
        <p className="mt-2 text-[16px] text-[var(--label-2)] leading-[1.6]">
          Shops get a QR poster, a live order queue, printer tracking, and their own pricing —
          without paying commission on their own customers. Start at{' '}
          <Link href="/shop/register" className="text-[var(--accent)] underline">shop registration</Link>.
        </p>

        <p className="mt-10 text-[14px] text-[var(--label-2)]">
          Questions? <Link href="/help" className="text-[var(--accent)] underline">Help</Link> has the answers to common ones.
        </p>
      </main>
    </div>
  );
}
