import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Phone, MapPin } from 'lucide-react';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { AppBar } from '@/components/clear/app-bar';
import { CustomerOrderFlowV2Lazy } from './CustomerOrderFlowV2Lazy';

/**
 * /s/[shopSlug] — the QR landing. Server Component.
 *
 * Loads the shop from the DB, renders the new AppBar (shop name + open/closed
 * dot + rate-board subtitle), the live "printers online · wait" line, and the
 * CustomerOrderFlowV2 below. Closed shops get an explanatory card with the
 * opening hours + a Call button — the customer is never left staring at a
 * dead dropzone.
 *
 * Everything is wrapped in `<div className="customer-flow">` so the design
 * tokens (CMYK palette, Anek font, halftone textures, touch-target minimum)
 * from globals.css apply.
 */
export default async function ShopLanding({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const db = getContainer().db;
  const shop = await db.findOne<{
    id: string; name: string; slug: string; address: string; phone: string;
    isOpen: boolean; acceptingOrders: boolean; openingHours: unknown;
    upiId: string; upiPayeeName: string | null; paymentMode: string;
    paymentMethods: string; minutesPerPageBw: number; minutesPerPageColor: number;
    retentionHours: number;
  }>('shop', { slug: shopSlug });
  if (!shop) notFound();

  // Live status: printers online + queue depth → honest wait estimate.
  const printers = await repos.printers.listForShop(shop.id);
  const onlinePrinters = printers.filter(p => p.enabled && p.status === 'ONLINE');
  const queued = await repos.printJobs.findQueuedByShop(shop.id, 50);
  const queuedSheets = queued.reduce((sum, t) => sum + (t.sheetCount ?? 1) * (t.copies ?? 1), 0);
  const minPerPp = Math.max(1, Math.round(
    (shop.minutesPerPageBw + shop.minutesPerPageColor) / 2,
  ));
  const waitMinutes = Math.ceil((queuedSheets * minPerPp) / Math.max(1, onlinePrinters.length));

  // Rate board — one line, "B&W ₹2 · Colour ₹8 /page" per the DESIGN-PLAN
  // wireframe screen 1. Pulls the cheapest single-side A4 slab per colour
  // mode from the active price rules.
  const rateRows = await repos.priceRules.activeForShop(shop.id);
  const bwRule = rateRows.find(r => r.colorMode === 'BW' && r.paperSize === 'A4' && r.sides === 'SINGLE');
  const colorRule = rateRows.find(r => r.colorMode === 'COLOR' && r.paperSize === 'A4' && r.sides === 'SINGLE');
  const bwPerPagePaise = bwRule?.slabs[0]?.perPagePaise ?? null;
  const colorPerPagePaise = colorRule?.slabs[0]?.perPagePaise ?? null;

  const rateSubtitle = formatRateSubtitle(bwPerPagePaise, colorPerPagePaise);
  // Default to open/accepting when fields are missing (in-memory adapter doesn't
  // always apply Prisma @default(true) — be defensive so demo shops work).
  const shopIsOpen = shop.isOpen ?? true;
  const shopAccepting = shop.acceptingOrders ?? true;
  const closed = !shopIsOpen || !shopAccepting;
  const hoursText = formatOpeningHours(shop.openingHours);

  return (
    <div className="customer-flow min-h-dvh flex flex-col">
      <AppBar
        title={shop.name}
        subtitle={rateSubtitle}
        status={shopIsOpen ? 'open' : 'closed'}
      />

      <main className="flex-1 mx-auto w-full max-w-xl px-4 pt-4 pb-32 sm:px-6">
        {closed ? (
          <ClosedShopCard
            hoursText={hoursText}
            address={shop.address}
            phone={shop.phone}
          />
        ) : (
          <>
            {/* Live status line — "2 printers online · ~6 min wait". */}
            <p className="text-sm text-[var(--color-muted)] tnum mb-4">
              {onlinePrinters.length} printer{onlinePrinters.length === 1 ? '' : 's'} online
              {' · ~'}{waitMinutes} min wait
              {queued.length > 0 ? ` · ${queued.length} job${queued.length === 1 ? '' : 's'} ahead` : ''}
            </p>

            <CustomerOrderFlowV2Lazy
              shopSlug={shop.slug}
              shopName={shop.name}
              upiId={shop.upiId}
              upiPayeeName={shop.upiPayeeName ?? shop.name}
              paymentMode={shop.paymentMode}
              retentionHours={shop.retentionHours}
            />

            {/* Trust line — addresses the privacy concern right under the upload. */}
            <p className="mt-6 text-xs text-[var(--color-muted)] leading-relaxed">
              Files deleted {shop.retentionHours}h after pickup. 0% commission — you pay the shop directly.
            </p>

            {/* Shop info section — hours + address + Call/Directions. */}
            <section
              className="mt-6 rounded-[var(--radius-default)] bg-[var(--color-surface)] border border-[var(--color-border-ink)] p-4"
              aria-label="Shop information"
            >
              <p className="text-sm font-medium text-[var(--color-ink)]">
                Hours: {hoursText}
              </p>
              <p className="mt-1 text-sm text-[var(--color-muted)] flex items-start gap-1.5">
                <MapPin className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{shop.address}</span>
              </p>
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <a
                  href={`tel:${shop.phone}`}
                  aria-label={`Call ${shop.name}`}
                  className="touch-target inline-flex items-center justify-center gap-2 flex-1 min-h-[48px] px-4 rounded-[var(--radius-default)] bg-[var(--color-cyan-ink)] text-white font-medium text-base hover:bg-[var(--color-cyan-ink)]/90 active:bg-[var(--color-cyan-ink)]/80 shadow-[var(--shadow-bar)] transition-colors"
                >
                  <Phone className="size-4" aria-hidden="true" />
                  Call shop
                </a>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Get directions to ${shop.name}`}
                  className="touch-target inline-flex items-center justify-center gap-2 flex-1 min-h-[48px] px-4 rounded-[var(--radius-default)] bg-[var(--color-surface)] text-[var(--color-ink)] border border-[var(--color-border-ink)] font-medium text-base hover:bg-[var(--color-paper)] active:bg-[var(--color-paper)] transition-colors"
                >
                  <MapPin className="size-4" aria-hidden="true" />
                  Directions
                </a>
              </div>
            </section>

            <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
              <Link href="/" className="underline">All shops</Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Build the rate-board subtitle: "B&W ₹2 · Colour ₹8 /page" (or fallback). */
function formatRateSubtitle(bwPaise: number | null, colorPaise: number | null): string {
  const parts: string[] = [];
  if (bwPaise !== null) parts.push(`B&W ₹${(bwPaise / 100).toFixed(0)}`);
  if (colorPaise !== null) parts.push(`Colour ₹${(colorPaise / 100).toFixed(0)}`);
  if (parts.length === 0) return 'Pricing at counter';
  return `${parts.join(' · ')} /page`;
}

/** Render the opening hours JSON or fallback string as a one-line summary. */
function formatOpeningHours(hours: unknown): string {
  if (typeof hours === 'string' && hours.trim().length > 0) return hours;
  if (hours && typeof hours === 'object') {
    // Common shape: { mon: "9:00-21:00", ... } or { ranges: [...] }.
    const obj = hours as Record<string, unknown>;
    if (typeof obj.summary === 'string') return obj.summary;
    if (typeof obj.text === 'string') return obj.text;
    if (Array.isArray(obj.ranges) && obj.ranges.length > 0) {
      return obj.ranges.map((r) =>
        typeof r === 'string' ? r : `${(r as { day?: string }).day ?? ''} ${(r as { hours?: string }).hours ?? ''}`.trim(),
      ).join(', ');
    }
    const entries = Object.entries(obj).filter(([, v]) => typeof v === 'string');
    if (entries.length > 0) return entries.map(([k, v]) => `${k} ${v}`).join(', ');
  }
  return 'Mon–Sat 9:00–21:00, Sun closed';
}

/** Closed-shop card — explains + shows the hours + offers Call. */
function ClosedShopCard({ hoursText, address, phone }: { hoursText: string; address: string; phone: string }) {
  return (
    <section
      className="mt-4 rounded-[var(--radius-default)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4"
      aria-labelledby="closed-heading"
    >
      <h2 id="closed-heading" className="text-base font-semibold text-[var(--color-ink)]">
        This shop is not accepting orders right now
      </h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Hours: {hoursText}
      </p>
      <p className="mt-1 text-sm text-[var(--color-muted)]">{address}</p>
      <p className="mt-2 text-sm text-[var(--color-muted)]">
        You can still call the shop at{' '}
        <a className="underline text-[var(--color-cyan-ink)]" href={`tel:${phone}`}>{phone}</a>.
      </p>
    </section>
  );
}
