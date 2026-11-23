'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { AppBar } from '@/components/clear/app-bar';
import { ErrorState } from '@/components/clear/error-state';

/**
 * /o/[token]/error — boundary for the tracking page.
 *
 * The tracking page is a client component that does its own error handling
 * via the `useTrackPoll` hook, so this boundary only fires when the client
 * component itself throws (a render-time bug). It's the safety net.
 *
 * P9-Security §6: the boundary surfaces the Next.js error `digest` as a
 * short reference code so the customer can quote it to support without
 * seeing (or pasting) a raw stack trace. The digest is the operator-side
 * correlation key for finding the real stack in Sentry / server logs.
 */
export default function OrderError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[order error boundary]', error);
    }
  }, [error]);

  return (
    <div className="customer-flow">
      <AppBar title="Order tracking" onBack={() => router.push('/')} />
      <main className="mx-auto max-w-xl">
        <ErrorState
          message="We couldn't load this order."
          fix="Check your connection and try again. Open the link from your receipt — the order token in the URL is what gives access."
          referenceCode={error.digest}
          onRetry={() => reset()}
        />
      </main>
    </div>
  );
}
