import { notFound } from 'next/navigation';
import { getContainer } from '@/lib/container';
import { repos } from '@/lib/repositories';
import {
  shopOpenStatus,
  parseOpeningHours,
  DAY_KEYS,
  type DayKey,
} from '@/lib/location/opening-hours';
import { ShopOrderPage, type PricingBoardGroup } from './ShopOrderPage';

/**
 * /s/[shopSlug] — the QR landing. Server Component.
 *
 * Loads the shop from the DB and renders the shop profile landing
 * (ShopOrderPage): identity header (logo, open-status chip, description),
 * services, a structured pricing board built from the shop's real price
 * rules, and business info. Pricing display strings still come from the
 * shop's real config: active A4 single-side price rules first, then the
 * shop pricingConfig. Only when neither exists do the display strings
 * fall back to the spec rates (B&W ₹2 / Colour ₹10 per page) — and the
 * page says so.
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
    timezone: string | null; logoUrl: string | null; servicesJson: string | null;
    fullAddress: string | null; city: string | null; state: string | null;
    pincode: string | null; description: string | null;
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

  // Open-status from the weekly-hours engine: combines the schedule with
  // the manual flags (isOpen / acceptingOrders) into one customer-facing
  // label ("Open now", "Closes at 9:00 PM", "Opens tomorrow at 9:00 AM"…).
  const openStatus = shopOpenStatus(
    {
      openingHours: shop.openingHours,
      timezone: shop.timezone ?? 'Asia/Kolkata',
      isOpen: shopIsOpen,
      acceptingOrders: shopAccepting,
    },
    new Date(),
  );

  // servicesJson → validated string[] (real keys from the register flow;
  // anything unknown still renders, via the client's key → label fallback).
  const services = parseServices(shop.servicesJson);

  // Structured pricing board from the active price rules: group by paper
  // size, one row per (colour × sides) combo that actually exists, each
  // with the LOWEST slab's per-page rate + the page threshold of that slab.
  const pricingBoard = buildPricingBoard(rateRows);

  // Weekly hours rows for the business-info card (Mon–Sun). Null when the
  // shop has no parseable hours — the list is skipped entirely then.
  const weeklyHours = buildWeeklyHours(shop.openingHours);

  // Display address: the verified fullAddress wins over the legacy string.
  const fullAddress = (shop.fullAddress ?? '').trim() || shop.address;
  const description = (shop.description ?? '').trim() || null;

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
      logoUrl={shop.logoUrl}
      services={services}
      openNow={openStatus.open}
      openLabel={openStatus.label}
      pricingBoard={pricingBoard}
      weeklyHours={weeklyHours}
      fullAddress={fullAddress}
      description={description}
    />
  );
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

/** Parse servicesJson ("[\"bw_print\", …]") into a validated string[]. */
function parseServices(raw: string | null): string[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Group the active price rules into a pricing board: paperSize → rows for
 * each (colour × sides) combination, using the cheapest slab of each rule
 * (with that slab's minPages as the "from N pages" threshold). Duplicate
 * rules for the same combo collapse to the lowest rate. Null when the shop
 * has no active rules — the landing falls back to the pricingConfig card.
 */
function buildPricingBoard(
  rules: Array<{
    paperSize: string;
    colorMode: 'BW' | 'COLOR';
    sides: 'SINGLE' | 'DOUBLE';
    slabs: Array<{ minPages: number; perPagePaise: number }>;
  }>,
): PricingBoardGroup[] | null {
  const bySize = new Map<string, Map<string, PricingBoardGroup['rows'][number]>>();
  for (const rule of rules) {
    const cheapest = [...(rule.slabs ?? [])].sort((a, b) => a.perPagePaise - b.perPagePaise)[0];
    if (!cheapest) continue;
    const rows = bySize.get(rule.paperSize) ?? new Map();
    const comboKey = `${rule.colorMode}|${rule.sides}`;
    const existing = rows.get(comboKey);
    if (!existing || cheapest.perPagePaise < existing.perPagePaise) {
      rows.set(comboKey, {
        colorMode: rule.colorMode,
        sides: rule.sides,
        fromPages: Math.max(1, cheapest.minPages ?? 1),
        perPagePaise: cheapest.perPagePaise,
      });
    }
    bySize.set(rule.paperSize, rows);
  }
  const groups: PricingBoardGroup[] = [...bySize.entries()].map(([paperSize, rows]) => ({
    paperSize,
    rows: [...rows.values()],
  }));
  return groups.length > 0 ? groups : null;
}

/** Weekly hours → Mon–Sun display rows; null when nothing is parseable. */
function buildWeeklyHours(openingHours: unknown): { day: string; label: string }[] | null {
  const hours = parseOpeningHours(openingHours);
  if (Object.keys(hours).length === 0) return null;
  const dayLabels: Record<DayKey, string> = {
    mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
  };
  let anyOpenDay = false;
  const rows = DAY_KEYS.map((key) => {
    const sessions = hours[key] ?? [];
    if (sessions.length === 0) return { day: dayLabels[key], label: 'Closed' };
    anyOpenDay = true;
    return {
      day: dayLabels[key],
      label: sessions.map((s) => `${formatHhMm12h(s.open)} – ${formatHhMm12h(s.close)}`).join(', '),
    };
  });
  return anyOpenDay ? rows : null;
}

/** "09:00" → "9:00 AM" (12-hour clock, matches the opening-hours labels). */
function formatHhMm12h(value: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return value;
  const h24 = Number(m[1]);
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]} ${period}`;
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
