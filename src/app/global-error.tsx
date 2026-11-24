'use client';

import { useEffect } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Global error boundary — catches errors thrown OUTSIDE the root layout
 * (the last line of defence; route-segment errors hit error.tsx first).
 * Renders its own minimal shell because the layout itself may have failed.
 * Reference code = the digest, so a user report maps to server logs.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest in the console for support conversations.
    console.error('global-error digest:', error?.digest ?? 'n/a');
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#F2F3F7', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: '0 16px' }}>
          <div style={{ maxWidth: 420, textAlign: 'center' }}>
            <AlertCircle style={{ width: 40, height: 40, color: '#B3261E', margin: '0 auto' }} aria-hidden="true" />
            <h1 style={{ fontSize: 20, fontWeight: 600, color: '#1C1C1E', margin: '16px 0 8px' }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: 14, color: '#5B5F66', margin: 0 }}>
              Printelyx hit an unexpected error. Try again — if it keeps happening, report the reference below via the Contact page.
            </p>
            {error?.digest ? (
              <p style={{ fontSize: 12, color: '#5B5F66', margin: '12px 0 0' }}>
                Reference: <code>{error.digest}</code>
              </p>
            ) : null}
            <button
              onClick={reset}
              style={{
                marginTop: 20,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                minHeight: 48,
                padding: '0 20px',
                borderRadius: 12,
                border: '1px solid #DADBE1',
                background: '#fff',
                color: '#1C1C1E',
                fontSize: 15,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <RefreshCw style={{ width: 16, height: 16 }} aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
