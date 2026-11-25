'use client';

import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/clear/site-header';
import { SiteFooter } from '@/components/clear/site-footer';
import { ConsumerTabBar } from '@/components/clear/consumer-tab-bar';

/**
 * ConsumerPage — the single shared shell for every consumer-facing page.
 *
 * SiteHeader (+ optional back button / actions) → centred content column
 * → SiteFooter → ConsumerTabBar (mobile). This replaces the old
 * `.x .m` / `.x .d` dual-canvas pattern, where every page rendered its own
 * mobile + desktop markup with its own top bar.
 *
 * Column: 640px by default (single-column flow pages: track, scan, orders,
 * profile, order tracking). `wide` gives the 1120px container for pages
 * with a desktop two-column layout (homepage, shop landing).
 *
 * The footer is rendered on mobile too, matching InfoShell / find-a-shop —
 * the tab bar floats above it (the footer carries bottom padding for it).
 */

export interface ConsumerPageProps {
  /** Shop display name on shop pages. Omit on platform pages → "Printelyx". */
  shopName?: string;
  /** Open/closed status, shown after the shop name. */
  status?: 'open' | 'closed';
  /** Back action — renders a back chevron before the logo (e.g. order tracking). */
  onBack?: () => void;
  /** Extra header actions, rendered at the right (e.g. the status pill). */
  actions?: ReactNode;
  /** Wide 1120px container instead of the 640px single column. */
  wide?: boolean;
  children: ReactNode;
}

export function ConsumerPage({
  shopName,
  status,
  onBack,
  actions,
  wide = false,
  children,
}: ConsumerPageProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--ground)] text-[var(--label)]">
      <SiteHeader shopName={shopName} status={status} onBack={onBack} actions={actions} />
      <main
        className={
          wide
            ? 'mx-auto w-full max-w-[1120px] flex-1 px-4 py-6 pb-[calc(88px+env(safe-area-inset-bottom))] lg:px-8'
            : 'mx-auto w-full max-w-[640px] flex-1 px-5 py-6 pb-[calc(88px+env(safe-area-inset-bottom))]'
        }
      >
        {children}
      </main>
      <SiteFooter />
      <ConsumerTabBar />
    </div>
  );
}

/**
 * LiveDot — the halo live-status dot: a green dot with a soft ping ring.
 * The pulsing motif from the sign-in screen; `prefers-reduced-motion`
 * disables the ping via the global reduced-motion rule.
 */
export function LiveDot({ className = '' }: { className?: string }) {
  return (
    <span className={`relative flex size-2 ${className}`} aria-hidden="true">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--halo-live)] opacity-60" />
      <span className="relative inline-flex size-2 rounded-full bg-[var(--halo-live)]" />
    </span>
  );
}

export default ConsumerPage;
