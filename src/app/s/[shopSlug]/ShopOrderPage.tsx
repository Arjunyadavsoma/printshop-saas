'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Printer } from 'lucide-react';
import { CustomerShell } from '@/components/clear/customer-shell';
import { CustomerOrderFlowV2Lazy } from './CustomerOrderFlowV2Lazy';

export interface ShopOrderPageProps {
  shopSlug: string;
  shopName: string;
  upiId: string;
  upiPayeeName: string;
  paymentMode: string;
  retentionHours: number;
  /** Pre-formatted display strings, e.g. "₹2" / "₹10" — from the shop's
      real pricing config (price rules, else pricingConfig). */
  bwPrice: string;
  colorPrice: string;
  /** Double-sided B&W per-page display string (e.g. "₹1.5"), or null when
      the shop has no double-sided rate configured — the row then keeps the
      "Costs less per page" copy instead of showing no price at all. */
  doubleBwPrice: string | null;
  /** Per-page paise behind the display strings (null when the shop has
      no pricing configured at all — the display strings then fall back
      to the spec rates ₹2 / ₹10). */
  bwPerPagePaise: number | null;
  colorPerPagePaise: number | null;
  /** True when the display prices came from the shop's own config; false
      when they are the spec fallback rates. */
  pricesFromConfig: boolean;
  hours: string;
  waitMinutes: number;
  printerCount: number;
  shopPhone: string;
  shopAddress: string;
  closed: boolean;
}

/**
 * /s/[shopSlug] — shop home + order flow (Consumer Flow Revamp board 2).
 *
 * Landing: .rv hero (Print without the queue + status), .rv price card
 * (B&W / Colour / Double-sided rows), .rv shop-info card (hours, call,
 * directions). Tapping "Add files" mounts CustomerOrderFlowV2 step 0 in
 * the same tick — visible upload UI before any network call.
 *
 * The sidebar prop carries the same .rv cards for the desktop two-pane
 * layout (CustomerShell positions it automatically).
 */
export function ShopOrderPage(props: ShopOrderPageProps) {
  const {
    shopSlug, shopName, upiId, upiPayeeName, paymentMode, retentionHours,
    bwPrice, colorPrice, doubleBwPrice, bwPerPagePaise, colorPerPagePaise, pricesFromConfig,
    hours, waitMinutes, printerCount, shopPhone, shopAddress, closed,
  } = props;
  const [started, setStarted] = useState(false);

  const statusLine = `${printerCount} ${printerCount === 1 ? 'printer' : 'printers'} online, about ${waitMinutes} min wait`;
  const directionsUrl = shopAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shopAddress)}`
    : undefined;

  /* ── Price card (.rv-card with .rv-row rows) ── */
  const priceCard = (
    <div className="rv-card" aria-label="Prices">
      <div className="rv-row">
        <span className="text-[15px] text-[var(--rv-ink)]">
          Black &amp; white <span className="text-[12px] text-[var(--rv-muted)]">per page</span>
        </span>
        <b className="text-[18px] font-extrabold text-[var(--rv-ink)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{bwPrice}</b>
      </div>
      <div className="rv-row">
        <span className="text-[15px] text-[var(--rv-ink)]">
          Colour <span className="text-[12px] text-[var(--rv-muted)]">per page</span>
        </span>
        <b className="text-[18px] font-extrabold text-[var(--rv-ink)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{colorPrice}</b>
      </div>
      <div className="rv-row">
        <span className="text-[15px] text-[var(--rv-ink)]">Double-sided</span>
        {doubleBwPrice != null ? (
          <b className="text-[18px] font-extrabold text-[var(--rv-ink)]" style={{ fontVariantNumeric: 'tabular-nums' }}>{doubleBwPrice}</b>
        ) : (
          <span className="text-[13px] text-[var(--rv-muted)]">Costs less per page</span>
        )}
      </div>
      {!pricesFromConfig && (
        <p className="pt-2 text-[12px] text-[var(--rv-muted)]">Standard rates — this shop hasn&apos;t set its own prices yet.</p>
      )}
    </div>
  );

  /* ── Shop info card ── */
  const shopInfoCard = (
    <div className="rv-card" aria-label="Shop information">
      <div className="rv-row">
        <span className="text-[15px] text-[var(--rv-ink)]">Open today</span>
        <span className="whitespace-nowrap text-[14px] text-[var(--rv-muted)]">{hours}</span>
      </div>
      {shopPhone ? (
        <a href={`tel:${shopPhone}`} className="rv-row no-underline">
          <span className="text-[15px] font-bold text-[var(--rv-accent)]">Call shop</span>
          <span aria-hidden="true" className="text-[var(--rv-muted)]">›</span>
        </a>
      ) : null}
      {directionsUrl ? (
        <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="rv-row no-underline">
          <span className="text-[15px] font-bold text-[var(--rv-accent)]">Directions</span>
          <span aria-hidden="true" className="text-[var(--rv-muted)]">›</span>
        </a>
      ) : null}
      {shopAddress && (
        <p className="pt-2 text-[13px] leading-snug text-[var(--rv-muted)]">{shopAddress}</p>
      )}
    </div>
  );

  const sidebar = (
    <div className="hidden lg:flex flex-col gap-4">
      {priceCard}
      {shopInfoCard}
      <p className="px-1 text-[13px] leading-relaxed text-[var(--rv-muted)]">
        Your files are deleted {retentionHours ? `${retentionHours} hours` : '24 hours'} after pickup.
      </p>
    </div>
  );

  if (closed) {
    // Closed state — no upload entry is offered.
    return (
      <CustomerShell shopName={shopName} status="closed" subtitle={hours} sidebar={sidebar}>
        <h1 className="text-[27px] font-extrabold tracking-[-0.02em] text-[var(--rv-ink)]">Closed right now</h1>
        <p className="mt-1 text-[15px] text-[var(--rv-muted)]">Opens at the next opening time.</p>
        <div className="rv-card mt-4" aria-label="Hours">
          <div className="rv-row">
            <span className="text-[15px] text-[var(--rv-ink)]">Hours</span>
            <span className="text-[14px] text-[var(--rv-muted)]">{hours}</span>
          </div>
          {shopPhone ? (
            <a href={`tel:${shopPhone}`} className="rv-row no-underline">
              <span className="text-[15px] font-bold text-[var(--rv-accent)]">Call the shop</span>
              <span aria-hidden="true" className="text-[var(--rv-muted)]">›</span>
            </a>
          ) : null}
        </div>
        <p className="mt-3 text-[13px] text-[var(--rv-muted)]">Come back when the shop opens. Nothing is uploaded until then.</p>
        <p className="mt-4 text-[14px]">
          <Link href="/" className="font-bold text-[var(--rv-accent)] underline">Find another shop</Link>
        </p>
      </CustomerShell>
    );
  }

  return (
    <CustomerShell
      shopName={shopName}
      status="open"
      subtitle={statusLine}
      sidebar={sidebar}
      onBack={started ? () => setStarted(false) : undefined}
    >
      {!started ? (
        <>
          <h1 className="text-[27px] font-extrabold tracking-[-0.02em] text-[var(--rv-ink)]">Print without the queue</h1>

          {/* Add-files hero card */}
          <section
            className="rv-card mt-4 flex flex-col items-center py-8 text-center"
            aria-labelledby="add-files-heading"
          >
            <span className="rv-ic" aria-hidden="true">
              <Printer className="size-5" />
            </span>
            <h2 id="add-files-heading" className="mt-3 text-[17px] font-extrabold text-[var(--rv-ink)]">
              Add files to print
            </h2>
            <p className="mt-1 text-[14px] text-[var(--rv-muted)]">PDF, photos or Word files · up to 50 MB each</p>
            <button type="button" className="rv-btn mt-4" onClick={() => setStarted(true)}>
              Add files
            </button>
          </section>

          {/* Mobile: prices + shop info inline (sidebar renders on desktop). */}
          <div className="mt-4 flex flex-col gap-4 lg:hidden">
            {priceCard}
            {shopInfoCard}
          </div>

          <p className="mt-4 text-[13px] text-[var(--rv-muted)] lg:hidden">
            Your files are deleted {retentionHours ? `${retentionHours} hours` : '24 hours'} after pickup.
          </p>
        </>
      ) : (
        <CustomerOrderFlowV2Lazy
          shopSlug={shopSlug}
          shopName={shopName}
          upiId={upiId}
          upiPayeeName={upiPayeeName}
          paymentMode={paymentMode}
          retentionHours={retentionHours}
          bwPerPagePaise={bwPerPagePaise}
          colorPerPagePaise={colorPerPagePaise}
        />
      )}
    </CustomerShell>
  );
}
