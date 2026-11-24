import type { Metadata } from 'next';
import { WifiOff } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Offline · Printelyx',
  description: 'You are offline. Reconnect to reach your print shop.',
  robots: { index: false, follow: false },
};

/** /offline — reachable, human-readable destination when the network is gone. */
export default function OfflinePage() {
  return (
    <div className="min-h-[100dvh] bg-[var(--ground)] flex items-center justify-center px-5">
      <main className="max-w-sm text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white shadow-sm">
          <WifiOff className="size-7 text-[var(--label-2)]" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-[22px] font-bold text-[var(--label)]">You&apos;re offline</h1>
        <p className="mt-2 text-[15px] text-[var(--label-2)] leading-[1.6]">
          Check your connection and try again. Your order links keep working once you&apos;re back online.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex min-h-[48px] items-center justify-center rounded-[var(--radius-default)] bg-[var(--accent)] px-6 text-[15px] font-medium text-white"
        >
          Try the home page
        </a>
      </main>
    </div>
  );
}
