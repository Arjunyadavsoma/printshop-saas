import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Analytics funnel (dev only)',
  robots: { index: false, follow: false },
};

/**
 * AUDIT P1-7: /dev/funnel was publicly reachable on production. A server
 * layout gates the client page: anything that is not an explicit
 * development environment gets a 404 before any client code runs.
 */
export const dynamic = 'force-dynamic';

export default function DevFunnelLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  return children;
}
