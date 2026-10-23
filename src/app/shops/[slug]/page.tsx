'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useApiClient } from '@/components/portal/use-api-client';
import { formatINRFromPaise } from '@platform/utils';
import type { ShopPricingConfig } from '@platform/core/domain';
import {
  Store, MapPin, Smartphone, CreditCard, ArrowLeft, ArrowRight, Loader2,
  AlertCircle, ShieldCheck, Printer, CheckCircle2,
} from 'lucide-react';

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  upiId: string;
  paymentProvider: string;
  pricingConfig: ShopPricingConfig;
  timezone: string;
  privacy: {
    filesPrivateByDefault: boolean;
    downloadUrlsExpireSeconds: number;
    autoDeleteAfterCollectSeconds: number;
    autoDeleteCronHours: number;
  };
}

interface CreateOrderResponse {
  orderId: string;
  customerToken: string;
  status: string;
  shop: { name: string; slug: string };
}

const PER_PAGE_KEYS: Array<{ key: keyof ShopPricingConfig; label: string }> = [
  { key: 'bw_a4_per_page', label: 'B&W · A4' },
  { key: 'color_a4_per_page', label: 'Colour · A4' },
  { key: 'bw_a3_per_page', label: 'B&W · A3' },
  { key: 'color_a3_per_page', label: 'Colour · A3' },
  { key: 'bw_letter_per_page', label: 'B&W · Letter' },
  { key: 'color_letter_per_page', label: 'Colour · Letter' },
  { key: 'bw_legal_per_page', label: 'B&W · Legal' },
  { key: 'color_legal_per_page', label: 'Colour · Legal' },
];

function pricingRows(cfg: ShopPricingConfig): Array<{ key: keyof ShopPricingConfig; label: string; paise: number }> {
  return PER_PAGE_KEYS.map(({ key, label }) => ({ key, label, paise: cfg[key] }));
}

const PRINT_OPTIONS = [
  { label: 'Copies', desc: '1 to 500 copies per file.' },
  { label: 'Colour or B&W', desc: 'Switch between monochrome and full colour per file.' },
  { label: 'Duplex (two-sided)', desc: 'Get a duplex discount when printing on both sides.' },
  { label: 'Paper size', desc: 'A4, A3, Letter, or Legal — whatever the shop supports.' },
  { label: 'Page range', desc: 'Print just the pages you need (e.g. 1-5, 8, 12-14).' },
];

export default function ShopDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const api = useApiClient();
  const router = useRouter();
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const loadShop = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await api.request<{ data?: ShopInfo; error?: { message?: string } }>('GET', `/api/v1/shops/${slug}`);
    if (r.status >= 400 || !r.data?.data) {
      setError(r.data?.error?.message ?? 'Shop not found.');
    } else {
      setShop(r.data.data);
    }
    setLoading(false);
  }, [api, slug]);

  useEffect(() => {
    if (!api.ready || !slug) return;
    void loadShop();
  }, [api.ready, slug, loadShop]);

  const startOrder = async () => {
    if (!shop) return;
    setCreating(true);
    setCreateError(null);
    const r = await api.request<{ data?: CreateOrderResponse; error?: { message?: string } }>(
      'POST',
      `/api/v1/shops/${shop.slug}/orders`,
      { body: {} },
    );
    setCreating(false);
    if (r.status >= 400 || !r.data?.data?.orderId) {
      setCreateError(r.data?.error?.message ?? 'Could not start an order. Try again.');
      return;
    }
    // SEC-001 fix: pass the order's customerToken via the ?t= query param so
    // the customer tracking page can authenticate to the (now token-gated)
    // /api/v1/orders/:id/* routes. The tracking page strips ?t= from the
    // URL after reading it into sessionStorage (so it doesn't leak via
    // history/referrer). Also pass the shop slug so the order page can
    // fetch the shop's pricing config for live client-side price estimates.
    const token = r.data.data.customerToken ?? '';
    const params = new URLSearchParams({
      shop: shop.slug,
      ...(token ? { t: token } : {}),
    });
    router.push(`/orders/${r.data.data.orderId}?${params.toString()}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header bar */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4 sm:h-16 sm:px-6">
          <Link href="/" className="inline-flex min-h-[44px] items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to shops
          </Link>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-600 font-bold text-white text-sm">P</div>
            <span className="text-sm font-semibold text-foreground">PrintShop</span>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-12">
          {loading ? (
            <ShopSkeleton />
          ) : error ? (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardContent className="flex flex-col items-start gap-3 p-6">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertCircle className="h-5 w-5" />
                  <span className="font-medium">Could not load shop</span>
                </div>
                <p className="text-sm text-muted-foreground">{error}</p>
                <div className="flex gap-2">
                  <Button onClick={loadShop} size="sm" variant="outline" className="min-h-[44px] flex-1 sm:flex-initial">
                    <Loader2 className="h-4 w-4" /> Try again
                  </Button>
                  <Button asChild size="sm" variant="ghost" className="min-h-[44px] flex-1 sm:flex-initial">
                    <Link href="/">Browse other shops</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : shop ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
              {/* Left: shop info + pricing */}
              <div className="flex flex-col gap-6">
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-900">
                        <Store className="h-3 w-3" /> Shop
                      </Badge>
                      {shop.paymentProvider && (
                        <Badge variant="secondary" className="capitalize">
                          <CreditCard className="h-3 w-3" /> {shop.paymentProvider}
                        </Badge>
                      )}
                    </div>
                    <CardTitle className="text-xl sm:text-2xl lg:text-3xl">{shop.name}</CardTitle>
                    <CardDescription className="flex items-start gap-1.5 pt-1">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{shop.timezone}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-lg bg-muted/60 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">UPI ID</p>
                        <p className="mt-1 break-words font-mono text-sm font-medium text-foreground">{shop.upiId}</p>
                      </div>
                      <div className="rounded-lg bg-muted/60 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Payment provider</p>
                        <p className="mt-1 text-sm font-medium text-foreground capitalize">{shop.paymentProvider}</p>
                      </div>
                    </div>
                    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                      <div className="flex items-center gap-2 font-medium">
                        <ShieldCheck className="h-4 w-4" />
                        Privacy
                      </div>
                      <p className="mt-1 leading-relaxed">
                        {'Files auto-delete '}{shop.privacy.autoDeleteAfterCollectSeconds}{'s after collection, and are swept nightly after '}{shop.privacy.autoDeleteCronHours}{'h regardless.'}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Pricing reference table */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Printer className="h-4 w-4 text-amber-600" />
                      Pricing reference
                    </CardTitle>
                    <CardDescription>Per-page rates. Final price is computed at checkout using the live pricing engine.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {/* On mobile: horizontal scroll. On >=sm: standard table. */}
                    <div className="overflow-x-auto rounded-lg border border-border sm:overflow-hidden">
                      <table className="w-full min-w-[280px] text-sm">
                        <thead className="bg-muted/60 text-xs">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Variant</th>
                            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Per page</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {pricingRows(shop.pricingConfig).map((row) => (
                            <tr key={row.key} className="odd:bg-background">
                              <td className="px-3 py-2 text-foreground">{row.label}</td>
                              <td className="px-3 py-2 text-right font-medium text-foreground">{formatINRFromPaise(row.paise)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <Separator className="my-4" />

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-sm">
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Duplex discount</p>
                        <p className="mt-0.5 font-medium text-foreground">{shop.pricingConfig.duplex_discount}% off</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bulk threshold</p>
                        <p className="mt-0.5 font-medium text-foreground">{'≥ '}{shop.pricingConfig.bulk_threshold} pages</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Bulk discount</p>
                        <p className="mt-0.5 font-medium text-foreground">{shop.pricingConfig.bulk_discount_pct}% off</p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {'Minimum order value: '}{formatINRFromPaise(shop.pricingConfig.min_order_value)}{'. Small orders are rounded up to the minimum.'}
                    </p>
                  </CardContent>
                </Card>

                {/* Print options supported */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Print options supported</CardTitle>
                    <CardDescription>Set these for each file during the order flow.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {PRINT_OPTIONS.map((o) => (
                        <li key={o.label} className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                          <div>
                            <p className="text-sm font-medium text-foreground">{o.label}</p>
                            <p className="text-xs text-muted-foreground">{o.desc}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </div>

              {/* Right: sticky action card */}
              <div className="lg:sticky lg:top-6 lg:h-fit">
                <Card className="border-amber-300">
                  <CardHeader>
                    <CardTitle className="text-lg">Start an order</CardTitle>
                    <CardDescription>Upload files, set print options, and pay via UPI. Zero commission.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-3 rounded-lg bg-muted/60 p-3">
                      <Smartphone className="h-5 w-5 shrink-0 text-amber-600" />
                      <p className="text-xs text-muted-foreground">
                        {'You\'ll upload your files on the next screen. Files auto-delete on collection.'}
                      </p>
                    </div>
                    {createError && (
                      <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{createError}</span>
                      </div>
                    )}
                  </CardContent>
                  <CardFooter>
                    <Button className="w-full min-h-[44px]" size="lg" onClick={startOrder} disabled={creating}>
                      {creating ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Starting…</>
                      ) : (
                        <>Start order <ArrowRight className="h-4 w-4" /></>
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              </div>
            </div>
          ) : null}
        </div>
      </main>

      <footer className="mt-auto border-t border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-6">
          <p>{'© PrintShop SaaS · 0% commission · pay the shopkeeper directly'}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-1">
            <Link href="/shop/login" className="hover:text-foreground">Shopkeeper portal</Link>
            <Link href="/admin/login" className="hover:text-foreground">Admin portal</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ShopSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-6">
        <Card>
          <CardContent className="flex flex-col gap-3 p-6">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-1/4" />
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-5 w-1/4" />
            <div className="mt-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
      <Card className="h-fit">
        <CardContent className="p-6">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="mt-2 h-4 w-3/4" />
          <Skeleton className="mt-4 h-32 w-full" />
          <Skeleton className="mt-4 h-10 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
