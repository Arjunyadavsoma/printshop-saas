'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ConsumerPage } from '@/components/clear/consumer-page';
import { PrimaryButton } from '@/components/clear/button';
import { CustomerOrderFlowV2Lazy } from './CustomerOrderFlowV2Lazy';

export interface ShopOrderPageProps {
  shopSlug: string;
  shopName: string;
  upiId: string;
  upiPayeeName: string;
  paymentMode: string;
  retentionHours: number;
  bwPrice: string;
  colorPrice: string;
  doubleBwPrice: string | null;
  bwPerPagePaise: number | null;
  colorPerPagePaise: number | null;
  pricesFromConfig: boolean;
  hours: string;
  waitMinutes: number;
  printerCount: number;
  shopPhone: string;
  shopAddress: string;
  closed: boolean;
}

const cardClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-1';
const cardPadClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] p-4';

/**
 * /s/[shopSlug] — shop landing + order flow.
 * Clear design (matches the reference "Customer: shop landing" screen):
 *   hero "Print without the queue" + status → add-files card → prices
 *   card → shop-info card → retention caption. Desktop puts prices +
 *   shop info in a 360px right rail.
 *
 * Tapping "Add files" mounts CustomerOrderFlowV2 (the multi-step upload →
 * options → pay flow). The flow keeps its own shell — it is the order
 * flow, not landing chrome.
 *
 * Shared consumer shell (ConsumerPage) — the old `.x .m` / `.x .d` dual
 * canvas is gone. Copy, pricing, and flow behaviour are unchanged.
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

  /* ── Prices card (Clear rows) ── */
  const priceCard = () => (
    <div className={cardClass}>
      <div className="r">
        <span>Black &amp; white<small>per page</small></span>
        <b className="text-base font-semibold">{bwPrice}</b>
      </div>
      <div className="r">
        <span>Colour<small>per page</small></span>
        <b className="text-base font-semibold">{colorPrice}</b>
      </div>
      <div className="r">
        <span>Double-sided</span>
        <span className="v">{doubleBwPrice != null ? doubleBwPrice : 'Costs less per page'}</span>
      </div>
      {!pricesFromConfig && (
        <p className="type-caption my-2">Standard rates — this shop hasn&apos;t set its own prices yet.</p>
      )}
    </div>
  );

  /* ── Shop info card ── */
  const shopInfoCard = () => (
    <div className={cardClass}>
      <div className="r">
        <span>Open today</span>
        <span className="v">{hours}</span>
      </div>
      <div className="r">
        <span>Contact</span>
        <span className="v flex gap-3">
          {shopPhone ? <a href={`tel:${shopPhone}`} className="text-[15px] text-[var(--accent)]">Call shop</a> : null}
          {directionsUrl ? <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="text-[15px] text-[var(--accent)]">Directions</a> : null}
        </span>
      </div>
      {shopAddress && (
        <p className="type-caption my-2">{shopAddress}</p>
      )}
    </div>
  );

  /* ── Add files card ── */
  const addFilesCard = () => (
    <div className={`${cardPadClass} px-4 py-7 text-center`}>
      <div className="text-[17px] font-semibold text-[var(--label)]">Add files to print</div>
      <div className="mt-1 mb-4 text-[15px] text-[var(--label-2)]">PDF, photos or Word files · up to 50 MB each</div>
      <PrimaryButton type="button" className="w-full" onClick={() => setStarted(true)}>
        Add files
      </PrimaryButton>
    </div>
  );

  /* ── Closed state ── */
  if (closed) {
    return (
      <ConsumerPage shopName={shopName} status="closed">
        <h1 className="type-hero">Closed right now</h1>
        <p className="type-sub mt-2">Opens at the next opening time.</p>
        <div className={`${cardClass} mt-6`}>
          <div className="r"><span>Hours</span><span className="v">{hours}</span></div>
          {shopPhone ? (
            <a href={`tel:${shopPhone}`} className="r">
              <span>Call the shop</span><span className="v">›</span>
            </a>
          ) : null}
        </div>
        <p className="mt-4 px-2 text-sm text-[var(--label-2)]">Come back when the shop opens. Nothing is uploaded until then.</p>
        <p className="mt-2 px-2 text-sm text-[var(--label-2)]"><Link href="/" className="text-[var(--accent)]">Find another shop</Link></p>
      </ConsumerPage>
    );
  }

  /* ── Order flow started — keep CustomerOrderFlowV2 but in Clear container ── */
  if (started) {
    return (
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
    );
  }

  /* ── Landing state ── */
  return (
    <ConsumerPage wide shopName={shopName} status="open">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div>
            <h1 className="type-hero">Print without the queue</h1>
            <p className="type-sub mt-2">{statusLine}</p>
          </div>
          {addFilesCard()}
          <div className="space-y-4 lg:hidden">
            {priceCard()}
            {shopInfoCard()}
          </div>
        </div>
        <aside className="hidden min-w-0 space-y-4 lg:block">
          {priceCard()}
          {shopInfoCard()}
          <p className="type-caption px-2">Your files are deleted {retentionHours ? `${retentionHours} hours` : '24 hours'} after pickup.</p>
        </aside>
      </div>
      <p className="mt-4 px-2 text-sm text-[var(--label-2)] lg:hidden">Your files are deleted {retentionHours ? `${retentionHours} hours` : '24 hours'} after pickup.</p>
    </ConsumerPage>
  );
}
