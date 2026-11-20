'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ShopError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <AlertCircle className="size-10 text-danger" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-semibold text-foreground">Couldn&apos;t load this page</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The shop portal hit an unexpected error. Your data is safe — try again.
          </p>
          {error.digest ? (
            <p className="mt-2 font-mono text-xs text-muted-foreground">ref: {error.digest}</p>
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
