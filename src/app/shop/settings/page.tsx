'use client';

import { useEffect, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatINRFromPaise } from '@platform/utils';
import type { ShopPricingConfig } from '@platform/core/domain';
import {
  Settings as SettingsIcon,
  RefreshCw,
  Loader2,
  Save,
  Check,
  QrCode,
  Store,
  Phone,
  MapPin,
  CreditCard,
  Tag,
  Lock,
} from 'lucide-react';

interface ShopInfo {
  id: string;
  name: string;
  slug: string;
  upiId: string;
  paymentProvider: string;
  pricingConfig: ShopPricingConfig;
  address: string;
  phone: string;
  timezone: string;
  isActive: boolean;
  subscriptionTier: string;
  subscriptionExpiresAt: string | null;
}

interface QrResponse {
  pngDataUrl: string;
  customerUrl: string;
  slug: string;
  shopName?: string;
}

const PRICING_ROWS: { key: keyof ShopPricingConfig; label: string }[] = [
  { key: 'bw_a4_per_page', label: 'B&W · A4 per page' },
  { key: 'color_a4_per_page', label: 'Colour · A4 per page' },
  { key: 'bw_a3_per_page', label: 'B&W · A3 per page' },
  { key: 'color_a3_per_page', label: 'Colour · A3 per page' },
  { key: 'bw_letter_per_page', label: 'B&W · Letter per page' },
  { key: 'color_letter_per_page', label: 'Colour · Letter per page' },
  { key: 'bw_legal_per_page', label: 'B&W · Legal per page' },
  { key: 'color_legal_per_page', label: 'Colour · Legal per page' },
];

export default function ShopSettingsPage() {
  const api = useApiClient();
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Editable form state — only the safe PATCH-able fields.
  const [name, setName] = useState('');
  const [upiId, setUpiId] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // QR code preview (PNG data URL).
  const [qr, setQr] = useState<QrResponse | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [shopR, qrR] = await Promise.all([
        api.request<{ data?: ShopInfo }>('GET', '/api/v1/shops/me'),
        api.request<{ data?: QrResponse }>('GET', '/api/v1/shops/me/qr?format=png'),
      ]);
      if (shopR.status === 200 && shopR.data?.data) {
        const s = shopR.data.data;
        setShop(s);
        setName(s.name);
        setUpiId(s.upiId);
        setAddress(s.address);
        setPhone(s.phone);
      } else if (shopR.status === 401) {
        setError('Session expired. Please log in again.');
      } else {
        setError('Could not load shop info.');
      }
      if (qrR.status === 200 && qrR.data?.data) {
        setQr(qrR.data.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setSaving(true);
    setFormError(null);
    setSaved(false);
    try {
      const body: Record<string, string> = {};
      if (name.trim() && name !== shop?.name) body.name = name.trim();
      if (upiId.trim() && upiId !== shop?.upiId) body.upiId = upiId.trim();
      if (address !== shop?.address) body.address = address;
      if (phone !== shop?.phone) body.phone = phone;

      if (Object.keys(body).length === 0) {
        setFormError('No changes to save.');
        return;
      }

      const r = await api.request<{ data?: ShopInfo; error?: { message?: string } }>(
        'PATCH',
        '/api/v1/shops/me',
        { body },
      );
      if (r.status === 200 && r.data?.data) {
        setShop(r.data.data);
        setName(r.data.data.name);
        setUpiId(r.data.data.upiId);
        setAddress(r.data.data.address);
        setPhone(r.data.data.phone);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setFormError(r.data?.error?.message ?? `Update failed (HTTP ${r.status}).`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error && !shop) {
    return (
      <Card className="border-rose-200 bg-rose-50">
        <CardHeader>
          <CardTitle className="text-base text-rose-800">Couldn’t load shop settings</CardTitle>
          <CardDescription className="text-rose-700">{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void load()} variant="outline" size="sm">
            <RefreshCw className="size-4" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!shop) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <SettingsIcon className="size-5 text-amber-600" />
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Settings</h1>
            <p className="text-xs text-muted-foreground">
              Edit your shop profile and download your customer-facing QR code.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} className="gap-1.5">
          <RefreshCw className="size-4" /> Reload
        </Button>
      </div>

      {error && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-800">
            ⚠ {error}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Editable profile */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="size-4 text-amber-600" />
              Shop profile
            </CardTitle>
            <CardDescription className="text-xs">
              Changes here update what customers see when they scan your QR code.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">
                <span className="flex items-center gap-1">
                  <Store className="size-3.5" /> Shop name
                </span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Print Shop"
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="upiId">
                <span className="flex items-center gap-1">
                  <CreditCard className="size-3.5" /> UPI ID
                </span>
              </Label>
              <Input
                id="upiId"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="myshop@okaxis"
                disabled={saving}
                pattern="^[\w.\-]+@[\w.\-]+$"
              />
              <p className="text-[10px] text-muted-foreground">
                Customers pay directly to this UPI ID. 0% commission — money lands in your account
                instantly.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="address">
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5" /> Address
                </span>
              </Label>
              <Input
                id="address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Shop 12, MG Road, Bengaluru"
                disabled={saving}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">
                <span className="flex items-center gap-1">
                  <Phone className="size-3.5" /> Phone
                </span>
              </Label>
              <Input
                id="phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91…"
                disabled={saving}
              />
            </div>
            {formError && (
              <p className="text-sm text-rose-700">⚠ {formError}</p>
            )}
          </CardContent>
          <CardFooter className="flex items-center gap-2">
            <Button
              onClick={() => void save()}
              disabled={saving}
              className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : saved ? (
                <Check className="size-4" />
              ) : (
                <Save className="size-4" />
              )}
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
            </Button>
            <Badge variant="outline" className="gap-1">
              <Tag className="size-3" /> tier: {shop.subscriptionTier}
            </Badge>
          </CardFooter>
        </Card>

        {/* QR code preview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="size-4 text-amber-600" />
              Customer QR code
            </CardTitle>
            <CardDescription className="text-xs">
              Customers scan this to open your shop page, upload files, and pay.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            {qr?.pngDataUrl ? (
              <img
                src={qr.pngDataUrl}
                alt={`QR code for ${shop.name}`}
                className="size-44 rounded-md border border-border bg-white p-2"
                width={176}
                height={176}
              />
            ) : (
              <div className="flex size-44 items-center justify-center rounded-md border border-dashed border-border bg-muted text-xs text-muted-foreground">
                QR unavailable
              </div>
            )}
            <div className="w-full space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Customer URL
              </p>
              <code className="block break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
                {qr?.customerUrl ?? `/${shop.slug}`}
              </code>
            </div>
            <div className="w-full space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Slug
              </p>
              <code className="block rounded bg-muted px-2 py-1.5 font-mono text-xs">
                {shop.slug}
              </code>
            </div>
          </CardContent>
          <CardFooter>
            <a
              href={qr?.pngDataUrl}
              download={`${shop.slug}-qr.png`}
              className="text-xs text-amber-700 underline-offset-2 hover:underline"
            >
              Download PNG →
            </a>
          </CardFooter>
        </Card>
      </div>

      {/* Pricing config (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="size-4 text-amber-600" />
            Pricing configuration
          </CardTitle>
          <CardDescription className="text-xs flex items-center gap-1.5">
            <Lock className="size-3" />
            Read-only — the pricing engine in <code className="font-mono">packages/core</code> is the
            single source of truth. Changes here are made through code or the admin portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Setting</TableHead>
                <TableHead>Value (paise)</TableHead>
                <TableHead>Per page (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PRICING_ROWS.map(({ key, label }) => {
                const valuePaise = shop.pricingConfig[key] as number;
                return (
                  <TableRow key={String(key)}>
                    <TableCell className="pl-4 text-sm">{label}</TableCell>
                    <TableCell className="font-mono text-sm">{valuePaise}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatINRFromPaise(valuePaise)}
                    </TableCell>
                  </TableRow>
                );
              })}
              <TableRow>
                <TableCell className="pl-4 text-sm">Duplex discount (%)</TableCell>
                <TableCell className="font-mono text-sm">{shop.pricingConfig.duplex_discount}</TableCell>
                <TableCell className="text-xs text-muted-foreground">applied to duplex jobs</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4 text-sm">Bulk threshold (pages)</TableCell>
                <TableCell className="font-mono text-sm">{shop.pricingConfig.bulk_threshold}</TableCell>
                <TableCell className="text-xs text-muted-foreground">above this, bulk discount applies</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4 text-sm">Bulk discount (%)</TableCell>
                <TableCell className="font-mono text-sm">{shop.pricingConfig.bulk_discount_pct}</TableCell>
                <TableCell className="text-xs text-muted-foreground">applied once threshold met</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="pl-4 text-sm">Minimum order value</TableCell>
                <TableCell className="font-mono text-sm">{shop.pricingConfig.min_order_value}</TableCell>
                <TableCell className="font-mono text-sm">
                  {formatINRFromPaise(shop.pricingConfig.min_order_value)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
