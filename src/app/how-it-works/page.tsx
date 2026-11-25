import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoShell } from '@/components/clear/info-shell';

export const metadata: Metadata = {
  title: 'How it works',
  description: 'Find a shop, upload files, choose print options, pay by UPI, and collect your prints with a pickup code.',
  alternates: { canonical: '/how-it-works' },
};

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Find a shop',
    body: 'Scan the shop QR code or search for a nearby print shop.',
  },
  {
    title: 'Upload files',
    body: 'Add PDFs, photos, or Word documents. We count the pages and calculate the exact price.',
  },
  {
    title: 'Choose print options',
    body: 'Pick B&W or colour, single or double-sided, paper size, and copies. Mark specific pages as colour if you want.',
  },
  {
    title: 'Pay by UPI',
    body: 'Pay the shop directly using GPay, PhonePe, Paytm, or BHIM. Zero commission — no extra fees.',
  },
  {
    title: 'Collect your prints',
    body: 'Track your order live. When it is ready, show your pickup code at the counter.',
  },
];

export default function HowItWorksPage() {
  return (
    <InfoShell>
      <h1 className="type-page">How it works</h1>
      <ol className="mt-6 space-y-6">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-[15px] font-bold text-white"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <div>
              <h2 className="type-section">{step.title}</h2>
              <p className="mt-1 type-body">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-10 text-[15px] leading-[1.6] text-[var(--label-2)]">
        <Link href="/" className="text-[var(--accent)] underline">Find a shop</Link> to start, check{' '}
        <Link href="/pricing" className="text-[var(--accent)] underline">typical prices</Link>, or{' '}
        <Link href="/track" className="text-[var(--accent)] underline">track an order</Link> you already placed.
      </p>
    </InfoShell>
  );
}
