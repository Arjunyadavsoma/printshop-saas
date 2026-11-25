import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoShell } from '@/components/clear/info-shell';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Printelyx charges nothing extra. Each shop sets its own per-page rates — you always see the price before you pay.',
  alternates: { canonical: '/pricing' },
};

/**
 * /pricing — a REAL price table built from the live pricing engine's
 * defaults (packages/core/src/domain/shop.ts — createDefaultPricingConfig),
 * NOT the design-PDF numbers. See the discrepancy note below the table.
 *
 * Engine defaults: B&W A4 ₹2, Colour A4 ₹6, B&W A3 ₹4, Colour A3 ₹12,
 * duplex = 10% off, bulk = 5% off at 100+ pages, minimum order ₹5.
 * The engine has no A5 size (a4/a3/letter/legal only); other sizes fall
 * back to the A4 rate.
 */
const ROWS: { type: string; a4: string; a3: string }[] = [
  { type: 'Black & white, one side', a4: '₹2', a3: '₹4' },
  { type: 'Colour, one side', a4: '₹6', a3: '₹12' },
  { type: 'Black & white, both sides', a4: '₹1.80', a3: '₹3.60' },
  { type: 'Colour, both sides', a4: '₹5.40', a3: '₹10.80' },
];

export default function PricingPage() {
  return (
    <InfoShell>
      <h1 className="type-page">Pricing</h1>
      <p className="mt-2 type-body">
        Printelyx adds nothing to your print cost. Every shop sets its own rates, and you see
        them before you pay — on the shop&apos;s page, and again as a line-by-line total on the
        review screen of your order.
      </p>

      <h2 className="mt-8 type-section">Typical rates per page</h2>
      <p className="mt-2 type-body">
        These are the platform&apos;s default rates. Prices are set by each shop; your shop&apos;s
        exact prices are shown on its page.
      </p>

      <div className="mt-4 overflow-hidden rounded-[14px] bg-[var(--surface)]">
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b border-border text-[var(--label-2)]">
              <th scope="col" className="px-4 py-3 font-medium">Print type</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">A4</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">A3</th>
            </tr>
          </thead>
          <tbody className="text-[var(--label)]">
            {ROWS.map((row, i) => (
              <tr key={row.type} className={i < ROWS.length - 1 ? 'border-b border-border' : ''}>
                <th scope="row" className="px-4 py-3 font-normal">{row.type}</th>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{row.a4}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{row.a3}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 type-section">Discounts</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[16px] leading-[1.6] text-[var(--label-2)]">
        <li>
          <span className="font-medium text-[var(--label)]">Double-sided: 10% off</span> the
          per-page rate — that is where the both-sides prices above come from.
        </li>
        <li>
          <span className="font-medium text-[var(--label)]">Bulk: 5% off</span> the order once
          it reaches 100 pages.
        </li>
        <li>
          <span className="font-medium text-[var(--label)]">Minimum order: ₹5.</span> Very
          small orders are rounded up to ₹5.
        </li>
      </ul>

      <h2 className="mt-8 type-section">Worked example</h2>
      <p className="mt-2 type-body">
        9 black &amp; white pages and 3 colour pages, A4, one side: 9 × ₹2 + 3 × ₹6 ={' '}
        <span className="font-semibold text-[var(--label)]">₹36</span>. The same file printed
        double-sided costs 10% less.
      </p>

      <h2 className="mt-8 type-section">How payment works</h2>
      <p className="mt-2 type-body">
        You pay the shop directly by UPI, using the shop&apos;s own UPI ID. Printelyx never handles
        your money and charges 0% commission. The shop confirms your payment by matching the
        UTR number from your UPI receipt before printing starts.
      </p>

      <p className="mt-10 text-[15px] leading-[1.6] text-[var(--label-2)]">
        Something look wrong on a shop&apos;s rates? The shop can change them any time from its
        dashboard — or <Link href="/contact" className="text-[var(--accent)] underline">contact us</Link> and
        we&apos;ll pass it on.
      </p>
    </InfoShell>
  );
}
