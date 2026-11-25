import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoShell } from '@/components/clear/info-shell';

export const metadata: Metadata = {
  title: 'Refund policy',
  description: 'How refunds work on Printelyx: you pay the shop directly by UPI, so the shop issues any refund.',
  alternates: { canonical: '/refund-policy' },
};

/** /refund-policy — short numbered sections. Printelyx never holds money,
 *  so refunds always come from the shop, back to the customer's UPI account. */
const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'Who holds your money',
    body: 'Payment is made directly to the print shop via UPI. Printelyx does not hold or process your money.',
  },
  {
    title: 'If prints are incorrect',
    body: 'If your prints have errors caused by the shop (wrong pages, wrong colour, missing pages), ask the shop to reprint them at no charge.',
  },
  {
    title: 'If you paid but did not receive prints',
    body: 'Contact the shop directly with your UTR number and order number. If unresolved, contact Printelyx support with the same details — see the Contact page.',
  },
  {
    title: 'Cancellation',
    body: 'You can cancel an order any time before printing starts. After printing starts, cancellation is at the shop\u2019s discretion.',
  },
  {
    title: 'Refunds',
    body: 'Refunds are issued directly by the shop to your UPI account. Printelyx facilitates the request but does not process refunds.',
  },
];

export default function RefundPolicyPage() {
  return (
    <InfoShell>
      <h1 className="type-page">Refund policy</h1>
      <ol className="mt-6 space-y-6">
        {SECTIONS.map((section, i) => (
          <li key={section.title}>
            <h2 className="type-section">
              {i + 1}. {section.title}
            </h2>
            <p className="mt-2 type-body">{section.body}</p>
          </li>
        ))}
      </ol>
      <p className="mt-10 text-[15px] leading-[1.6] text-[var(--label-2)]">
        Also see the <Link href="/terms" className="text-[var(--accent)] underline">Terms of use</Link> and{' '}
        <Link href="/help" className="text-[var(--accent)] underline">Help</Link> page.
      </p>
    </InfoShell>
  );
}
