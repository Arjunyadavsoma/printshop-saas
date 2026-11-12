'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { useApiClient } from '@/components/portal/use-api-client';
import { formatINRFromPaise } from '@platform/utils';
import { cn } from '@/lib/utils';
import {
  Search, MapPin, Printer, ShieldCheck,
  QrCode, Store, ArrowRight, Github, Loader2, AlertCircle,
  Wallet,
} from 'lucide-react';

interface PricingSummary {
  bwA4PerPage: number;
  colorA4PerPage: number;
  minOrderValue: number;
}

interface ShopListItem {
  id: string;
  name: string;
  slug: string;
  address: string;
  phone: string;
  upiId: string;
  paymentProvider: string;
  subscriptionTier: 'free' | 'starter' | 'pro' | 'enterprise';
  isActive: boolean;
  pricingSummary: PricingSummary;
}

interface ShopsListResponse {
  shops: ShopListItem[];
  pagination: { limit: number; offset: number; hasNext: boolean; total: number };
}

const TIER_STYLES: Record<ShopListItem['subscriptionTier'], string> = {
  free: 'bg-muted text-muted-foreground border-border',
  starter: 'bg-brand-soft text-brand border-brand-border',
  pro: 'bg-success-soft text-success border-success-border',
  enterprise: 'bg-info-soft text-info border-info-border',
};

// Feature highlights — explains the value of the platform to both customers
// and prospective shopkeepers. Icons rendered on a `bg-brand-soft` chip.
const FEATURES = [
  {
    icon: ShieldCheck,
    title: '0% commission',
    description: 'Customers pay the shopkeeper directly via UPI. PrintShop takes nothing — no hidden fees, no middlemen.',
  },
  {
    icon: Wallet,
    title: 'UPI direct to shopkeeper',
    description: 'Money lands instantly in the shopkeeper\u2019s UPI account. No settlement delays, no payout cycles.',
  },
  {
    icon: QrCode,
    title: 'QR ordering',
    description: 'Every shop gets a unique QR code. Customers scan, upload PDFs, and order from any phone browser.',
  },
  {
    icon: Printer,
    title: 'Print management',
    description: 'Shopkeepers manage their queue, orders, and printer agent from a single dashboard.',
  },
];

// How-it-works stepper — shopkeeper onboarding journey. Numbered circles use
// `bg-brand text-brand-foreground` per the Square UI brief.
const HOW_IT_WORKS = [
  {
    step: 1,
    title: 'Register your shop',
    body: 'Create a shop account in minutes. Add your shop name, UPI ID, and the print services you offer.',
  },
  {
    step: 2,
    title: 'Get your unique QR',
    body: 'PrintShop generates a QR code for your shop. Print it and place it on your counter.',
  },
  {
    step: 3,
    title: 'Customers order & pay via UPI',
    body: 'Customers scan the QR, upload PDFs, choose print options, and pay you directly via UPI — no app required.',
  },
  {
    step: 4,
    title: 'Print & collect',
    body: 'Accept the order, print, and hand it over. Files auto-delete on collection — privacy by design.',
  },
];

export default function HomePage() {
  const api = useApiClient();
  const router = useRouter();
  const [shops, setShops] = useState<ShopListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const loadShops = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await api.request<{ data?: ShopsListResponse; error?: { message?: string } }>('GET', '/api/v1/shops?limit=50');
    if (r.status >= 400 || !r.data?.data) {
      // Never surface raw API error messages to customers — they may contain
      // stack traces, file paths, or internal config (e.g. Prisma errors with
      // DATABASE_URL). Show a friendly sentinel + log the detail for devs only.
      const raw = r.data?.error?.message;
      if (raw && process.env.NODE_ENV !== 'production') {
        console.error('[shops] load failed:', raw);
      }
      setError('load-failed'); // truthy sentinel — error card renders with friendly copy
    } else {
      setShops(r.data.data.shops);
    }
    setLoading(false);
  }, [api]);

  useEffect(() => {
    if (!api.ready) return;
    void loadShops();
  }, [api.ready, loadShops]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shops;
    return shops.filter(
      (s) => s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q),
    );
  }, [shops, query]);

  const onShopClick = (slug: string) => router.push(`/shops/${slug}`);

  return (
    <div className="flex min-h-screen flex-col bg-page">
      {/* Theme toggle (top-right, floats above hero) */}
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      {/* Hero */}
      <header className="border-b border-border bg-brand-soft">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-10 sm:gap-8 sm:px-6 sm:py-16 lg:py-20">
          <Badge variant="outline" className="border-brand-border bg-surface text-brand">
            <QrCode className="size-3" aria-hidden="true" />
            QR-powered print shops for India
          </Badge>

          <div className="max-w-3xl space-y-5">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Print shops, powered by QR and UPI.
            </h1>
            <p className="text-lg leading-relaxed text-muted-foreground">
              PrintShop connects customers with local print shops. Scan a shop QR, upload PDFs, and pay the shopkeeper directly via UPI — zero commission, zero middlemen. Run a shop? Get started in minutes.
            </p>
            <div className="flex w-full flex-wrap items-center gap-3 pt-1 sm:w-auto">
              <Button asChild size="lg" className="min-h-[44px] gap-2 bg-brand text-brand-foreground hover:bg-brand-hover">
                <Link href="/shop/register">
                  Get started
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="min-h-[44px] gap-2">
                <a href="#shops">
                  <Search className="size-4" aria-hidden="true" />
                  Browse shops
                </a>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Feature highlights */}
      <section aria-labelledby="features-heading" className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-col gap-2">
            <h2 id="features-heading" className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Why PrintShop
            </h2>
            <p className="text-sm text-muted-foreground">
              A modern print shop platform built for India — UPI-native, commission-free, and customer-friendly.
            </p>
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <Card key={f.title} className="h-full border-border bg-surface">
                <CardContent className="flex flex-col gap-3 p-5">
                  <div
                    className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand"
                    aria-hidden="true"
                  >
                    <f.icon className="size-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-it-works-heading" className="border-b border-border bg-page">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-col gap-2">
            <h2 id="how-it-works-heading" className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              How it works
            </h2>
            <p className="text-sm text-muted-foreground">
              From sign-up to your first order in under five minutes. No app, no commission.
            </p>
          </div>

          <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((step) => (
              <li key={step.step}>
                <Card className="h-full border-border bg-surface">
                  <CardContent className="flex flex-col gap-3 p-5">
                    <div
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold tabular-nums text-brand-foreground"
                      aria-label={`Step ${step.step}`}
                    >
                      {step.step}
                    </div>
                    <h3 className="text-base font-semibold text-foreground">{step.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Shop discovery */}
      <main className="flex-1">
        <section id="shops" aria-labelledby="discover-heading" className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-col gap-2">
            <h2 id="discover-heading" className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Discover print shops
            </h2>
            <p className="text-sm text-muted-foreground">
              Browse active shops, compare pricing, and start an order in one tap.
            </p>
          </div>

          {/* Search bar */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                placeholder="Search by shop name or address…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 pl-10 text-base"
                aria-label="Search print shops by name or address"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-11 w-full sm:w-auto"
              onClick={() => setQuery('')}
              disabled={!query}
            >
              Clear
            </Button>
          </div>

          {/* Shops grid */}
          <div className="mt-8">
            {loading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="border-border bg-surface">
                    <CardContent className="flex flex-col gap-3 p-5">
                      <Skeleton className="h-5 w-2/3" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-3/4" />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Skeleton className="h-9 w-full" />
                        <Skeleton className="h-9 w-full" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : error ? (
              <Card className="border-danger-border bg-danger-soft">
                <CardContent className="flex flex-col items-start gap-3 p-6">
                  <div className="flex items-center gap-2 text-danger">
                    <AlertCircle className="size-5" aria-hidden="true" />
                    <span className="font-medium">We couldn&apos;t load shops right now</span>
                  </div>
                  <p className="text-sm break-words text-muted-foreground">
                    This is usually temporary. Please try again in a moment.
                  </p>
                  <Button onClick={loadShops} size="sm" variant="outline" className="h-11">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Try again
                  </Button>
                </CardContent>
              </Card>
            ) : filtered.length === 0 ? (
              <Card className="border-dashed border-border bg-surface">
                <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                  <Store className="size-8 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <p className="font-medium text-foreground">
                      {shops.length === 0 ? 'No shops available yet' : 'No shops match your search'}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {shops.length === 0
                        ? 'Check back later or ask your local print shop to sign up.'
                        : 'Try a different name or address.'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
                {filtered.map((shop) => (
                  <li key={shop.id}>
                    <ShopCard shop={shop} onClick={() => onShopClick(shop.slug)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-8">
          <div className="flex items-center gap-3">
            <div
              className="flex size-9 items-center justify-center rounded-lg bg-brand text-base font-bold text-brand-foreground"
              aria-hidden="true"
            >
              P
            </div>
            <div>
              <p className="font-semibold text-foreground">PrintShop SaaS</p>
              <p className="text-xs text-muted-foreground">
                QR-based print shop management · 0% commission · MIT licensed
              </p>
            </div>
          </div>
          <nav className="flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-1" aria-label="Footer">
            <Link href="/shop/login" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-1 hover:text-foreground">
              <Store className="size-3.5" aria-hidden="true" />
              Shopkeeper portal
            </Link>
            <Link href="/shop/register" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-1 hover:text-foreground">
              <ArrowRight className="size-3.5" aria-hidden="true" />
              Register a shop
            </Link>
            <a
              href="https://github.com/Arjunyadavsoma/printshop-saas"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-1 hover:text-foreground"
            >
              <Github className="size-3.5" aria-hidden="true" />
              Source code
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function ShopCard({ shop, onClick }: { shop: ShopListItem; onClick: () => void }) {
  const tierLabel = shop.subscriptionTier.charAt(0).toUpperCase() + shop.subscriptionTier.slice(1);
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      // Phase 6.3: removed aria-label to fix label-content-name-mismatch
      // (axe-core WCAG 2.2 AA). The visible shop name serves as the
      // accessible name — adding an aria-label that doesn't include ALL
      // visible text (pricing, badges) triggers the rule.
      className={cn(
        'group h-full cursor-pointer border-border bg-surface shadow-sm transition-all',
        'hover:-translate-y-0.5 hover:border-brand-border hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
    >
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Printer className="size-4 shrink-0 text-brand" aria-hidden="true" />
              <span className="truncate">{shop.name}</span>
            </h3>
            <p className="mt-1.5 flex items-start gap-1 text-xs text-muted-foreground">
              <MapPin className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              <span className="line-clamp-2">{shop.address}</span>
            </p>
          </div>
          <Badge variant="outline" className={cn('shrink-0', TIER_STYLES[shop.subscriptionTier])}>
            {tierLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-muted/60 p-2.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">B&amp;W / page</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {formatINRFromPaise(shop.pricingSummary.bwA4PerPage)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/60 p-2.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Colour / page</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {formatINRFromPaise(shop.pricingSummary.colorA4PerPage)}
            </p>
          </div>
        </div>
        <p className="mt-2 break-words text-xs tabular-nums text-muted-foreground">
          Min. order {formatINRFromPaise(shop.pricingSummary.minOrderValue)} · UPI {shop.upiId}
        </p>
      </CardContent>
      <CardFooter className="pt-0">
        <span className="inline-flex min-h-[28px] items-center gap-1 text-xs font-medium text-brand transition-all group-hover:gap-2">
          Visit shop
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </span>
      </CardFooter>
    </Card>
  );
}
