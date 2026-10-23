'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiClient } from '@/components/portal/use-api-client';
import { formatINRFromPaise } from '@platform/utils';
import {
  Search, MapPin, Printer, UploadCloud, ShieldCheck, Smartphone,
  Store, ArrowRight, Github, Sparkles, Loader2, AlertCircle,
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
  free: 'bg-zinc-200 text-zinc-800 border-zinc-300',
  starter: 'bg-amber-100 text-amber-900 border-amber-300',
  pro: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  enterprise: 'bg-violet-100 text-violet-900 border-violet-300',
};

const FEATURES = [
  {
    icon: UploadCloud,
    title: 'Upload from your phone',
    body: 'No app to install. Scan the shop QR, pick PDFs from your device, and pick print settings in seconds.',
  },
  {
    icon: ShieldCheck,
    title: 'Pay the shopkeeper directly',
    body: 'Money goes straight to the shopkeeper\u2019s UPI. Zero commission, zero middlemen, zero hidden fees.',
  },
  {
    icon: Smartphone,
    title: 'Track from upload to collection',
    body: 'Watch your order move from paid to printing to ready. Collect with a tap; your files auto-delete on collection.',
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
      setError(r.data?.error?.message ?? 'Could not load shops. Try again.');
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
    <div className="flex min-h-screen flex-col bg-background">
      {/* Hero */}
      <header className="border-b border-border bg-gradient-to-b from-amber-50 to-background">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-8 sm:gap-6 sm:px-6 sm:py-16 lg:py-20">
          <Badge variant="outline" className="border-amber-300 bg-amber-100/80 text-amber-900">
            <Sparkles className="h-3 w-3" />
            QR-powered print shops for India
          </Badge>
          <div className="max-w-3xl space-y-4">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
              Find a print shop, upload, and pay the shopkeeper directly.
            </h1>
            <p className="text-sm text-muted-foreground sm:text-lg">
              {'PrintShop is a customer portal for Indian print and Xerox shops. Scan a shop QR, upload your PDFs, set print options, and pay via UPI — with zero commission and files that auto-delete the moment you collect.'}
            </p>
            <div className="flex w-full flex-wrap items-center gap-3 pt-2 sm:w-auto">
              <Button size="lg" className="w-full sm:w-auto min-h-[44px]" onClick={() => document.getElementById('shop-discovery')?.scrollIntoView({ behavior: 'smooth' })}>
                <Search className="h-4 w-4" />
                Find a shop
              </Button>
            </div>
          </div>

          {/* Feature cards */}
          <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
            {FEATURES.map((f) => (
              <Card key={f.title} className="border-border shadow-sm">
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 text-white">
                    <f.icon className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{f.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{f.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </header>

      {/* Shop discovery */}
      <main className="flex-1">
        <section id="shop-discovery" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-14">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-3xl">
              Discover print shops
            </h2>
            <p className="text-sm text-muted-foreground">
              Browse active shops, compare pricing, and start an order in one tap.
            </p>
          </div>

          {/* Search bar */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder={'Search by shop name or address…'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-11 pl-9 sm:h-auto"
                aria-label="Search shops"
              />
            </div>
            <Button variant="outline" size="sm" className="w-full sm:w-auto min-h-[44px]" onClick={() => setQuery('')} disabled={!query}>
              Clear
            </Button>
          </div>

          {/* Shops grid */}
          <div className="mt-8">
            {loading ? (
              <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="border-border">
                    <CardContent className="flex flex-col gap-3 p-4">
                      <Skeleton className="h-5 w-2/3" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-3/4" />
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : error ? (
              <Card className="border-destructive/40 bg-destructive/5">
                <CardContent className="flex flex-col items-start gap-3 p-6">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-5 w-5" />
                    <span className="font-medium">Failed to load shops</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{error}</p>
                  <Button onClick={loadShops} size="sm" variant="outline">
                    <Loader2 className="h-4 w-4" />
                    Try again
                  </Button>
                </CardContent>
              </Card>
            ) : filtered.length === 0 ? (
              <Card className="border-dashed border-border">
                <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
                  <Store className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-foreground">
                      {shops.length === 0 ? 'No shops available yet' : 'No shops match your search'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {shops.length === 0
                        ? 'Check back later or ask your local print shop to sign up.'
                        : 'Try a different name or address.'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((shop) => (
                  <ShopCard key={shop.id} shop={shop} onClick={() => onShopClick(shop.slug)} />
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-8">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-600 font-bold text-white">
              P
            </div>
            <div>
              <p className="font-semibold text-foreground">PrintShop SaaS</p>
              <p className="text-xs text-muted-foreground">
                {'QR-based print shop management · 0% commission · MIT licensed'}
              </p>
            </div>
          </div>
          <nav className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
            <Link href="/shop/login" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <Store className="h-3.5 w-3.5" />
              Shopkeeper portal
            </Link>
            <Link href="/" className="inline-flex items-center gap-1.5 hover:text-foreground">
              <ArrowRight className="h-3.5 w-3.5" />
              Customer app
            </Link>
            <span className="inline-flex items-center gap-1.5">
              <Github className="h-3.5 w-3.5" />
              See README.md
            </span>
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
      className="group cursor-pointer border-border transition-all hover:-translate-y-0.5 hover:border-amber-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardHeader className="pb-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Printer className="h-4 w-4 shrink-0 text-amber-600" />
              <span className="truncate">{shop.name}</span>
            </h3>
            <p className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{shop.address}</span>
            </p>
          </div>
          <Badge variant="outline" className={`shrink-0 ${TIER_STYLES[shop.subscriptionTier]}`}>
            {tierLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-muted/60 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">B&W / page</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">
              {formatINRFromPaise(shop.pricingSummary.bwA4PerPage)}
            </p>
          </div>
          <div className="rounded-lg bg-muted/60 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Colour / page</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">
              {formatINRFromPaise(shop.pricingSummary.colorA4PerPage)}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] break-words text-muted-foreground">
          {'Min. order '}{formatINRFromPaise(shop.pricingSummary.minOrderValue)}{' · UPI '}{shop.upiId}
        </p>
      </CardContent>
      <CardFooter className="pt-0">
        <span className="inline-flex min-h-[28px] items-center gap-1 text-xs font-medium text-amber-700 transition-all group-hover:gap-2">
          Visit shop
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </CardFooter>
    </Card>
  );
}
