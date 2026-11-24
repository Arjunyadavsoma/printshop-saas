import type { Metadata } from 'next';

/**
 * /orders segment layout — the page is a client component, so its metadata
 * lives here (audit P1-5: /orders previously shipped the generic home
 * title). The device-local order list is not indexed; tokens stay private.
 */
export const metadata: Metadata = {
  title: 'My orders',
  description: 'Recent print orders placed on this device, each trackable with its receipt link.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/orders' },
};

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
