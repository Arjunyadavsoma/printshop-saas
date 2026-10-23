'use client';

import { useCallback, useEffect, useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Clock,
  Image as ImageIcon,
  Upload,
  Trash2,
  Download,
  Printer,
  Copy,
  CheckCircle2,
  AlertCircle,
  Info,
} from 'lucide-react';
import { formatINRFromPaise } from '@platform/utils';
import type { ShopPricingConfig } from '@platform/core/domain';

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
  description: string | null;
  businessHours: string | null;
  logoUrl: string | null;
  upiQrStorageKey: string | null;
  hasUpiQr?: boolean;
  servicesJson: string | null;
  paymentPhone: string | null;
  paymentInstructions: string | null;
  cashOnPickup: boolean;
}

interface QrResponse {
  pngDataUrl: string;
  svgString?: string;
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

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

const TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Mumbai',
  'Asia/Delhi',
  'Asia/Calcutta',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Singapore',
  'UTC',
];

type DaySchedule = { open: string; close: string; closed: boolean };
type BusinessHours = Record<string, DaySchedule>;

function parseHours(json: string | null): BusinessHours {
  const fallback: BusinessHours = {
    mon: { open: '09:00', close: '21:00', closed: false },
    tue: { open: '09:00', close: '21:00', closed: false },
    wed: { open: '09:00', close: '21:00', closed: false },
    thu: { open: '09:00', close: '21:00', closed: false },
    fri: { open: '09:00', close: '21:00', closed: false },
    sat: { open: '10:00', close: '20:00', closed: false },
    sun: { open: '10:00', close: '16:00', closed: true },
  };
  if (!json) return fallback;
  try {
    const parsed = JSON.parse(json) as BusinessHours;
    // Merge with defaults so a partial save doesn't lose fields.
    const out: BusinessHours = { ...fallback };
    for (const d of DAYS) {
      if (parsed[d.key]) out[d.key] = { ...fallback[d.key], ...parsed[d.key] };
    }
    return out;
  } catch {
    return fallback;
  }
}

export default function ShopSettingsPage() {
  const api = useApiClient();
  const [shop, setShop] = useState<ShopInfo | null>(null);
  const [qr, setQr] = useState<QrResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('profile');

  // ── Deep-link support ────────────────────────────────────────────────
  // Allow /shop/settings#profile, #hours, #payment, #qr (or #upi-qr,
  // #shop-qr) to open the page directly on a specific tab. Purely
  // additive: if there's no hash (or it's unknown), the default
  // 'profile' tab is shown — exactly the old behavior. Runs ONCE on
  // mount so user-initiated tab clicks afterward are not overridden.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.location.hash.replace(/^#/, '').toLowerCase();
    if (!raw) return;
    // Map spec-friendly hashes to the internal tab values.
    const alias: Record<string, string> = {
      profile: 'profile',
      hours: 'hours',
      payment: 'payment',
      'upi-qr': 'upi-qr',
      'shop-qr': 'shop-qr',
      // Spec uses "#qr" → Shop QR Code tab (the actual "qr" is the
      // shop-ordering QR, not the UPI-QR upload).
      qr: 'shop-qr',
    };
    const mapped = alias[raw];
    if (mapped && mapped !== tab) setTab(mapped);
  }, []);

  // ── Profile form ──
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // ── Pricing (editable) ──
  const [pricingDraft, setPricingDraft] = useState<ShopPricingConfig | null>(null);
  const [savingPricing, setSavingPricing] = useState(false);
  const [pricingSaved, setPricingSaved] = useState(false);
  const [pricingError, setPricingError] = useState<string | null>(null);

  // ── Business hours ──
  const [hours, setHours] = useState<BusinessHours>(() => parseHours(null));
  const [savingHours, setSavingHours] = useState(false);
  const [hoursSaved, setHoursSaved] = useState(false);
  const [hoursError, setHoursError] = useState<string | null>(null);

  // ── Payment ──
  const [upiId, setUpiId] = useState('');
  const [paymentPhone, setPaymentPhone] = useState('');
  const [paymentInstructions, setPaymentInstructions] = useState('');
  const [cashOnPickup, setCashOnPickup] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentSaved, setPaymentSaved] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  // ── UPI QR (uploaded image) ──
  const [upiQrPreview, setUpiQrPreview] = useState<string | null>(null);
  const [upiQrUploading, setUpiQrUploading] = useState(false);
  const [upiQrError, setUpiQrError] = useState<string | null>(null);
  const [upiQrHasImage, setUpiQrHasImage] = useState(false);

  const load = useCallback(async () => {
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
        setDescription(s.description ?? '');
        setLogoUrl(s.logoUrl ?? '');
        setPhone(s.phone);
        setAddress(s.address);
        setTimezone(s.timezone || 'Asia/Kolkata');
        setHours(parseHours(s.businessHours));
        setUpiId(s.upiId);
        setPaymentPhone(s.paymentPhone ?? '');
        setPaymentInstructions(s.paymentInstructions ?? '');
        setCashOnPickup(s.cashOnPickup);
        setUpiQrHasImage(Boolean(s.upiQrStorageKey));
        setPricingDraft(s.pricingConfig);
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
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // Load the uploaded UPI QR preview (separate request — only when we have one).
  useEffect(() => {
    if (!shop?.upiQrStorageKey) {
      setUpiQrPreview(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/v1/shops/me/upi-qr', {
          headers: { Authorization: `Bearer ${api.token ?? ''}` },
        });
        if (cancelled) return;
        if (!res.ok) { setUpiQrPreview(null); return; }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setUpiQrPreview(url);
      } catch {
        setUpiQrPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shop?.upiQrStorageKey, api.token]);

  // ── Save handlers ──
  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description,
        logoUrl: logoUrl.trim(),
        phone,
        address,
        timezone,
      };
      const r = await api.request<{ data?: ShopInfo; error?: { message?: string } }>(
        'PATCH',
        '/api/v1/shops/me',
        { body },
      );
      if (r.status === 200 && r.data?.data) setShop(r.data.data);
      else {
        setProfileError(r.data?.error?.message ?? `Update failed (HTTP ${r.status}).`);
        return;
      }
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 3000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSavingProfile(false);
    }
  };

  const saveHours = async () => {
    setSavingHours(true);
    setHoursError(null);
    setHoursSaved(false);
    try {
      const body = { businessHours: JSON.stringify(hours) };
      const r = await api.request<{ data?: ShopInfo; error?: { message?: string } }>(
        'PATCH',
        '/api/v1/shops/me',
        { body },
      );
      if (r.status !== 200) {
        setHoursError(r.data?.error?.message ?? `Update failed (HTTP ${r.status}).`);
        return;
      }
      setHoursSaved(true);
      setTimeout(() => setHoursSaved(false), 3000);
    } catch (err) {
      setHoursError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSavingHours(false);
    }
  };

  // ── Save pricing (shopkeeper-controlled per-shop prices) ──
  // Calls PATCH /api/v1/shops/me with the updated pricingConfig. The server
  // validates via ShopPricingConfigSchema (Zod) — all values must be
  // non-negative integers (paise). The PATCH route is withAuth(['owner'])
  // + shop-scoped (repos.shops.getByOwner) — a shopkeeper can only update
  // their own shop's prices.
  const savePricing = async () => {
    if (!pricingDraft) return;
    setSavingPricing(true);
    setPricingError(null);
    setPricingSaved(false);
    try {
      const r = await api.request<{ data?: ShopInfo; error?: { message?: string } }>(
        'PATCH',
        '/api/v1/shops/me',
        { body: { pricingConfig: pricingDraft } },
      );
      if (r.status !== 200) {
        setPricingError(r.data?.error?.message ?? `Update failed (HTTP ${r.status}).`);
        return;
      }
      // Update the shop state with the saved pricing (so the UI reflects
      // what the server actually persisted, not just what the client sent).
      if (r.data?.data?.pricingConfig) {
        setPricingDraft(r.data.data.pricingConfig);
        setShop((prev) => prev ? { ...prev, pricingConfig: r.data!.data!.pricingConfig } : prev);
      }
      setPricingSaved(true);
      setTimeout(() => setPricingSaved(false), 3000);
    } catch (err) {
      setPricingError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSavingPricing(false);
    }
  };

  const savePayment = async () => {
    setSavingPayment(true);
    setPaymentError(null);
    setPaymentSaved(false);
    try {
      const body = {
        upiId: upiId.trim(),
        paymentPhone: paymentPhone.trim(),
        paymentInstructions,
        cashOnPickup,
      };
      const r = await api.request<{ data?: ShopInfo; error?: { message?: string } }>(
        'PATCH',
        '/api/v1/shops/me',
        { body },
      );
      if (r.status !== 200) {
        setPaymentError(r.data?.error?.message ?? `Update failed (HTTP ${r.status}).`);
        return;
      }
      if (r.data?.data) setShop(r.data.data);
      setPaymentSaved(true);
      setTimeout(() => setPaymentSaved(false), 3000);
    } catch (err) {
      setPaymentError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSavingPayment(false);
    }
  };

  // ── UPI QR upload ──
  const uploadQr = async (file: File) => {
    setUpiQrUploading(true);
    setUpiQrError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/v1/shops/me/upi-qr', {
        method: 'POST',
        headers: { Authorization: `Bearer ${api.token ?? ''}` },
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUpiQrError(json?.error?.message ?? `Upload failed (HTTP ${res.status})`);
        return;
      }
      setUpiQrHasImage(true);
      // Refresh the shop record so upiQrStorageKey is current; the preview
      // effect will re-fetch the image once the storage key changes.
      await load();
    } catch (err) {
      setUpiQrError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setUpiQrUploading(false);
    }
  };

  const removeQr = async () => {
    setUpiQrUploading(true);
    setUpiQrError(null);
    try {
      const res = await fetch('/api/v1/shops/me/upi-qr', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${api.token ?? ''}` },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setUpiQrError(json?.error?.message ?? `Delete failed (HTTP ${res.status})`);
        return;
      }
      setUpiQrHasImage(false);
      setUpiQrPreview(null);
      await load();
    } catch (err) {
      setUpiQrError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setUpiQrUploading(false);
    }
  };

  // ── Shop QR download (PNG / SVG) ──
  const downloadShopQr = async (format: 'png' | 'svg') => {
    if (!shop) return;
    const url = `/api/v1/shops/me/qr?format=${format}${format === 'svg' ? '&download=true' : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${api.token ?? ''}` } });
    if (!res.ok) return;
    if (format === 'png' && qr?.pngDataUrl) {
      // Use the already-loaded data URL (no second fetch).
      const a = document.createElement('a');
      a.href = qr.pngDataUrl;
      a.download = `${shop.slug}-qr.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = `${shop.slug}-qr.${format === 'svg' ? 'svg' : 'png'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  };

  const copyUrl = async () => {
    if (!qr?.customerUrl) return;
    try {
      await navigator.clipboard.writeText(qr.customerUrl);
    } catch { /* ignore */ }
  };

  const printQr = () => {
    if (!qr?.pngDataUrl) return;
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    w.document.write(`
      <html><head><title>Print QR — ${shop?.name ?? 'Shop'}</title></head>
      <body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:system-ui,sans-serif">
        <h1 style="margin:0 0 8px;font-size:24px">${shop?.name ?? 'Shop'}</h1>
        <p style="margin:0 0 24px;color:#555">Scan to start an order</p>
        <img src="${qr.pngDataUrl}" alt="QR" style="width:300px;height:300px" />
        <p style="margin-top:24px;color:#555;font-size:12px">${qr.customerUrl}</p>
      </body></html>
    `);
    w.document.close();
    w.focus();
    w.print();
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !shop) {
    return (
      <Card className="border-rose-200 bg-rose-50">
        <CardHeader>
          <CardTitle className="text-base text-rose-800">Couldn't load shop settings</CardTitle>
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
              Edit your shop profile, payment, and QR codes.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} className="gap-1.5">
          <RefreshCw className="size-4" /> Reload
        </Button>
      </div>

      {error && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-800">⚠ {error}</CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex w-full flex-wrap gap-1">
          <TabsTrigger value="profile" className="gap-1.5">
            <Store className="size-3.5" /> Profile
          </TabsTrigger>
          <TabsTrigger value="hours" className="gap-1.5">
            <Clock className="size-3.5" /> Business Hours
          </TabsTrigger>
          <TabsTrigger value="payment" className="gap-1.5">
            <CreditCard className="size-3.5" /> Payment
          </TabsTrigger>
          <TabsTrigger value="upi-qr" className="gap-1.5">
            <ImageIcon className="size-3.5" /> UPI QR
          </TabsTrigger>
          <TabsTrigger value="shop-qr" className="gap-1.5">
            <QrCode className="size-3.5" /> Shop QR
          </TabsTrigger>
        </TabsList>

        {/* ── Profile tab ── */}
        <TabsContent value="profile">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="size-4 text-amber-600" /> Shop profile
              </CardTitle>
              <CardDescription className="text-xs">
                Changes here update what customers see when they scan your shop QR code.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  <span className="flex items-center gap-1"><Store className="size-3.5" /> Shop name</span>
                </Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} disabled={savingProfile} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  disabled={savingProfile}
                  placeholder="A short bio shown on your public shop page."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="logoUrl">
                  <span className="flex items-center gap-1"><ImageIcon className="size-3.5" /> Logo URL</span>
                </Label>
                <Input
                  id="logoUrl"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="https://…/logo.png"
                  disabled={savingProfile}
                />
                <p className="text-[10px] text-muted-foreground">
                  Paste a public image URL. We don't host image uploads for the logo yet.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="phone">
                    <span className="flex items-center gap-1"><Phone className="size-3.5" /> Business phone</span>
                  </Label>
                  <Input
                    id="phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91…"
                    disabled={savingProfile}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger id="timezone"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="address">
                  <span className="flex items-center gap-1"><MapPin className="size-3.5" /> Address</span>
                </Label>
                <Input
                  id="address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  disabled={savingProfile}
                />
              </div>
              {profileError && <p className="text-sm text-rose-700">⚠ {profileError}</p>}
            </CardContent>
            <CardFooter className="flex items-center gap-2 border-t pt-4">
              <Button
                onClick={() => void saveProfile()}
                disabled={savingProfile}
                className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90"
              >
                {savingProfile ? <Loader2 className="size-4 animate-spin" /> : profileSaved ? <Check className="size-4" /> : <Save className="size-4" />}
                {savingProfile ? 'Saving…' : profileSaved ? 'Saved' : 'Save changes'}
              </Button>
              <Badge variant="outline" className="gap-1">
                <Tag className="size-3" /> tier: {shop.subscriptionTier}
              </Badge>
            </CardFooter>
          </Card>

          {/* Pricing — editable per-shop prices (shopkeeper-controlled) */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="size-4 text-amber-600" /> Pricing & Print Services
              </CardTitle>
              <CardDescription className="text-xs">
                Set your per-page prices. Customers see these exact prices when ordering. Prices are in paise (1 rupee = 100 paise) — enter the price in rupees and the system converts automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {pricingDraft ? (
                <>
                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    {PRICING_ROWS.map(({ key, label }) => {
                      const valuePaise = pricingDraft[key] as number;
                      const valueRupees = (valuePaise / 100).toFixed(2);
                      return (
                        <div key={String(key)} className="flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2">
                          <span className="text-muted-foreground">{label}</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground">₹</span>
                            <Input
                              type="number"
                              step="0.50"
                              min="0"
                              value={valueRupees}
                              onChange={(e) => {
                                const rupees = parseFloat(e.target.value);
                                const paise = isNaN(rupees) || rupees < 0 ? 0 : Math.round(rupees * 100);
                                setPricingDraft((prev) => prev ? { ...prev, [key]: paise } : prev);
                              }}
                              className="h-8 text-xs"
                              disabled={savingPricing}
                            />
                            <span className="text-[10px] text-muted-foreground">/ page</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Duplex discount + bulk discount + min order */}
                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                    <div className="flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2">
                      <span className="text-muted-foreground">Duplex discount (%)</span>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        value={pricingDraft.duplex_discount}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || 0;
                          setPricingDraft((prev) => prev ? { ...prev, duplex_discount: Math.max(0, Math.min(100, v)) } : prev);
                        }}
                        className="h-8 text-xs"
                        disabled={savingPricing}
                      />
                    </div>
                    <div className="flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2">
                      <span className="text-muted-foreground">Bulk threshold (pages)</span>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={pricingDraft.bulk_threshold}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || 0;
                          setPricingDraft((prev) => prev ? { ...prev, bulk_threshold: Math.max(0, v) } : prev);
                        }}
                        className="h-8 text-xs"
                        disabled={savingPricing}
                      />
                    </div>
                    <div className="flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2">
                      <span className="text-muted-foreground">Bulk discount (%)</span>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        max="100"
                        value={pricingDraft.bulk_discount_pct}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || 0;
                          setPricingDraft((prev) => prev ? { ...prev, bulk_discount_pct: Math.max(0, Math.min(100, v)) } : prev);
                        }}
                        className="h-8 text-xs"
                        disabled={savingPricing}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
                    <span className="text-emerald-800">Minimum order value</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-emerald-900">₹</span>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={(pricingDraft.min_order_value / 100).toFixed(2)}
                        onChange={(e) => {
                          const rupees = parseFloat(e.target.value);
                          const paise = isNaN(rupees) || rupees < 0 ? 0 : Math.round(rupees * 100);
                          setPricingDraft((prev) => prev ? { ...prev, min_order_value: paise } : prev);
                        }}
                        className="h-8 w-20 text-xs"
                        disabled={savingPricing}
                      />
                    </div>
                  </div>

                  {/* Save + feedback */}
                  <div className="flex items-center gap-3 pt-1">
                    <Button onClick={savePricing} disabled={savingPricing} size="sm" className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90">
                      {savingPricing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                      {savingPricing ? 'Saving…' : 'Save prices'}
                    </Button>
                    {pricingSaved && (
                      <span className="text-xs font-medium text-emerald-600">✓ Prices saved — customers see the new prices immediately.</span>
                    )}
                    {pricingError && (
                      <span className="text-xs font-medium text-destructive">✗ {pricingError}</span>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading pricing configuration…
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Business hours tab ── */}
        <TabsContent value="hours">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4 text-amber-600" /> Business hours
              </CardTitle>
              <CardDescription className="text-xs">
                Set your weekly schedule. Toggle a day off if you're closed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {DAYS.map((d) => {
                const sched = hours[d.key];
                return (
                  <div
                    key={d.key}
                    className={`flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between ${
                      sched.closed ? 'border-border bg-muted/40' : 'border-border bg-card'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={!sched.closed}
                        onCheckedChange={(checked) =>
                          setHours((h) => ({ ...h, [d.key]: { ...h[d.key], closed: !checked } }))
                        }
                        aria-label={`Open on ${d.label}`}
                      />
                      <span className="text-sm font-medium">{d.label}</span>
                      {sched.closed && <Badge variant="outline" className="text-[10px]">Closed</Badge>}
                    </div>
                    <div className={`flex items-center gap-2 ${sched.closed ? 'opacity-40' : ''}`}>
                      <Input
                        type="time"
                        value={sched.open}
                        onChange={(e) => setHours((h) => ({ ...h, [d.key]: { ...h[d.key], open: e.target.value } }))}
                        disabled={sched.closed}
                        className="w-28"
                        aria-label={`${d.label} opening time`}
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input
                        type="time"
                        value={sched.close}
                        onChange={(e) => setHours((h) => ({ ...h, [d.key]: { ...h[d.key], close: e.target.value } }))}
                        disabled={sched.closed}
                        className="w-28"
                        aria-label={`${d.label} closing time`}
                      />
                    </div>
                  </div>
                );
              })}
              {hoursError && <p className="text-sm text-rose-700">⚠ {hoursError}</p>}
            </CardContent>
            <CardFooter className="border-t pt-4">
              <Button
                onClick={() => void saveHours()}
                disabled={savingHours}
                className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90"
              >
                {savingHours ? <Loader2 className="size-4 animate-spin" /> : hoursSaved ? <Check className="size-4" /> : <Save className="size-4" />}
                {savingHours ? 'Saving…' : hoursSaved ? 'Saved' : 'Save hours'}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* ── Payment tab ── */}
        <TabsContent value="payment">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="size-4 text-amber-600" /> Payment settings
              </CardTitle>
              <CardDescription className="text-xs">
                Where customers pay you. The UPI ID is what they send money to.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="upiId">
                  <span className="flex items-center gap-1"><CreditCard className="size-3.5" /> UPI ID</span>
                </Label>
                <Input
                  id="upiId"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="myshop@okaxis"
                  disabled={savingPayment}
                  pattern="^[\w.\-]+@[\w.\-]+$"
                />
                <p className="text-[10px] text-muted-foreground">
                  Customers pay directly to this UPI ID. 0% commission — money lands in your account instantly.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paymentPhone">
                  <span className="flex items-center gap-1"><Phone className="size-3.5" /> Payment phone (for UPI verification)</span>
                </Label>
                <Input
                  id="paymentPhone"
                  value={paymentPhone}
                  onChange={(e) => setPaymentPhone(e.target.value)}
                  placeholder="+91…"
                  disabled={savingPayment}
                />
                <p className="text-[10px] text-muted-foreground">
                  Separate from the business phone — used only for verifying customer UPI payments.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paymentInstructions">Payment instructions</Label>
                <Textarea
                  id="paymentInstructions"
                  value={paymentInstructions}
                  onChange={(e) => setPaymentInstructions(e.target.value)}
                  rows={3}
                  disabled={savingPayment}
                  placeholder="e.g. Send screenshot of payment to WhatsApp +91…"
                />
                <p className="text-[10px] text-muted-foreground">
                  Shown to the customer after they tap "I've paid" in the order flow.
                </p>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-3">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="cashOnPickup" className="text-sm">Cash on pickup</Label>
                  <span className="text-[10px] text-muted-foreground">
                    Allow customers to pay in cash when they collect the order (you still need UPI configured for online payment).
                  </span>
                </div>
                <Switch
                  id="cashOnPickup"
                  checked={cashOnPickup}
                  onCheckedChange={setCashOnPickup}
                  disabled={savingPayment}
                />
              </div>
              {paymentError && <p className="text-sm text-rose-700">⚠ {paymentError}</p>}
            </CardContent>
            <CardFooter className="border-t pt-4">
              <Button
                onClick={() => void savePayment()}
                disabled={savingPayment}
                className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90"
              >
                {savingPayment ? <Loader2 className="size-4 animate-spin" /> : paymentSaved ? <Check className="size-4" /> : <Save className="size-4" />}
                {savingPayment ? 'Saving…' : paymentSaved ? 'Saved' : 'Save payment'}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* ── UPI QR (uploaded image) tab ── */}
        <TabsContent value="upi-qr">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="size-4 text-amber-600" /> UPI Payment QR
              </CardTitle>
              <CardDescription className="flex items-center gap-1.5 text-xs">
                <Info className="size-3" /> This is the PAYMENT QR — the one customers scan to send you money. Different from the shop-ordering QR (next tab).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
                <div className="flex size-44 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-white p-2">
                  {upiQrPreview ? (
                    <img src={upiQrPreview} alt="UPI payment QR" className="size-full object-contain" />
                  ) : upiQrHasImage ? (
                    <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                      Loading…
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground">
                      <ImageIcon className="size-6" />
                      No QR uploaded yet
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Upload the QR image you generated from your UPI app (GPay/PhonePe/Paytm). Max 5 MB. PNG / JPG / WebP / SVG.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <label>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="sr-only"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadQr(f);
                          e.target.value = '';
                        }}
                        disabled={upiQrUploading}
                      />
                      <span
                        className={`inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-amber-600 px-4 text-sm font-medium text-white hover:bg-amber-600/90 ${
                          upiQrUploading ? 'opacity-50' : ''
                        }`}
                      >
                        {upiQrUploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                        {upiQrHasImage ? 'Replace QR' : 'Upload QR'}
                      </span>
                    </label>
                    {upiQrHasImage && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void removeQr()}
                        disabled={upiQrUploading}
                        className="gap-1.5"
                      >
                        <Trash2 className="size-4" /> Remove
                      </Button>
                    )}
                  </div>
                  {upiQrError && <p className="text-sm text-rose-700">⚠ {upiQrError}</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Shop QR (ordering) tab ── */}
        <TabsContent value="shop-qr">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <QrCode className="size-4 text-amber-600" /> Shop Ordering QR
              </CardTitle>
              <CardDescription className="flex items-center gap-1.5 text-xs">
                <Info className="size-3" /> Customers scan this to open your shop page, upload files, and pay. Generated automatically from your public URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
              <div className="flex size-44 shrink-0 items-center justify-center rounded-md border border-border bg-white p-2">
                {qr?.pngDataUrl ? (
                  <img src={qr.pngDataUrl} alt={`QR for ${shop.name}`} className="size-full object-contain" width={176} height={176} />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground">
                    <QrCode className="size-6" />
                    QR unavailable
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-3">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Customer URL</p>
                  <code className="block break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
                    {qr?.customerUrl ?? `/${shop.slug}`}
                  </code>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void downloadShopQr('png')} className="gap-1.5">
                    <Download className="size-4" /> PNG
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void downloadShopQr('svg')} className="gap-1.5">
                    <Download className="size-4" /> SVG
                  </Button>
                  <Button variant="outline" size="sm" onClick={printQr} className="gap-1.5">
                    <Printer className="size-4" /> Print
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copyUrl()} className="gap-1.5">
                    <Copy className="size-4" /> Copy URL
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
