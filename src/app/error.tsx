'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Route-segment error boundary (Next 500 for client/server errors inside a
 * layout). Shows a short reference code so a user report can be matched to
 * the server log digest (audit Phase-4 requirement).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertCircle className="size-10 text-danger" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">Something went wrong</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            An unexpected error occurred. Please try again.
          </p>
          {error?.digest ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Reference: <code className="font-mono">{error.digest}</code>
            </p>
          ) : null}
        </div>
        <Button onClick={reset} variant="outline" className="h-11 gap-2">
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  );
}
