'use client';

import { type ReactNode } from 'react';
import { AppBar } from './app-bar';
import { PriceBar } from './price-bar';
import { ConsumerTabBar, CONSUMER_TAB_BAR_OFFSET } from './consumer-tab-bar';
import { DesktopTopNav } from './desktop-top-nav';
import { type ReactNode as RN } from 'react';

/**
 * CustomerShell — the layout wrapper for customer-facing pages.
 *
 * Mobile (< 1024px): AppBar (shop name + open/closed + help) + single column
 *   with sticky frosted bottom PriceBar + persistent ConsumerTabBar
 *   (Home · Near Me · Scan QR · Orders · Profile) on every consumer screen.
 * Desktop (≥ 1024px): DesktopTopNav (Find Shops, Scan QR Code, Track Order,
 *   How It Works, Detect Location, Register, Shopkeeper login, My Orders)
 *   + two-pane layout (left content, right sticky sidebar), content max 1120px.
 *
 * No hamburger. One primary action per screen.
 */

interface CustomerShellProps {
  /** Shop name for the AppBar */
  shopName: string;
  /** Open/closed status */
  status?: 'open' | 'closed';
  /** Subtitle for the AppBar (rate board, status line) */
  subtitle?: ReactNode;
  /** Main content (mobile: full width; desktop: left pane) */
  children: ReactNode;
  /** Desktop-only right sidebar (options, price, CTA) */
  sidebar?: ReactNode;
  /** PriceBar props (caption, total, action button) */
  priceBar?: { caption?: string; total: RN; action: RN };
  /** Back button handler */
  onBack?: () => void;
}

export function CustomerShell({ shopName, status, subtitle, children, sidebar, priceBar, onBack }: CustomerShellProps) {
  return (
    <div className="min-h-[100dvh] bg-[var(--ground)]">
      {/* Desktop top navigation (≥1024px). Flow pages keep the compact
          AppBar with their back button instead. */}
      {!onBack && <DesktopTopNav />}

      {/* AppBar — mobile-only on destination pages; flow pages (onBack)
          keep it on every viewport. */}
      <div className={onBack ? '' : 'lg:hidden'}>
        <AppBar title={shopName} subtitle={subtitle} status={status} onBack={onBack} />
      </div>

      {/* Content — bottom padding clears the persistent tab bar (mobile). */}
      {sidebar ? (
        // Desktop two-pane layout (right summary sidebar); single column
        // capped at 640px below the lg breakpoint.
        <div className="mx-auto w-full max-w-[640px] lg:max-w-[1120px] px-4 lg:px-8 py-6 lg:pb-10">
          <div className="flex flex-col lg:flex-row gap-6 pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-10">
            <div className="flex-1 min-w-0">{children}</div>
            <div className="lg:w-[360px] lg:sticky lg:top-[80px] lg:self-start">{sidebar}</div>
          </div>
        </div>
      ) : (
        // Mobile single column
        <div className="mx-auto max-w-[640px] px-5 py-6 pb-[calc(88px+env(safe-area-inset-bottom))]">{children}</div>
      )}

      {/* Sticky frosted PriceBar. With a sidebar the desktop CTA lives in
          the sidebar, so the bar is mobile-only then (lg:hidden); without
          a sidebar it is the CTA on every viewport. Offset above the
          persistent consumer tab bar (mobile). */}
      {priceBar && (
        <div
          className={sidebar ? 'sticky z-10 lg:hidden' : 'sticky z-10'}
          style={{ bottom: `calc(${CONSUMER_TAB_BAR_OFFSET}px + env(safe-area-inset-bottom))` }}
        >
          <PriceBar caption={priceBar.caption} total={priceBar.total} action={priceBar.action} />
        </div>
      )}

      {/* Persistent bottom navigation — every consumer screen (mobile). */}
      <ConsumerTabBar />
    </div>
  );
}
