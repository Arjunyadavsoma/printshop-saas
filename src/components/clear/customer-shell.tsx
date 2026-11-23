'use client';

import { type ReactNode } from 'react';
import { AppBar } from './app-bar';
import { PriceBar } from './price-bar';
import { type ReactNode as RN } from 'react';

/**
 * CustomerShell — the layout wrapper for customer-facing pages.
 *
 * Mobile (< 900px): AppBar (shop name + open/closed + help) + single column
 *   with sticky frosted bottom PriceBar.
 * Desktop (≥ 900px): White top bar 64px + two-pane layout (left content,
 *   right sticky sidebar), content max 1120px.
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
      {/* AppBar */}
      <AppBar title={shopName} subtitle={subtitle} status={status} onBack={onBack} />

      {/* Content */}
      {sidebar ? (
        // Desktop two-pane layout
        <div className="mx-auto max-w-[1120px] px-4 lg:px-8 py-6">
          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 min-w-0">{children}</div>
            <div className="lg:w-[360px] lg:sticky lg:top-[80px] lg:self-start">{sidebar}</div>
          </div>
        </div>
      ) : (
        // Mobile single column
        <div className="mx-auto max-w-[640px] px-5 py-6">{children}</div>
      )}

      {/* Sticky frosted PriceBar (mobile only — desktop uses sidebar CTA) */}
      {priceBar && !sidebar && (
        <div className="sticky bottom-0 z-10">
          <PriceBar caption={priceBar.caption} total={priceBar.total} action={priceBar.action} />
        </div>
      )}
    </div>
  );
}
