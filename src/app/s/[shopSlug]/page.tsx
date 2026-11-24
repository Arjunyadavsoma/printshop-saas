import { notFound } from 'next/navigation';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import { ReferenceCustomerFlow } from './ReferenceCustomerFlow';

/**
 * /s/[shopSlug] — the QR landing. Server Component.
 *
 * Loads the shop from the DB and renders the reference-design customer flow
 * (ReferenceCustomerFlow) which 1:1 matches the .ref-* CSS classes in
 * globals.css. Closed shops get an explanatory card with the opening hours
 * + a Call button — the customer is never left staring at a dead dropzone.
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
  const printers = await repos.printers.listForShop(shop.id);
  const onlinePrinters = printers.filter(p => p.enabled && p.status === 'ONLINE');
  const queued = await repos.printJobs.findQueuedByShop(shop.id, 50);
  const queuedSheets = queued.reduce((sum, t) => sum + (t.sheetCount ?? 1) * (t.copies ?? 1), 0);
  // Default minutes-per-page to 1/2 when fields missing (in-memory adapter
  // doesn't apply Prisma @default). Avoids NaN in wait calculation.
  const minBw = shop.minutesPerPageBw ?? 1;
  const minColor = shop.minutesPerPageColor ?? 2;
  const minPerPp = Math.max(1, Math.round((minBw + minColor) / 2));
  const waitMinutes = Math.ceil((queuedSheets * minPerPp) / Math.max(1, onlinePrinters.length));

  // Rate board — one line, "B&W ₹2 · Colour ₹8 /page" per the DESIGN-PLAN
  // wireframe screen 1. Pulls the cheapest single-side A4 slab per colour
  // mode from the active price rules. Falls back to the shop's pricingConfig
  // when no price rules exist (e.g. in-memory dev DB after seeding).
  const rateRows = await repos.priceRules.activeForShop(shop.id);
  const bwRule = rateRows.find(r => r.colorMode === 'BW' && r.paperSize === 'A4' && r.sides === 'SINGLE');
  const colorRule = rateRows.find(r => r.colorMode === 'COLOR' && r.paperSize === 'A4' && r.sides === 'SINGLE');
  const pricingCfg = typeof shop.pricingConfig === 'string'
    ? (() => { try { return JSON.parse(shop.pricingConfig); } catch { return null; } })()
    : shop.pricingConfig;
  const bwPerPagePaise = bwRule?.slabs[0]?.perPagePaise ?? pricingCfg?.bw_a4_per_page ?? null;
  const colorPerPagePaise = colorRule?.slabs[0]?.perPagePaise ?? pricingCfg?.color_a4_per_page ?? null;

  // Format the per-page rates as the reference design strings (e.g. "₹2").
  const bwPriceText = bwPerPagePaise != null ? `₹${Math.round(bwPerPagePaise / 100)}` : '₹2';
  const colorPriceText = colorPerPagePaise != null ? `₹${Math.round(colorPerPagePaise / 100)}` : '₹10';

  // Default to open/accepting when fields are missing (in-memory adapter doesn't
  // always apply Prisma @default(true) — be defensive so demo shops work).
  const shopIsOpen = shop.isOpen ?? true;
  const shopAccepting = shop.acceptingOrders ?? true;
  const closed = !shopIsOpen || !shopAccepting;
  const hoursText = formatOpeningHours(shop.openingHours);
  // Short hours for the landing page (fits on one line without truncation)
  const shortHours = hoursText.length > 30 ? '9 am – 9 pm' : hoursText.replace('Mon–Sat ', '').replace(', Sun closed', ' · Sun closed');

  return (
    <div className="customer-flow min-h-dvh flex flex-col items-center">
      <main className="flex-1 w-full">
        {closed ? (
          <ClosedShopCard
            shopName={shop.name}
            hoursText={hoursText}
            address={shop.address}
            phone={shop.phone}
          />
        ) : (
          <ReferenceCustomerFlow
            shopSlug={shop.slug}
            shopName={shop.name}
            upiId={shop.upiId}
            bwPrice={bwPriceText}
            colorPrice={colorPriceText}
            hours={shortHours}
            waitMinutes={Math.max(1, waitMinutes)}
            printerCount={Math.max(1, onlinePrinters.length)}
            shopPhone={shop.phone}
            shopAddress={shop.address}
          />
        )}
      </main>
    </div>
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

/** Closed-shop card — 1:1 replica of design board 18 (Customer: shop closed). */
function ClosedShopCard({ shopName, hoursText, address, phone }: { shopName: string; hoursText: string; address: string; phone: string }) {
  const shortHours = hoursText.length > 30 ? '9 am to 9 pm' : hoursText;
  const rows = (
    <>
      <div className="r"><span>Hours</span><span className="v">{shortHours}</span></div>
      <a className="r" href={phone ? `tel:${phone}` : '#'}><span>Call shop</span><span className="v">›</span></a>
      <a
        className="r"
        href={address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '#'}
        target="_blank"
        rel="noopener noreferrer"
      ><span>Directions</span><span className="v">›</span></a>
    </>
  );

  return (
    <>
      <div className="x m">
        <div className="top"><i className="dot" />{shopName}</div>
        <h1 className="h">Closed right now</h1>
        <p className="sub">Opens at the next opening time.</p>
        <div className="g">{rows}</div>
        <p className="cap">Come back when the shop opens. Nothing is uploaded until then.</p>
      </div>
      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />{shopName}</b>
          <a className="v" href="/help" style={{ textDecoration: 'none' }}>Help</a>
        </div>
        <div className="wrap">
          <div className="l">
            <h1 className="h1">Closed right now</h1>
            <p className="s2">Opens at the next opening time.</p>
            <div className="gg">{rows}</div>
            <p className="cap">Come back when the shop opens. Nothing is uploaded until then.</p>
          </div>
        </div>
      </div>
    </>
  );
}
