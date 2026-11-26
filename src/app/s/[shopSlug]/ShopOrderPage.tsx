'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Palette, Paperclip, Printer, ScanLine, FileText } from 'lucide-react';
import { ConsumerPage } from '@/components/clear/consumer-page';
import { PrimaryButton } from '@/components/clear/button';
import { trackShopVisit } from '@/lib/customer/recent-shops';
import { SmartPrintStudioLazy } from './SmartPrintStudioLazy';

/** One pricing-board row — the shop's real cheapest slab for a combo. */
export interface PricingBoardRow {
  colorMode: 'BW' | 'COLOR';
  sides: 'SINGLE' | 'DOUBLE';
  /** Minimum page count the rate applies from (1 = all jobs). */
  fromPages: number;
  perPagePaise: number;
}

/** Pricing board group — one paper size with its real rows. */
export interface PricingBoardGroup {
  paperSize: string;
  rows: PricingBoardRow[];
}

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
  /** Shop logo URL (nullable — letter-initial tile is the fallback). */
  logoUrl: string | null;
  /** Validated service keys from servicesJson ([] when unset). */
  services: string[];
  /** Open per the weekly-hours engine + manual flags. */
  openNow: boolean;
  /** Customer-facing status label ("Open now", "Closes at 9:00 PM"…). */
  openLabel: string;
  /** Structured price rules grouped by paper size (null → legacy card). */
  pricingBoard: PricingBoardGroup[] | null;
  /** Mon–Sun display rows from the opening-hours engine (null = skip). */
  weeklyHours: { day: string; label: string }[] | null;
  /** fullAddress when set, else the legacy address string. */
  fullAddress: string | null;
  /** Shop profile description (null when unset). */
  description: string | null;
}

const cardClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-1';
const cardPadClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] p-4';

/** servicesJson key → customer-facing label. */
const SERVICE_LABELS: Record<string, string> = {
  bw_print: 'B&W printing',
  color_print: 'Colour printing',
  a3_print: 'A3 / large format',
  scan: 'Scanning',
  laminate: 'Lamination',
  binding: 'Binding',
  photo_print: 'Photo prints',
  document_print: 'Documents',
  id_card: 'ID cards',
  passport_photo: 'Passport photos',
};

function serviceLabel(key: string): string {
  return SERVICE_LABELS[key] ?? key.replace(/_/g, ' ');
}

/** Small lucide icon per service key (print-ish default). */
function serviceIcon(key: string) {
  switch (key) {
    case 'color_print':
      return <Palette className="size-3.5" aria-hidden="true" />;
    case 'scan':
      return <ScanLine className="size-3.5" aria-hidden="true" />;
    case 'binding':
      return <Paperclip className="size-3.5" aria-hidden="true" />;
    case 'laminate':
    case 'id_card':
    case 'passport_photo':
    case 'photo_print':
      return <FileText className="size-3.5" aria-hidden="true" />;
    default: // bw_print / a3_print / document_print / unknown keys
      return <Printer className="size-3.5" aria-hidden="true" />;
  }
}

/** Paise → "₹2" / "₹1.50" (never invents a rate — formats real paise only). */
function rupeesText(paise: number): string {
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

/**
 * Shop logo with graceful fallback: remote <img> until it errors, then a
 * letter-initial tile on the accent tint (same as discovery ShopCard).
 */
function ShopLogo({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  const initial = (name.trim()[0] ?? 'P').toUpperCase();
  if (!logoUrl || failed) {
    return (
      <span
        className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-[var(--accent-tint)] text-[20px] font-semibold text-[var(--accent-tint-text)]"
        aria-hidden="true"
      >
        {initial}
      </span>
    );
  }
  return (
    <img
      src={logoUrl}
      alt=""
      width={48}
      height={48}
      onError={() => setFailed(true)}
      className="size-12 shrink-0 rounded-[14px] border border-[var(--hairline)] object-cover"
    />
  );
}

/**
 * /s/[shopSlug] — shop profile landing + order flow.
 * Clear design (matches the reference "Customer: shop landing" screen):
 *   shop header (logo, name, open-status chip, description) → add-files
 *   card → services → pricing board → shop-info card → retention caption.
 *   Desktop puts business info in a 360px right rail.
 *
 * Tapping "Start Printing" mounts SmartPrintStudio (the multi-step upload →
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
    logoUrl, services, openNow, openLabel, pricingBoard, weeklyHours,
    fullAddress, description,
  } = props;
  const [started, setStarted] = useState(false);

  // Recently-viewed tracking — fire once on mount with the server-provided
  // identity (localStorage, 30-day TTL; powers /find-a-shop "Recently viewed").
  useEffect(() => {
    trackShopVisit({ slug: shopSlug, name: shopName, image: logoUrl });
  }, []);

  const statusLine = `${printerCount} ${printerCount === 1 ? 'printer' : 'printers'} online, about ${waitMinutes} min wait`;
  const displayAddress = fullAddress || shopAddress;
  const directionsUrl = displayAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(displayAddress)}`
    : undefined;

  /* ── Shop header block (identity + live status) ── */
  const headerBlock = () => {
    const chip = openNow ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success-tint)] px-2.5 py-1 text-[12px] font-medium text-[var(--success-text)]">
        <span className="size-1.5 rounded-full bg-[var(--success)]" aria-hidden="true" />
        {openLabel}
      </span>
    ) : (
      <span className="inline-flex items-center rounded-full bg-[var(--warning-tint)] px-2.5 py-1 text-[12px] font-medium text-[var(--warning-text)]">
        Closed
      </span>
    );
    return (
      <div>
        <div className="flex items-center gap-3">
          <ShopLogo logoUrl={logoUrl} name={shopName} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="truncate text-[26px] font-bold leading-tight text-[var(--label)]">{shopName}</h1>
              {chip}
            </div>
            <p className="mt-1 text-[15px] text-[var(--label-2)]">{statusLine}</p>
          </div>
        </div>
        {description && (
          <p className="mt-3 text-[15px] leading-relaxed text-[var(--label-2)]">{description}</p>
        )}
      </div>
    );
  };

  /* ── Services section (chips wrap; only real servicesJson keys) ── */
  const servicesSection = () => (
    <section>
      <h2 className="text-[17px] font-semibold text-[var(--label)]">Services</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {services.map((key) => (
          <span
            key={key}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--label)]"
          >
            {serviceIcon(key)}
            {serviceLabel(key)}
          </span>
        ))}
      </div>
    </section>
  );

  /* ── Prices card (Clear rows) — legacy fallback from pricingConfig ── */
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

  /* ── Pricing section: real rule board, or the legacy config card ── */
  const pricingSection = () => {
    if (!pricingBoard) {
      return (
        <section>
          <h2 className="text-[17px] font-semibold text-[var(--label)]">Pricing</h2>
          <div className="mt-2">{priceCard()}</div>
        </section>
      );
    }
    return (
      <section>
        <h2 className="text-[17px] font-semibold text-[var(--label)]">Pricing</h2>
        <div className="mt-2 space-y-3">
          {pricingBoard.map((group) => (
            <div key={group.paperSize} className={cardPadClass}>
              <div className="text-[13px] font-semibold text-[var(--label-2)]">{group.paperSize} pricing</div>
              <div>
                {group.rows.map((row) => (
                  <div
                    key={`${row.colorMode}-${row.sides}`}
                    className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] py-2.5 last:border-b-0"
                  >
                    <span className="text-[15px] text-[var(--label)]">
                      {row.colorMode === 'BW' ? 'B&W' : 'Colour'} {row.sides === 'SINGLE' ? 'single' : 'double'}
                      {row.fromPages > 1 && (
                        <small className="mt-0.5 block text-[12px] text-[var(--label-2)]">
                          ₹{rupeesText(row.perPagePaise)}/page for {row.fromPages}+ pages
                        </small>
                      )}
                    </span>
                    <b className="shrink-0 text-[15px] font-semibold text-[var(--label)]">
                      from ₹{rupeesText(row.perPagePaise)}/page
                    </b>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <p className="type-caption px-2">
            Final price depends on page count and options — see exact total in the print studio.
          </p>
        </div>
      </section>
    );
  };

  /* ── Shop info card (business info) ── */
  const shopInfoCard = () => (
    <div className={cardClass}>
      <div className="r">
        <span>Hours</span>
        <span className="v">{openLabel}</span>
      </div>
      <div className="r">
        <span>Contact</span>
        <span className="v flex gap-3">
          {shopPhone ? <a href={`tel:${shopPhone}`} className="text-[15px] text-[var(--accent)]">Call shop</a> : null}
          {directionsUrl ? <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="text-[15px] text-[var(--accent)]">Directions</a> : null}
        </span>
      </div>
      {displayAddress && (
        <p className="type-caption my-2">{displayAddress}</p>
      )}
      {weeklyHours && weeklyHours.length > 0 && (
        <details className="my-2">
          <summary className="cursor-pointer list-none text-[13px] font-medium text-[var(--accent)] [&::-webkit-details-marker]:hidden">
            Weekly hours
          </summary>
          <div className="mt-2 space-y-1">
            {weeklyHours.map((d) => (
              <div key={d.day} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-[var(--label-2)]">{d.day}</span>
                <span className={d.label === 'Closed' ? 'text-[var(--label-2)]' : 'text-[var(--label)]'}>{d.label}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );

  /* ── Add files card — the Start Printing CTA ── */
  const addFilesCard = () => (
    <div className={`${cardPadClass} px-4 py-7 text-center`}>
      <div className="text-[17px] font-semibold text-[var(--label)]">Add files to print</div>
      <div className="mt-1 mb-4 text-[15px] text-[var(--label-2)]">PDF, photos or Word files · up to 50 MB each</div>
      <PrimaryButton type="button" className="w-full" onClick={() => setStarted(true)}>
        Start Printing
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

  /* ── Smart Print Studio — the premium 5-step upload → settings →
     review → payment → confirmation flow. Replaces the legacy
     CustomerOrderFlowV2 with the same backend (chunked uploads, quote,
     specs, orders, payment) behind a redesigned, desktop-responsive UI. ── */
  if (started) {
    return (
      <SmartPrintStudioLazy
        shopSlug={shopSlug}
        shopName={shopName}
        upiId={upiId}
        colorPerPagePaise={colorPerPagePaise}
        bwPerPagePaise={bwPerPagePaise}
        doubleBwPrice={doubleBwPrice}
        paymentMode={paymentMode}
        closed={closed}
      />
    );
  }

  /* ── Landing state — the shop profile ── */
  return (
    <ConsumerPage wide shopName={shopName} status="open">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          {headerBlock()}
          {addFilesCard()}
          {services.length > 0 && servicesSection()}
          {pricingSection()}
          <div className="space-y-4 lg:hidden">
            {shopInfoCard()}
          </div>
        </div>
        <aside className="hidden min-w-0 space-y-4 lg:block">
          {shopInfoCard()}
          <p className="type-caption px-2">Your files are deleted {retentionHours ? `${retentionHours} hours` : '24 hours'} after pickup.</p>
        </aside>
      </div>
      <p className="mt-4 px-2 text-sm text-[var(--label-2)] lg:hidden">Your files are deleted {retentionHours ? `${retentionHours} hours` : '24 hours'} after pickup.</p>
    </ConsumerPage>
  );
}
