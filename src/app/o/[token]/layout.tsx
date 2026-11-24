import type { Metadata } from 'next';

/**
 * /o/[token] — order tracking by 128-bit token (the token IS the credential).
 * Never indexed, never shared in link previews with personal data: the
 * metadata is fully generic (no customer name, phone, or order details).
 */
export const metadata: Metadata = {
  title: 'Your order · Printelyx',
  description: 'Track your print order — status, queue position and pickup code.',
  robots: { index: false, follow: false },
  openGraph: {
    title: 'Your Printelyx order',
    description: 'Open this link to track your print order and show the pickup code at the counter.',
    images: ['/og.png'],
  },
};

export default function OrderTokenLayout({ children }: { children: React.ReactNode }) {
  return children;
}
