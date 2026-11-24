import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Printelyx charges nothing extra. Each shop sets its own per-page rates — you always see the price before you pay.',
  alternates: { canonical: '/pricing' },
};

/** /pricing — how pricing works (rates are the shop's own). */
export default function PricingPage() {
  return (
    <div className="min-h-[100dvh] bg-[var(--ground)]">
      <main className="max-w-2xl mx-auto px-5 py-12">
        <h1 className="text-[24px] font-bold text-[var(--label)] tracking-[-0.01em]">Pricing</h1>
        <p className="mt-4 text-[16px] text-[var(--label-2)] leading-[1.6]">
          Printelyx adds nothing to your print cost. Every shop sets its own rates, and you see
          them before you pay — on the shop&apos;s card on the home page, and again as a line-by-line
          total on the review screen of your order.
        </p>

        <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">What shops typically charge</h2>
        <p className="mt-2 text-[16px] text-[var(--label-2)] leading-[1.6]">
          Rates differ from shop to shop. A shop card shows its current price per page for black
          and white and for colour, plus any minimum order value. Double-sided printing, copies,
          paper size and binding — all of that is priced on the review screen before payment, so
          the total you approve is the total you pay.
        </p>

        <h2 className="mt-8 text-[18px] font-semibold text-[var(--label)]">How payment works</h2>
        <p className="mt-2 text-[16px] text-[var(--label-2)] leading-[1.6]">
          You pay the shop directly by UPI, using the shop&apos;s own UPI ID. Printelyx never handles
          your money and charges 0% commission. The shop confirms your payment by matching the
          UTR number from your UPI receipt before printing starts.
        </p>

        <p className="mt-10 text-[14px] text-[var(--label-2)]">
          Something look wrong on a shop&apos;s rates? The shop can change them any time from its
          dashboard — or <Link href="/contact" className="text-[var(--accent)] underline">tell us</Link> and we&apos;ll pass it on.
        </p>
      </main>
    </div>
  );
}
