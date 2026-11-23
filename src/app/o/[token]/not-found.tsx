import Link from 'next/link';
import { Receipt } from 'lucide-react';

import { AppBar } from '@/components/clear/app-bar';

/**
 * /o/[token]/not-found — the dedicated "Order not found" panel.
 *
 * Next.js renders this when the URL matches `/o/[token]` but the token is
 * missing entirely (e.g. someone types `/o/` with no token). When the token
 * is present but doesn't resolve on the server, the client component shows
 * the same message via its own `notFound` state (see `useTrackPoll`).
 */
export default function OrderNotFound() {
  return (
    <div className="customer-flow">
      <AppBar title="Order not found" />
      <main className="mx-auto max-w-xl px-6 py-12">
        <div
          className="flex flex-col items-center justify-center text-center"
          role="alert"
        >
          <div
            className="flex size-14 items-center justify-center rounded-full bg-[rgb(179_38_30_/_0.12)] text-[var(--color-error)]"
            aria-hidden="true"
          >
            <Receipt className="size-7" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-[var(--color-ink)]">
            Order not found
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted)] max-w-xs">
            Check your link — the order token in the URL may be incomplete or expired. Open the link from your receipt, or see your recent orders on this device.
          </p>
          <div className="mt-5 flex flex-col items-center gap-2 w-full max-w-xs">
            <Link
              href="/orders"
              className="touch-target inline-flex w-full items-center justify-center rounded-[var(--radius-default)] bg-[var(--color-cyan-ink)] px-6 py-3 text-sm font-medium text-white min-h-[48px]"
            >
              See my orders
            </Link>
            <Link
              href="/"
              className="touch-target inline-flex w-full items-center justify-center rounded-[var(--radius-default)] border border-[var(--color-border-ink)] bg-[var(--color-surface)] px-6 py-3 text-sm font-medium text-[var(--color-ink)] min-h-[48px]"
            >
              Go home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
