'use client';

import Link from 'next/link';
import { MapPin, Clock, ChevronRight, Printer, ScanLine, Paperclip, Palette, FileText } from 'lucide-react';
import type { NearbyShop } from '@/lib/location/shop-filters';
import { parseOpenStatus } from '@/lib/location/shop-filters';
import { formatRupeesFromPaise } from './format';

/**
 * ShopCard — the premium, reusable shop discovery card.
 *
 * Renders ONLY information that exists in the backend response:
 *   - name, logo (logoUrl with letter-initial fallback)
 *   - address, distance (when a location is set)
 *   - open/closed status (openStatus label from the server)
 *   - supported services (availableServices from servicesJson)
 *   - starting prices (pricingSummary — actual shop pricing)
 *   - wait / queue (waitMinutes, queueCount)
 *   - "Not accepting orders" guard (acceptingOrders === false)
 *
 * NO ratings or reviews — Printelyx has no review model, so no rating is
 * ever displayed (the API hardcodes rating: null and we honour that).
 */

const SERVICE_LABELS: Record<string, string> = {
  bw_print: 'B&W printing',
  color_print: 'Colour',
  a3_print: 'A3 / large',
  scan: 'Scanning',
  laminate: 'Lamination',
  binding: 'Binding',
  photo_print: 'Photos',
  document_print: 'Documents',
  id_card: 'ID cards',
  passport_photo: 'Passport photos',
};

export function serviceLabel(key: string): string {
  return SERVICE_LABELS[key] ?? key.replace(/_/g, ' ');
}

/** Pick up to 3 meaningful service chips, prioritising print + extras. */
function topServices(available: string[] | null | undefined): string[] {
  if (!available || available.length === 0) return [];
  const priority = ['bw_print', 'color_print', 'scan', 'binding', 'laminate', 'a3_print', 'photo_print', 'document_print', 'id_card', 'passport_photo'];
  const ranked = priority.filter((k) => available.includes(k));
  const rest = available.filter((k) => !priority.includes(k));
  return [...ranked, ...rest].slice(0, 3);
}

export function serviceIcon(key: string) {
  switch (key) {
    case 'color_print': return <Palette className="size-3" aria-hidden="true" />;
    case 'scan': return <ScanLine className="size-3" aria-hidden="true" />;
    case 'binding': return <Paperclip className="size-3" aria-hidden="true" />;
    case 'laminate': return <FileText className="size-3" aria-hidden="true" />;
    default: return <Printer className="size-3" aria-hidden="true" />;
  }
}

export interface ShopCardProps {
  shop: NearbyShop;
  /** Show distance chip (only when the customer has a location set). */
  showDistance?: boolean;
  /** Highlight treatment (e.g. map selection sync). */
  selected?: boolean;
  onHover?: (slug: string | null) => void;
  onSelect?: (slug: string) => void;
}

export function ShopCard({ shop, showDistance = false, selected = false, onHover, onSelect }: ShopCardProps) {
  const status = parseOpenStatus(shop.openStatus);
  const open = status.isOpen === true;
  const closed = status.isOpen === false;
  const accepting = shop.acceptingOrders !== false;
  const services = topServices(shop.availableServices);
  const bw = shop.pricingSummary?.bwA4PerPage;
  const colour = shop.pricingSummary?.colorA4PerPage;

  const statusChip = closed
    ? <span className="rounded-full bg-[#FFFBEB] px-2 py-0.5 text-[11px] font-semibold text-[#B45309]">Closed</span>
    : open
      ? <span className="rounded-full bg-[#F0FDF4] px-2 py-0.5 text-[11px] font-semibold text-[#15803D]">Open</span>
      : <span className="rounded-full bg-[var(--ground)] px-2 py-0.5 text-[11px] font-semibold text-[var(--label-2)] border border-[var(--hairline)]">Hours not listed</span>;

  const waitLine = (() => {
    if (!open || !accepting) return null;
    if (shop.waitMinutes != null && shop.waitMinutes > 0) return `about ${shop.waitMinutes} min wait`;
    if ((shop.queueCount ?? 0) > 0) return `${shop.queueCount} in queue`;
    return 'no wait';
  })();

  return (
    <Link
      href={`/s/${shop.slug}`}
      onMouseEnter={() => onHover?.(shop.slug)}
      onMouseLeave={() => onHover?.(null)}
      onClick={() => onSelect?.(shop.slug)}
      aria-selected={selected || undefined}
      className={[
        'group block rounded-[14px] border bg-[var(--surface)] p-4 transition-all outline-none',
        selected
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent-tint)]'
          : 'border-[var(--hairline)] hover:border-[var(--accent)]/40 hover:shadow-[0_1px_3px_rgb(16_24_40/0.07),0_8px_24px_-12px_rgb(16_24_40/0.12)]',
        'focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        {/* Logo */}
        <div className="relative shrink-0">
          {shop.image || shop.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote shop logo (user-provided URL)
            <img
              src={(shop.image ?? shop.logoUrl) as string}
              alt={`${shop.name} logo`}
              className="size-12 rounded-[10px] border border-[var(--hairline)] object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="flex size-12 items-center justify-center rounded-[10px] bg-[var(--accent-tint)] text-[18px] font-bold text-[var(--accent-tint-text)]">
              {shop.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>

        {/* Main */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-[15px] font-semibold text-[var(--label)]">{shop.name}</h3>
            {statusChip}
            {showDistance && shop.distanceLabel && (
              <span className="rounded-full bg-[var(--accent-tint)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-tint-text)]">{shop.distanceLabel}</span>
            )}
          </div>

          {/* Address + wait */}
          <p className="mt-1 line-clamp-1 text-[13px] text-[var(--label-2)]">
            <MapPin className="mr-1 inline size-3 align-[-1px]" aria-hidden="true" />
            {shop.address || 'Address not listed'}
          </p>
          {waitLine && (
            <p className="mt-0.5 text-[12px] text-[var(--label-2)]">
              <Clock className="mr-1 inline size-3 align-[-1px]" aria-hidden="true" />
              {waitLine}
            </p>
          )}
          {!accepting && (
            <p className="mt-1 text-[12px] font-medium text-[#B45309]">Not accepting orders right now</p>
          )}

          {/* Services */}
          {services.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {services.map((key) => (
                <span key={key} className="inline-flex items-center gap-1 rounded-full border border-[var(--hairline)] bg-[var(--ground)] px-2 py-0.5 text-[11px] font-medium text-[var(--label-2)]">
                  {serviceIcon(key)}
                  {serviceLabel(key)}
                </span>
              ))}
            </div>
          )}

          {/* Pricing + action */}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <p className="truncate text-[12px] text-[var(--label-2)]">
              {bw != null && bw > 0
                ? <>From <span className="font-semibold text-[var(--label)]">{formatRupeesFromPaise(bw)}</span>/page B&W{colour != null && colour > 0 ? <> · {formatRupeesFromPaise(colour)}/page colour</> : null}</>
                : 'Pricing on request'}
            </p>
            <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-semibold text-[var(--accent)] group-hover:underline">
              View shop <ChevronRight className="size-3.5" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default ShopCard;
