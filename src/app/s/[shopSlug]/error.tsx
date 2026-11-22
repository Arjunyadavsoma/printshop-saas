'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { AppBar } from '@/components/customer/app-bar';
import { ErrorState } from '@/components/customer/error-state';

/**
 * /s/[shopSlug]/error — boundary for the server-rendered shop landing.
 *
 * Renders when the server component throws (DB unreachable, slug lookup
 * failed). The retry button calls `reset()` — Next.js re-runs the server
 * component.
 */
export default function ShopError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  // Surface the error message in dev for debugging; the user-facing message
  // stays generic.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[shop error boundary]', error);
    }
  }, [error]);

  return (
    <div className="customer-flow">
      <AppBar title="Shop" onBack={() => router.push('/')} />
      <main className="mx-auto max-w-xl">
        <ErrorState
          message="We couldn't load this shop."
          fix="Check your connection and try again. If the link is from a QR code, scan it again — the shop may have moved."
          onRetry={() => reset()}
        />
      </main>
    </div>
  );
}
