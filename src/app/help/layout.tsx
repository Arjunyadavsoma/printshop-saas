import type { Metadata } from 'next';

/**
 * /help segment layout — the page is a client component ('use client') and
 * cannot export metadata itself, so the title/description/canonical live
 * here (audit P1-5: /help previously shipped the generic home title).
 */
export const metadata: Metadata = {
  title: 'Help',
  description: 'Answers to the most common Printelyx questions: paying by UPI, tracking, file privacy, cancellations.',
  alternates: { canonical: '/help' },
};

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
