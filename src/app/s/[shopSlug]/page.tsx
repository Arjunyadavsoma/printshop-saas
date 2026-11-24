import { notFound } from 'next/navigation';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ShopOrderPage } from './ShopOrderPage';

/**
 * /s/[shopSlug] — the QR landing. Server Component.
 *
 * Loads the shop from the DB and renders the Clear customer flow
 * (CustomerOrderFlowV2 inside CustomerShell, via ShopOrderPage).
 * Pricing comes from the shop's real config: active A4 single-side
 * price rules first, then the shop pricingConfig. Only when neither
 * exists do the display strings fall back to the spec rates
 * (B&W ₹2 / Colour ₹10 per page) — and the page says so.
 */
export default async function ShopLanding({ params }: { params: Promise<{ shopSlug: string }> }) {
  const { shopSlug } = await params;
  const db = getContainer().db;
  const shop = await db.findOne<{
    id: string; name: string; slug: string; address: string; phone: string;
    isOpen: boolean; acceptingOrders: boolean; openingHours: unknown;
    upiId: string; upiPayeeName: string | null; paymentMode: string;
    paymentMethods: string; minutesPerPageBw: number; minutesPerPageColor: number;
    retentionHours: number; pricingConfig: string | Record<string, number> | null;
  }>('shop', { slug: shopSlug });
  if (!shop) notFound();

  // Live status: printers online + queue depth → honest wait estimate.
  // The three shop-scoped reads are independent — run them in parallel.
  // They used to run sequentially and the shop page took 2–3s to answer
  // on production, which read on a phone as "the shop is not opening".
  const [printers, queued, rateRows] = await Promise.all([
    repos.printers.listForShop(shop.id),
    repos.printJobs.findQueuedByShop(shop.id, 50),
    repos.priceRules.activeForShop(shop.id),
  ]);
  const onlinePrinters = printers.filter(p => p.enabled && p.status === 'ONLINE');
  const queuedSheets = queued.reduce((sum, t) => sum + (t.sheetCount ?? 1) * (t.copies ?? 1), 0);
  // Default minutes-per-page to 1/2 when fields missing (in-memory adapter
  // doesn't apply Prisma @default). Avoids NaN in wait calculation.
  const minBw = shop.minutesPerPageBw ?? 1;
  const minColor = shop.minutesPerPageColor ?? 2;
  const minPerPp = Math.max(1, Math.round((minBw + minColor) / 2));
  const waitMinutes = Math.ceil((queuedSheets * minPerPp) / Math.max(1, onlinePrinters.length));

  // Rate board — pulls the cheapest single-side A4 slab per colour mode
  // from the active price rules (fetched above, in parallel).
  const bwRule = rateRows.find(r => r.colorMode === 'BW' && r.paperSize === 'A4' && r.sides === 'SINGLE');
  const colorRule = rateRows.find(r => r.colorMode === 'COLOR' && r.paperSize === 'A4' && r.sides === 'SINGLE');
  const doubleBwRule = rateRows.find(r => r.colorMode === 'BW' && r.paperSize === 'A4' && r.sides === 'DOUBLE');
  const pricingCfg = typeof shop.pricingConfig === 'string'
    ? (() => { try { return JSON.parse(shop.pricingConfig); } catch { return null; } })()
    : shop.pricingConfig;
  const bwPerPagePaise = bwRule?.slabs[0]?.perPagePaise ?? pricingCfg?.bw_a4_per_page ?? null;
  const colorPerPagePaise = colorRule?.slabs[0]?.perPagePaise ?? pricingCfg?.color_a4_per_page ?? null;
  const doubleBwPerPagePaise = doubleBwRule?.slabs[0]?.perPagePaise ?? pricingCfg?.bw_a4_double_per_page ?? null;
  const pricesFromConfig = bwPerPagePaise != null && colorPerPagePaise != null;

  // Format the per-page rates as display strings (e.g. "₹2"). The spec
  // rates are the fallback only when the shop has no pricing configured.
  const bwPriceText = bwPerPagePaise != null ? `₹${Math.round(bwPerPagePaise / 100)}` : '₹2';
  const colorPriceText = colorPerPagePaise != null ? `₹${Math.round(colorPerPagePaise / 100)}` : '₹10';
  const doubleBwPriceText = doubleBwPerPagePaise != null ? `₹${Math.round(doubleBwPerPagePaise / 100)}` : null;

  // Default to open/accepting when fields are missing (in-memory adapter doesn't
  // always apply Prisma @default(true) — be defensive so demo shops work).
  const shopIsOpen = shop.isOpen ?? true;
  const shopAccepting = shop.acceptingOrders ?? true;
  const closed = !shopIsOpen || !shopAccepting;
  const hoursText = formatOpeningHours(shop.openingHours);
  // Short hours for the landing page (fits on one line without truncation)
  const shortHours = hoursText.length > 30 ? '9 am – 9 pm' : hoursText.replace('Mon–Sat ', '').replace(', Sun closed', ' · Sun closed');

  return (
    <ShopOrderPage
      shopSlug={shop.slug}
      shopName={shop.name}
      upiId={shop.upiId}
      upiPayeeName={shop.upiPayeeName ?? shop.name}
      paymentMode={shop.paymentMode}
      retentionHours={shop.retentionHours ?? 24}
      bwPrice={bwPriceText}
      colorPrice={colorPriceText}
      doubleBwPrice={doubleBwPriceText}
      bwPerPagePaise={bwPerPagePaise}
      colorPerPagePaise={colorPerPagePaise}
      pricesFromConfig={pricesFromConfig}
      hours={shortHours}
      waitMinutes={Math.max(1, waitMinutes)}
      printerCount={Math.max(1, onlinePrinters.length)}
      shopPhone={shop.phone}
      shopAddress={shop.address}
      closed={closed}
    />
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */


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
