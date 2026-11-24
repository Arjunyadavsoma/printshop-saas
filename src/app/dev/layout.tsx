import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Dev tools',
  robots: { index: false, follow: false },
};

/**
 * AUDIT P1-7: /dev/ui and /dev/funnel were publicly reachable on
 * production (both returned 200). Gate the whole /dev segment here, and
 * force the pages to render per-request: a statically prerendered dev page
 * can leak its content before any runtime gate runs. Fail closed —
 * anything that is not an explicit development environment gets a 404,
 * mirroring requireDev() for API routes.
 */
export const dynamic = 'force-dynamic';

export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  return children;
}
