'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { AppBar } from '@/components/customer/app-bar';
import { ErrorState } from '@/components/customer/error-state';

/**
 * /o/[token]/error — boundary for the tracking page.
 *
 * The tracking page is a client component that does its own error handling
 * via the `useTrackPoll` hook, so this boundary only fires when the client
 * component itself throws (a render-time bug). It's the safety net.
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
          onRetry={() => reset()}
        />
      </main>
    </div>
  );
}
