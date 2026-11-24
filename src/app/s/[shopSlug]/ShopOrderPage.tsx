'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CustomerShell } from '@/components/clear/customer-shell';
import { PrimaryButton } from '@/components/clear/button';
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
 * /s/[shopSlug] — shop home (spec screen 2) + order flow, inside
 * CustomerShell (max-w-[1120px] two-pane desktop / max-w-[640px] mobile).
 *
 * The landing card's "Add files" button mounts the flow immediately:
 * tapping it renders CustomerOrderFlowV2 step 0 (UploadDropzone) in the
 * same tick — the upload UI is visible before any network call, so the
 * tap always has visible feedback. The flow itself seeds file rows
 * optimistically on pick (see CustomerOrderFlowV2.onPick).
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

  const sidebar = (
    <div className="flex flex-col gap-4">
      <section
        className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4"
        aria-label="Prices"
      >
        <div className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-[var(--label)]">Black &amp; white <span className="text-[13px] text-[var(--label-2)]">per page</span></span>
          <span className="text-xl font-bold text-[var(--label)] tnum">{bwPrice}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-[var(--hairline)] py-2">
          <span className="text-sm text-[var(--label)]">Colour <span className="text-[13px] text-[var(--label-2)]">per page</span></span>
          <span className="text-xl font-bold text-[var(--label)] tnum">{colorPrice}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-[var(--hairline)] py-2">
          <span className="text-sm text-[var(--label)]">Double-sided <span className="text-[13px] text-[var(--label-2)]">per page</span></span>
          {doubleBwPrice != null ? (
            <span className="text-xl font-bold text-[var(--label)] tnum">{doubleBwPrice}</span>
          ) : (
            <span className="text-[13px] text-[var(--label-2)]">Costs less per page</span>
          )}
        </div>
        {!pricesFromConfig && (
          <p className="pt-1 text-xs text-[var(--label-2)]">Standard rates — this shop hasn&apos;t set its own prices yet.</p>
        )}
      </section>

      <section
        className="rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4"
        aria-label="Shop info"
      >
        <div className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-[var(--label)]">Open today</span>
          <span className="whitespace-nowrap text-sm text-[var(--label-2)]">{hours}</span>
        </div>
        <div className="divide-y divide-[var(--hairline)] border-t border-[var(--hairline)]">
          {shopPhone ? (
            <a href={`tel:${shopPhone}`} className="flex min-h-[48px] items-center justify-between gap-3 py-2 text-sm font-medium text-[var(--label)]">
              Call shop <span aria-hidden="true" className="text-[var(--label-3)]">›</span>
            </a>
          ) : null}
          {directionsUrl ? (
            <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-[48px] items-center justify-between gap-3 py-2 text-sm font-medium text-[var(--label)]">
              Directions <span aria-hidden="true" className="text-[var(--label-3)]">›</span>
            </a>
          ) : null}
        </div>
      </section>

      <p className="px-1 text-[13px] text-[var(--label-2)]">
        Your files are deleted {retentionHours ? `${retentionHours} hours` : '24 hours'} after pickup.
      </p>
    </div>
  );

  if (closed) {
    // Spec screen 12 — closed state. No upload entry is offered.
    return (
      <CustomerShell shopName={shopName} status="closed" subtitle={hours} sidebar={sidebar}>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--label)]">Closed right now</h1>
        <p className="mt-1 text-base text-[var(--label-2)]">Opens at the next opening time.</p>
        <section
          className="mt-5 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-4"
          aria-label="Hours"
        >
          <div className="flex items-baseline justify-between gap-3 py-1">
            <span className="text-sm text-[var(--label)]">Hours</span>
            <span className="text-sm text-[var(--label-2)]">{hours}</span>
          </div>
        </section>
        <p className="mt-3 text-[13px] text-[var(--label-2)]">Come back when the shop opens. Nothing is uploaded until then.</p>
        <p className="mt-4 text-sm">
          <Link href="/" className="font-medium text-[var(--accent)] underline">Find another shop</Link>
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
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--label)]">Print without the queue</h1>
          <p className="mt-1 text-base text-[var(--label-2)]">{statusLine}</p>
          <section
            className="mt-5 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-6 text-center"
            aria-labelledby="add-files-heading"
          >
            <h2 id="add-files-heading" className="text-lg font-semibold text-[var(--label)]">Add files to print</h2>
            <p className="mt-1 text-sm text-[var(--label-2)]">PDF, photos or Word files · up to 50 MB each</p>
            <PrimaryButton onClick={() => setStarted(true)} className="mt-4 w-full">
              Add files
            </PrimaryButton>
          </section>
          <p className="mt-3 text-[13px] text-[var(--label-2)]">Your files are deleted 24 hours after pickup.</p>
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
