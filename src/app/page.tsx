'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  QrCode, Search, Upload, Wallet, MapPin, ArrowRight, Store, ShieldCheck, Zap,
} from 'lucide-react';
import { ConsumerPage } from '@/components/clear/consumer-page';
import { Input } from '@/components/clear/input';
import { TintedButton } from '@/components/clear/button';
import { useApiClient } from '@/components/portal/use-api-client';
import { readRecentOrders, type RecentOrderSummary } from '@/lib/customer/recent-orders';
import { readPendingOrder, type PendingOrder } from '@/lib/customer/order-restore';
import {
  geolocationErrorMessage,
  loadStoredLocation,
  parseOpenStatus,
  requestGeolocation,
  saveStoredLocation,
  type CustomerLocation,
  type GeolocationFailure,
  type NearbyShop,
} from '@/lib/location/shop-filters';

interface ShopListItem {
  id: string;
  name: string;
  slug: string;
  address: string;
  phone: string;
  upiId: string;
  subscriptionTier: string;
  isActive: boolean;
  isOpen: boolean;
  waitMinutes: number | null;
  queueCount?: number | null;
  distanceLabel?: string | null;
  distanceKm?: number | null;
  image?: string | null;
  pricingSummary: { bwA4PerPage: number; colorA4PerPage: number; minOrderValue: number };
}

const IS_DEV = process.env.NODE_ENV !== 'production';
const DEMO_SHOP_SLUGS = new Set(['quickprint', 'copycenter', 'prinithub']);
function isDemoOrTestShop(s: ShopListItem): boolean {
  if (IS_DEV) return false;
  if (DEMO_SHOP_SLUGS.has(s.slug.toLowerCase())) return true;
  if (s.slug.toLowerCase().startsWith('test-')) return true;
  if (/demo shop/i.test(s.name)) return true;
  return false;
}

const SHOPS_CACHE_KEY = 'printshop:shops-cache';
const SHOPS_CACHE_TTL_MS = 60_000;

interface ShopsCacheEntry { fetchedAt: number; shops: ShopListItem[]; }

function readShopsCache(): ShopListItem[] | null {
  try {
    const raw = sessionStorage.getItem(SHOPS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ShopsCacheEntry;
    if (!Array.isArray(parsed.shops) || Date.now() - parsed.fetchedAt > SHOPS_CACHE_TTL_MS) return null;
    return parsed.shops;
  } catch { return null; }
}

function writeShopsCache(shops: ShopListItem[]): void {
  try { sessionStorage.setItem(SHOPS_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), shops })); }
  catch { /* sessionStorage unavailable */ }
}

/** Wait-time display string per the reference: "about 6 min wait" / "no wait" / "Opens …" */
function waitText(s: ShopListItem): string {
  if (!s.isOpen) return 'Closed';
  if (s.waitMinutes != null && s.waitMinutes > 0) return `about ${s.waitMinutes} min wait`;
  if ((s.queueCount ?? 0) > 0) return `${s.queueCount} in queue`;
  return 'no wait';
}

/** Status chip class per the reference: ok (green) for open, a (amber) for closed */
function chipClass(s: ShopListItem): string {
  return s.isOpen ? 'chip ok' : 'chip a';
}

/** White row card (Clear) — token-based, no legacy `.g` margins. */
const cardClass = 'rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-1';
const cardPadClass = 'rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-4';

/**
 * Site home — auth-aware.
 *
 * LOGGED-OUT visitors see a marketing landing that explains what Printelyx
 * is, with primary CTAs (Find a shop / Scan QR / Sign in / Get started) and
 * a browsable peek at nearby shops — the app works WITHOUT login, so a
 * logged-out visitor can still find a shop and place an order.
 *
 * LOGGED-IN customers see the consumer home: the shops list, search,
 * recent/pending orders, and the QR scanner rail.
 *
 * QR-scan entry (`/scan`, `/s/[slug]`) is handled on those routes and
 * NEVER forces login — a scanned QR goes straight to the shop page.
 */
export default function HomePage() {
  const router = useRouter();
  const api = useApiClient();
  const [shops, setShops] = useState<ShopListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [savedLocation, setSavedLocation] = useState<CustomerLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [recentOrder, setRecentOrder] = useState<RecentOrderSummary | null>(null);
  const [pendingOrder, setPendingOrder] = useState<PendingOrder | null>(null);

  const authed = api.ready && Boolean(api.token);

  useEffect(() => {
    const list = readRecentOrders();
    setRecentOrder(list.length > 0 ? list[0] : null);
    setPendingOrder(readPendingOrder());
    setSavedLocation(loadStoredLocation());
  }, []);

  const fetchShops = useCallback(async (): Promise<ShopListItem[] | null> => {
    const loc = loadStoredLocation();
    if (loc) {
      try {
        const res = await fetch(`/api/shops/nearby?lat=${loc.lat}&lng=${loc.lng}&radius=10&limit=50`);
        if (res.ok) {
          const body = (await res.json()) as { data?: { shops?: NearbyShop[] } };
          const nearby = (body.data?.shops ?? []).map((s): ShopListItem => ({
            id: s.id, name: s.name, slug: s.slug, address: s.address,
            phone: '', upiId: '', subscriptionTier: '', isActive: true,
            isOpen: parseOpenStatus(s.openStatus).isOpen ?? true,
            waitMinutes: s.waitMinutes ?? null,
            queueCount: s.queueCount ?? null,
            distanceLabel: s.distanceLabel ?? null,
            distanceKm: s.distanceKm ?? null,
            image: s.image ?? null,
            pricingSummary: {
              bwA4PerPage: s.pricingSummary?.bwA4PerPage ?? 200,
              colorA4PerPage: s.pricingSummary?.colorA4PerPage ?? 500,
              minOrderValue: s.pricingSummary?.minOrderValue ?? 1000,
            },
          }));
          return nearby.filter((s) => !isDemoOrTestShop(s));
        }
      } catch { /* fall through to list endpoint */ }
    }
    const res = await fetch('/api/v1/shops?limit=50', { headers: { Accept: 'application/json' } });
    if (res.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const retry = await fetch('/api/v1/shops?limit=50', { headers: { Accept: 'application/json' } });
      if (!retry.ok) return null;
      const d = (await retry.json()) as { data?: { shops: ShopListItem[] } };
      return d.data?.shops.filter((s) => !isDemoOrTestShop(s)) ?? null;
    }
    if (!res.ok) return null;
    const d = (await res.json()) as { data?: { shops: ShopListItem[] } };
    return d.data?.shops.filter((s) => !isDemoOrTestShop(s)) ?? null;
  }, []);

  const loadShops = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) { setLoading(true); setError(null); }
    try {
      const list = await fetchShops();
      if (list === null) {
        if (!opts?.background) setError('load-failed');
      } else {
        setShops(list);
        writeShopsCache(list);
        setError(null);
      }
    } catch {
      if (!opts?.background) setError('load-failed');
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [fetchShops]);

  useEffect(() => {
    const cached = readShopsCache();
    if (cached) { setShops(cached); setLoading(false); void loadShops({ background: true }); }
    else { void loadShops(); }
  }, [loadShops]);

  const handleDetectAndFind = useCallback(async () => {
    setLocating(true); setLocError(null);
    try {
      const loc = await requestGeolocation();
      saveStoredLocation(loc);
      setSavedLocation(loc);
      router.push('/find-a-shop');
    } catch (cause) {
      const code = (cause as { code?: GeolocationFailure })?.code ?? 'unavailable';
      setLocError(geolocationErrorMessage(code));
    } finally { setLocating(false); }
  }, [router]);

  const filtered = useMemo(() => {
    let list = shops;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q));
    return list;
  }, [shops, query]);

  /* ── Shared: shops card body ── */
  const shopsCard = (compact = false) => {
    if (error) {
      return (
        <div className={cardPadClass}>
          <p className="text-[15px] font-semibold text-[var(--label)]">Couldn&apos;t load shops</p>
          <small className="mt-1 block text-sm text-[var(--label-2)]">This is usually temporary. Try again.</small>
          <TintedButton type="button" size="compact" onClick={() => void loadShops()} className="mt-3">
            Try again
          </TintedButton>
        </div>
      );
    }
    if (loading) {
      return (
        <div className={cardClass}>
          <div className="r"><span className="text-[var(--label-2)]">Looking for shops nearby…</span></div>
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className={cardPadClass}>
          <p className="text-[15px] font-semibold text-[var(--label)]">No shops found{query ? ' for your search' : ''}</p>
          <small className="mt-1 block text-sm text-[var(--label-2)]">
            Scan a shop&apos;s QR code to go straight to its page.
          </small>
        </div>
      );
    }
    const list = compact ? filtered.slice(0, 5) : filtered;
    return (
      <div className={cardClass}>
        {list.map((s) => (
          <Link key={s.id} href={`/s/${s.slug}`} className="r">
            <span>{s.name}<small>{s.isOpen ? `Open, ${waitText(s)}` : waitText(s)}{s.distanceLabel ? ` · ${s.distanceLabel}` : ''}</small></span>
            <span className="v"><span className={chipClass(s)}>{s.isOpen ? 'Open' : 'Closed'}</span></span>
          </Link>
        ))}
        {compact && filtered.length > 5 && (
          <Link href="/find-a-shop" className="r">
            <span>View all {filtered.length} shops</span>
            <span className="v"><ArrowRight className="size-4" aria-hidden="true" /></span>
          </Link>
        )}
      </div>
    );
  };

  /* ── Shared: search card ── */
  const searchCard = () => (
    <div className={cardPadClass}>
      <Input
        id="q"
        label="Search shops"
        placeholder="Search by shop or area"
        value={query}
        onChange={setQuery}
        autoComplete="off"
      />
    </div>
  );

  /* ── Shared: "Run a print shop?" card ── */
  const runShopCard = () => (
    <div className={cardClass}>
      <div className="r"><span>Run a print shop?<small>Get a QR code and start taking orders.</small></span></div>
      <Link href="/shop/register" className="r"><span>Register your shop</span><span className="v">›</span></Link>
      <Link href="/shop/login" className="r"><span>Shopkeeper login</span><span className="v">›</span></Link>
    </div>
  );

  /* ── Shared: pending / recent order rows ── */
  const orderRows = () => {
    const pending = pendingOrder;
    const recent = recentOrder;
    if (!pending && !recent) return null;
    if (pending && recent && pending.token === recent.token) return null;
    return (
      <div className={cardClass}>
        {pending && (
          <Link href={`/s/${pending.shopSlug}`} className="r">
            <span>Continue paying — Order {pending.orderNumber ?? '—'}<small>{pending.shopName ?? ''} — payment was interrupted</small></span>
            <span className="v">›</span>
          </Link>
        )}
        {recent && pending?.token !== recent.token && (
          <Link href={`/o/${recent.token}`} className="r">
            <span>Order {recent.orderNumber ?? '—'}<small>{recent.shopName ?? ''} — track your order</small></span>
            <span className="v">›</span>
          </Link>
        )}
      </div>
    );
  };

  /* ════════════════════════════════════════════════════════════════════
     MARKETING LANDING — logged-out visitors.
     Explains what Printelyx is, with CTAs and a browsable shops peek
     (the app works without login).
     ════════════════════════════════════════════════════════════════════ */
  if (api.ready && !api.token) {
    return (
      <ConsumerPage wide>
        {/* Hero */}
        <section className="rounded-[18px] border border-[var(--hairline)] bg-[var(--surface)] px-6 py-10 text-center sm:px-10 sm:py-14">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-[var(--accent-tint)] px-3 py-1 text-[12px] font-semibold text-[var(--accent-tint-text)]">
            <Zap className="size-3.5" aria-hidden="true" />
            0% commission · Pay the shop directly by UPI
          </div>
          <h1 className="mt-5 text-[clamp(28px,6vw,44px)] font-bold leading-[1.1] tracking-tight text-[var(--label)]">
            Your documents.<br className="sm:hidden" /> Printed nearby.
          </h1>
          <p className="mx-auto mt-4 max-w-[520px] text-[16px] leading-relaxed text-[var(--label-2)]">
            Printelyx connects you to print shops around you. Scan a shop&apos;s QR
            code, upload your files, choose your print options, and pay the shop
            directly — no queue, no middleman.
          </p>
          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => void handleDetectAndFind()}
              disabled={locating}
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[10px] bg-[var(--accent)] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[var(--accent-press)] disabled:opacity-60"
            >
              <MapPin className="size-4" aria-hidden="true" />
              {locating ? 'Finding shops…' : 'Find shops near me'}
            </button>
            <Link
              href="/scan"
              className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-6 text-[15px] font-semibold text-[var(--label)] transition-colors hover:bg-[var(--ground)]"
            >
              <QrCode className="size-4" aria-hidden="true" />
              Scan a shop QR
            </Link>
          </div>
          {locError && (
            <p className="mt-3 text-[13px] text-[var(--label-2)]" role="alert">{locError}</p>
          )}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-[var(--label-2)]">
            <Link href="/auth/login" className="font-semibold text-[var(--accent)] hover:underline">Sign in</Link>
            <span aria-hidden="true">·</span>
            <Link href="/auth/signup" className="font-semibold text-[var(--accent)] hover:underline">Get started</Link>
            <span aria-hidden="true">·</span>
            <Link href="/how-it-works" className="hover:underline">How it works</Link>
          </div>
          <p className="mt-4 text-[12px] text-[var(--label-3)]">
            No account needed to print — scan a QR and order as a guest.
          </p>
        </section>

        {/* Feature cards */}
        <section className="mt-6 grid gap-4 sm:grid-cols-3">
          {[
            { icon: Search, title: 'Find a shop', body: 'Browse print shops near you, see live wait times and pricing before you go.' },
            { icon: Upload, title: 'Upload & customize', body: 'Send your documents from your phone. Choose B/W or colour, copies, single or double-sided.' },
            { icon: Wallet, title: 'Pay by UPI & track', body: 'Pay the shop directly — no commission. Track your order until it&apos;s ready for pickup.' },
          ].map((f) => (
            <div key={f.title} className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-5">
              <div className="flex size-10 items-center justify-center rounded-[10px] bg-[var(--accent-tint)] text-[var(--accent)]">
                <f.icon className="size-5" aria-hidden="true" />
              </div>
              <h3 className="mt-3 text-[16px] font-semibold text-[var(--label)]">{f.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--label-2)]">{f.body}</p>
            </div>
          ))}
        </section>

        {/* Shops peek — browsable without login */}
        <section className="mt-6">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[18px] font-semibold text-[var(--label)]">Shops near you</h2>
            <Link href="/find-a-shop" className="inline-flex items-center gap-1 text-[14px] font-semibold text-[var(--accent)] hover:underline">
              View all <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          <div className="mt-3">{shopsCard(true)}</div>
        </section>

        {/* Run a print shop CTA */}
        <section className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--accent-tint)] p-6">
            <div className="flex items-center gap-2">
              <Store className="size-5 text-[var(--accent)]" aria-hidden="true" />
              <h2 className="text-[18px] font-semibold text-[var(--label)]">Run a print shop?</h2>
            </div>
            <p className="mt-2 text-[14px] leading-relaxed text-[var(--label-2)]">
              Get your own QR code, take orders online, and customers pay you directly
              via UPI. 0% commission — set up in about two minutes.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/shop/register"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] bg-[var(--accent)] px-5 text-[14px] font-semibold text-white hover:bg-[var(--accent-press)]"
              >
                Register your shop <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                href="/shop/login"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface)] px-5 text-[14px] font-semibold text-[var(--label)] hover:bg-[var(--ground)]"
              >
                Shopkeeper login
              </Link>
            </div>
          </div>
          {/* Trust card */}
          <div className="rounded-[14px] border border-[var(--hairline)] bg-[var(--surface)] p-5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-[var(--accent)]" aria-hidden="true" />
              <h3 className="text-[15px] font-semibold text-[var(--label)]">Why Printelyx</h3>
            </div>
            <ul className="mt-3 space-y-2 text-[13px] text-[var(--label-2)]">
              <li>· Pay the shop directly — we never touch your money</li>
              <li>· Live wait times so you skip the queue</li>
              <li>· Track your order from upload to pickup</li>
              <li>· Works on any phone — no app required</li>
            </ul>
          </div>
        </section>

        {/* Mobile-only footer links */}
        <div className="mt-6 px-2 pb-2 text-sm lg:hidden">
          <Link href="/help" className="text-[var(--accent)]">Help</Link>
          <span className="mx-1.5 text-[var(--hairline)]" aria-hidden="true">·</span>
          <Link href="/about" className="text-[var(--accent)]">About</Link>
          <span className="mx-1.5 text-[var(--hairline)]" aria-hidden="true">·</span>
          <Link href="/pricing" className="text-[var(--accent)]">Pricing</Link>
        </div>
      </ConsumerPage>
    );
  }

  /* ════════════════════════════════════════════════════════════════════
     CONSUMER HOME — logged-in customers.
     The shops list, search, recent/pending orders, and the QR rail.
     ════════════════════════════════════════════════════════════════════ */
  return (
    <ConsumerPage wide>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <div>
            <h1 className="type-hero">Print without the queue</h1>
            <p className="type-sub mt-2">Find a shop near you, or scan its QR code.</p>
          </div>
          {searchCard()}
          {orderRows()}
          {shopsCard()}
          <p className="type-caption px-2 lg:hidden">Scan a shop&apos;s QR code to go straight to its page.</p>
        </div>

        <aside className="min-w-0 space-y-4">
          {/* Desktop-only scanner card. */}
          <div className={`${cardPadClass} hidden text-center lg:block`}>
            <p className="text-[15px] font-semibold text-[var(--label)]">Scan a shop QR code</p>
            <div className="mx-auto mt-3 flex size-[120px] items-center justify-center rounded-2xl border border-[var(--hairline)] bg-[var(--ground)]">
              <QrCode className="size-12 text-[var(--label-2)]" aria-hidden="true" />
            </div>
            <p className="mt-3 text-sm text-[var(--label-2)]">Point your camera at a shop&apos;s QR code to open its page.</p>
            <Link
              href="/scan"
              className="mt-4 inline-flex min-h-[44px] items-center rounded-full bg-[var(--accent-tint)] px-5 text-[15px] font-semibold text-[var(--accent-tint-text)]"
            >
              Open scanner
            </Link>
          </div>
          {runShopCard()}
        </aside>
      </div>

      {/* Mobile-only footer links */}
      <div className="mt-6 px-2 pb-2 text-sm lg:hidden">
        <Link href="/orders" className="text-[var(--accent)]">My orders</Link>
        <span className="mx-1.5 text-[var(--hairline)]" aria-hidden="true">·</span>
        <Link href="/track" className="text-[var(--accent)]">Track order</Link>
        <span className="mx-1.5 text-[var(--hairline)]" aria-hidden="true">·</span>
        <Link href="/help" className="text-[var(--accent)]">Help</Link>
      </div>
    </ConsumerPage>
  );
}
