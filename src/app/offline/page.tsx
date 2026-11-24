import type { Metadata } from 'next';
import Link from 'next/link';
import { WifiOff } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Offline · Printelyx',
  description: 'You are offline. Reconnect to reach your print shop.',
  robots: { index: false, follow: false },
};

/**
 * /offline — reachable, human-readable destination when the network is
 * gone. Icon tile uses the theme surface token (was hardcoded bg-white,
 * which is invisible against dark-mode label text — same bug as Contact).
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-[var(--ground)]">
      <header className="border-b border-border bg-[var(--surface)]">
        <div className="mx-auto flex h-14 max-w-[1120px] items-center px-4 sm:px-6">
          <Link href="/" className="text-[17px] font-bold tracking-tight text-[var(--label)]">
            Printelyx
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1120px] flex-1 items-center justify-center px-4 py-10 sm:px-6">
        <div className="max-w-sm text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[var(--surface)] shadow-sm">
            <WifiOff className="size-7 text-[var(--label-2)]" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-[22px] font-bold text-[var(--label)]">You&apos;re offline</h1>
          <p className="mt-2 text-[15px] leading-[1.6] text-[var(--label-2)]">
            Check your connection and try again. Your order links keep working once you&apos;re back online.
          </p>
          <a
            href="/"
            className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-[var(--radius-default)] bg-[var(--accent)] px-6 text-[15px] font-medium text-white"
          >
            Try the home page
          </a>
          <p className="mt-4 text-sm text-[var(--label-2)]">
            <Link href="/help" className="text-[var(--accent)] underline">Help</Link>
            {' · '}
            <Link href="/track" className="text-[var(--accent)] underline">Track an order</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
