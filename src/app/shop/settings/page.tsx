'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
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
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
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
  LogOut,
  ChevronRight,
  CircleHelp,
  FileBarChart,
  Users,
  Wrench,
  FileText,
  ScrollText,
} from 'lucide-react';
import { formatINRFromPaise } from '@platform/utils';
import type { ShopPricingConfig } from '@platform/core/domain';
import {
  validateShopLocation,
  parseLatitude,
  parseLongitude,
  openStreetMapUrl,
  openStreetMapEmbedUrl,
} from '@/lib/location/validation';
import { PaymentProviderSettings } from '@/components/portal/payment-provider-settings';
import { ChangePasswordCard } from '@/components/portal/change-password-card';
import { PageHeader } from '@/components/shared/page-header';
import { CardSkeleton } from '@/components/shared/loading-skeleton';

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
  // Shop location (optional — null until the shopkeeper sets it).
  fullAddress?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationVerified?: boolean;
  locationUpdatedAt?: string | null;
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

  // Spec screen 30 ordering-rules toggles. There are NO server fields
  // for these (no "manual printing from phones" / "hold unpaid orders"
  // columns on the shop, and PATCH /api/v1/shops/me does not accept
  // them), so they persist on this device only (localStorage) and say
  // so. Default ON, matching the PDF (all toggles shown ON).
  const [manualPhonePrinting, setManualPhonePrinting] = useState(true);
  const [holdUnpaid, setHoldUnpaid] = useState(true);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const m = window.localStorage.getItem('printshop:manual-phone-printing');
    if (m !== null) setManualPhonePrinting(m === '1');
    const h = window.localStorage.getItem('printshop:hold-unpaid-orders');
    if (h !== null) setHoldUnpaid(h === '1');
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('printshop:manual-phone-printing', manualPhonePrinting ? '1' : '0');
  }, [manualPhonePrinting]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('printshop:hold-unpaid-orders', holdUnpaid ? '1' : '0');
  }, [holdUnpaid]);

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
      // H16: deep-link to the security / change-password tab.
      security: 'security',
      // Location section lives on the Profile tab.
      location: 'profile',
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

  // ── Shop location ──
  // Kept as strings in the form (inputs are text); parsed + validated on
  // save with the shared validators in @/lib/location/validation. A
  // location is only "verified" when its coordinates came from a
  // successful geocode lookup — hand-typing lat/lng clears the flag.
  const [fullAddress, setFullAddress] = useState('');
  const [city, setCity] = useState('');
  const [locState, setLocState] = useState('');
  const [pincode, setPincode] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [locationVerified, setLocationVerified] = useState(false);
  const [locationUpdatedAt, setLocationUpdatedAt] = useState<string | null>(null);
  const [geocodedName, setGeocodedName] = useState<string | null>(null);
  const [savingLocation, setSavingLocation] = useState(false);
  const [locationSaved, setLocationSaved] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  // Errors from validateShopLocation, shown after a save/geocode attempt.
  const [locationFieldErrors, setLocationFieldErrors] = useState<Record<string, string>>({});
  // The coordinates currently on screen, parsed strictly (null = invalid).
  const parsedLat = parseLatitude(latitude);
  const parsedLng = parseLongitude(longitude);
  const coordsValid =
    (latitude.trim() === '' && longitude.trim() === '') ||
    (parsedLat !== null && parsedLng !== null);

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
        setFullAddress(s.fullAddress ?? s.address ?? '');
        setCity(s.city ?? '');
        setLocState(s.state ?? '');
        setPincode(s.pincode ?? '');
        setLatitude(s.latitude != null ? String(s.latitude) : '');
        setLongitude(s.longitude != null ? String(s.longitude) : '');
        setLocationVerified(s.locationVerified ?? false);
        setLocationUpdatedAt(s.locationUpdatedAt ?? null);
        setGeocodedName(null);
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

  // ── Save location (separate from the profile save so a location
  // problem never blocks saving the shop name / phone / address) ──
  // Goes through the same PATCH /api/v1/shops/me endpoint; the server
  // stamps locationUpdatedAt and forces locationVerified=false when no
  // coordinates are supplied.
  const saveLocation = async () => {
    const errors = validateShopLocation({ pincode, latitude, longitude });
    setLocationFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setLocationError('Fix the highlighted location fields before saving.');
      return;
    }
    setSavingLocation(true);
    setLocationError(null);
    setLocationSaved(false);
    try {
      const body: Record<string, unknown> = {
        fullAddress: fullAddress.trim() === '' ? null : fullAddress.trim(),
        city: city.trim() === '' ? null : city.trim(),
        state: locState.trim() === '' ? null : locState.trim(),
        pincode: pincode.trim() === '' ? null : pincode.trim(),
        latitude: latitude.trim() === '' ? null : parseLatitude(latitude),
        longitude: longitude.trim() === '' ? null : parseLongitude(longitude),
        // Only true when the coordinates on screen came from geocoding
        // (or were already verified and untouched since loading).
        locationVerified,
      };
      const r = await api.request<{ data?: ShopInfo; error?: { message?: string } }>(
        'PATCH',
        '/api/v1/shops/me',
        { body },
      );
      if (r.status !== 200 || !r.data?.data) {
        setLocationError(r.data?.error?.message ?? `Update failed (HTTP ${r.status}).`);
        return;
      }
      const s = r.data.data;
      setShop(s);
      setLocationVerified(s.locationVerified ?? false);
      setLocationUpdatedAt(s.locationUpdatedAt ?? null);
      setLocationSaved(true);
      setTimeout(() => setLocationSaved(false), 3000);
    } catch (err) {
      setLocationError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSavingLocation(false);
    }
  };

  // ── Geocode the address via Nominatim ──
  // On success the coordinates are filled in AND the location counts as
  // verified; on failure nothing is overwritten and the error names the
  // cause (no result / service down) so the shopkeeper can type the
  // coordinates manually instead.
  const geocodeAddress = async () => {
    const errors = validateShopLocation({ pincode });
    if (Object.keys(errors).length > 0) {
      setLocationFieldErrors(errors);
      setGeocodeError(errors.pincode ?? 'Fix the PIN code before looking up the address.');
      return;
    }
    setGeocoding(true);
    setGeocodeError(null);
    setLocationFieldErrors({});
    try {
      const r = await api.request<{
        data?: { latitude?: number; longitude?: number; displayName?: string };
        error?: { message?: string };
      }>('POST', '/api/v1/shop/location/geocode', {
        body: {
          address: fullAddress.trim(),
          city: city.trim(),
          state: locState.trim(),
          pincode: pincode.trim(),
        },
      });
      if (r.status !== 200 || !r.data?.data || r.data.data.latitude == null || r.data.data.longitude == null) {
        setGeocodeError(r.data?.error?.message ?? `Lookup failed (HTTP ${r.status}).`);
        return;
      }
      setLatitude(String(r.data.data.latitude));
      setLongitude(String(r.data.data.longitude));
      setLocationVerified(true);
      setGeocodedName(r.data.data.displayName ?? null);
    } catch (err) {
      setGeocodeError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setGeocoding(false);
    }
  };

  // Typing coordinates by hand can never leave the location "verified":
  // only a fresh geocode result (or an untouched verified save) counts.
  const onLatitudeChange = (v: string) => {
    setLatitude(v);
    if (locationVerified) setLocationVerified(false);
    setGeocodedName(null);
  };
  const onLongitudeChange = (v: string) => {
    setLongitude(v);
    if (locationVerified) setLocationVerified(false);
    setGeocodedName(null);
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
    // M21 fix: previously this used `window.open()` + `w.document.write()`
    // with the shop name + customer URL interpolated directly into the
    // HTML string. If the shop name contained `</script>` or other HTML,
    // it would be interpreted as markup (XSS) — and the opened window
    // inherits the opener's origin, so script execution had full access
    // to the parent app's localStorage (auth tokens).
    //
    // Now we open the print window with `noopener,noreferrer` (the
    // returned handle is null in some browsers, so we re-acquire the
    // document via the second argument to open() — that's the window
    // itself) and build the print document with safe DOM manipulation:
    // `document.createElement()` + `textContent` (NEVER innerHTML) so
    // the shop name and URL are treated as plain text, not HTML.
    //
    // The `noopener` feature also breaks the opener reference, so even if
    // a future bug let script run in the print window, it couldn't reach
    // back into the parent app's storage.
    const printWin = window.open('', '_blank', 'width=480,height=640,noopener,noreferrer');
    if (!printWin) {
      // Popup blocked — surface to the user instead of silently failing.
      console.warn('[printQr] popup blocked by browser');
      return;
    }
    const doc = printWin.document;

    // ── Build the print document entirely with safe DOM APIs ──
    doc.title = `Print QR — ${shop?.name ?? 'Shop'}`;

    // Body styles (no user data here, safe to set via textContent-style APIs)
    const style = doc.createElement('style');
    style.textContent = `
      html, body { margin: 0; padding: 0; }
      body {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        font-family: system-ui, -apple-system, sans-serif;
        color: #1f2937;
      }
      h1 { margin: 0 0 8px; font-size: 24px; font-weight: 600; }
      .sub { margin: 0 0 24px; color: #555; font-size: 14px; }
      .url { margin-top: 24px; color: #555; font-size: 12px; word-break: break-all; text-align: center; max-width: 320px; }
      img { width: 300px; height: 300px; }
    `;
    doc.head.appendChild(style);

    // Shop name — textContent, never innerHTML. If the shopkeeper named
    // their shop `<script>alert(1)</script>` this renders as literal text.
    const h1 = doc.createElement('h1');
    h1.textContent = shop?.name ?? 'Shop';
    doc.body.appendChild(h1);

    const sub = doc.createElement('p');
    sub.className = 'sub';
    sub.textContent = 'Scan to start an order';
    doc.body.appendChild(sub);

    // QR image — the src is a data: URL we generated server-side. Setting
    // it via setAttribute('src', ...) is safe (the value is a PNG base64
    // string we control, not user input). The alt text is also plain text.
    const img = doc.createElement('img');
    img.setAttribute('src', qr.pngDataUrl);
    img.setAttribute('alt', 'QR code for the shop order URL');
    doc.body.appendChild(img);

    const urlP = doc.createElement('p');
    urlP.className = 'url';
    // textContent — if the customer URL somehow contained HTML, it would
    // be rendered as text, not parsed as markup.
    urlP.textContent = qr.customerUrl ?? '';
    doc.body.appendChild(urlP);

    // Trigger print after the image has a chance to decode. Without this,
    // some browsers print a blank page because the data: URL image hasn't
    // loaded yet when print() fires synchronously.
    img.addEventListener('load', () => {
      printWin.focus();
      printWin.print();
    });
    // Fallback in case 'load' already fired (cached image) or fails.
    setTimeout(() => {
      try {
        printWin.focus();
        printWin.print();
      } catch {
        // Best-effort — the user can also Ctrl+P.
      }
    }, 250);
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Edit your shop profile, payment, and QR codes."
        />
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  if (error && !shop) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Edit your shop profile, payment, and QR codes."
        />
        <Card className="border-danger/30 bg-danger-soft">
          <CardHeader>
            <CardTitle className="text-base text-danger">Couldn't load shop settings</CardTitle>
            <CardDescription className="text-danger">{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void load()} variant="outline" size="sm" className="min-h-[44px] gap-1.5">
              <RefreshCw className="size-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!shop) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Settings"
        description="Edit your shop profile, business hours, pricing, payment, and QR codes."
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} className="min-h-[44px] gap-1.5">
            <RefreshCw className="size-4" /> Reload
          </Button>
        }
      />

      {error && (
        <Card className="border-brand/30 bg-brand-soft">
          <CardContent className="p-4 text-sm text-brand">⚠ {error}</CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex w-full gap-1 overflow-x-auto sm:flex-wrap">
          <TabsTrigger value="profile" className="gap-1.5">
            <Store className="size-3.5" aria-hidden="true" /> Profile
          </TabsTrigger>
          <TabsTrigger value="hours" className="gap-1.5">
            <Clock className="size-3.5" aria-hidden="true" /> Business Hours
          </TabsTrigger>
          <TabsTrigger value="payment" className="gap-1.5">
            <CreditCard className="size-3.5" aria-hidden="true" /> Payment
          </TabsTrigger>
          <TabsTrigger value="upi-qr" className="gap-1.5">
            <ImageIcon className="size-3.5" aria-hidden="true" /> UPI QR
          </TabsTrigger>
          <TabsTrigger value="shop-qr" className="gap-1.5">
            <QrCode className="size-3.5" aria-hidden="true" /> Shop QR
          </TabsTrigger>
          {/* H16: Security tab — change-password flow. */}
          <TabsTrigger value="security" className="gap-1.5">
            <Lock className="size-3.5" aria-hidden="true" /> Security
          </TabsTrigger>
        </TabsList>

        {/* ── Profile tab ── */}
        <TabsContent value="profile">
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Store className="size-4 text-brand" aria-hidden="true" /> Shop profile
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Changes here update what customers see when they scan your shop QR code.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">
                  <span className="flex items-center gap-1"><Store className="size-3.5" /> Shop name</span>
                </Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} disabled={savingProfile} className="h-11 sm:h-9" />
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
                  className="h-11 sm:h-9"
                />
                <p className="text-xs text-muted-foreground">
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
                    className="h-11 sm:h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="timezone">Timezone</Label>
                  <Select value={timezone} onValueChange={setTimezone}>
                    <SelectTrigger id="timezone" className="h-11 w-full sm:h-9"><SelectValue /></SelectTrigger>
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
                  className="h-11 sm:h-9"
                />
              </div>
              {profileError && <p className="text-sm text-danger">⚠ {profileError}</p>}
            </CardContent>
            <CardFooter className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:gap-2">
              <Button
                onClick={() => void saveProfile()}
                disabled={savingProfile}
                className="w-full min-h-[44px] gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90 sm:w-auto"
              >
                {savingProfile ? <Loader2 className="size-4 animate-spin" /> : profileSaved ? <Check className="size-4" /> : <Save className="size-4" />}
                {savingProfile ? 'Saving…' : profileSaved ? 'Saved' : 'Save changes'}
              </Button>
              <Badge variant="outline" className="gap-1 self-start sm:self-auto">
                <Tag className="size-3" /> tier: {shop.subscriptionTier}
              </Badge>
            </CardFooter>
          </Card>

          {/* Shop location — full address, city/state/PIN, coordinates.
              Saves through the same PATCH /api/v1/shops/me as the profile
              (its own Save button so a location error never blocks the
              profile save). Coordinates are optional; a location is only
              "verified" when it came from the map lookup below. */}
          <Card className="mt-4 bg-surface" id="location">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <MapPin className="size-4 text-brand" aria-hidden="true" /> Shop location
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Help customers find your shop. Everything here is optional — set as much as you like, and change it any time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullAddress">Full address</Label>
                <Input
                  id="fullAddress"
                  value={fullAddress}
                  onChange={(e) => setFullAddress(e.target.value)}
                  placeholder="e.g. Shop 12, 1st Floor, MG Road, Bengaluru"
                  disabled={savingLocation}
                  className="h-11 sm:h-9"
                />
                <p className="text-xs text-muted-foreground">
                  Shown to customers on your shop page and order tracking.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="city">City</Label>
                  <Input
                    id="city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder="e.g. Bengaluru"
                    disabled={savingLocation}
                    className="h-11 sm:h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="locState">State</Label>
                  <Input
                    id="locState"
                    value={locState}
                    onChange={(e) => setLocState(e.target.value)}
                    placeholder="e.g. Karnataka"
                    disabled={savingLocation}
                    className="h-11 sm:h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pincode">PIN code</Label>
                  <Input
                    id="pincode"
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="e.g. 560001"
                    inputMode="numeric"
                    disabled={savingLocation}
                    aria-invalid={Boolean(locationFieldErrors.pincode)}
                    className="h-11 sm:h-9"
                  />
                  {locationFieldErrors.pincode && (
                    <p className="text-xs text-danger">{locationFieldErrors.pincode}</p>
                  )}
                </div>
              </div>

              {/* Coordinates + map lookup */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="latitude">Latitude</Label>
                  <Input
                    id="latitude"
                    value={latitude}
                    onChange={(e) => onLatitudeChange(e.target.value)}
                    placeholder="e.g. 12.9716"
                    inputMode="decimal"
                    disabled={savingLocation}
                    aria-invalid={Boolean(locationFieldErrors.latitude)}
                    className="h-11 sm:h-9"
                  />
                  {locationFieldErrors.latitude && (
                    <p className="text-xs text-danger">{locationFieldErrors.latitude}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="longitude">Longitude</Label>
                  <Input
                    id="longitude"
                    value={longitude}
                    onChange={(e) => onLongitudeChange(e.target.value)}
                    placeholder="e.g. 77.5946"
                    inputMode="decimal"
                    disabled={savingLocation}
                    aria-invalid={Boolean(locationFieldErrors.longitude)}
                    className="h-11 sm:h-9"
                  />
                  {locationFieldErrors.longitude && (
                    <p className="text-xs text-danger">{locationFieldErrors.longitude}</p>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void geocodeAddress()}
                  disabled={geocoding || savingLocation}
                  className="min-h-[44px] gap-1.5"
                >
                  {geocoding ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
                  {geocoding ? 'Finding on map…' : 'Find on map'}
                </Button>
                {locationVerified ? (
                  <Badge variant="outline" className="gap-1 self-start border-success/30 bg-success-soft text-success sm:self-auto">
                    <CheckCircle2 className="size-3" /> Location verified
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {latitude.trim() || longitude.trim()
                      ? 'Coordinates entered by hand are saved as unverified.'
                      : 'Use “Find on map” to fill in verified coordinates from your address.'}
                  </span>
                )}
              </div>
              {geocodedName && (
                <p className="text-xs text-muted-foreground">
                  Matched: <span className="text-foreground">{geocodedName}</span> — check it looks right before saving.
                </p>
              )}
              {geocodeError && <p className="text-sm text-danger">⚠ {geocodeError}</p>}

              {/* Map preview — OpenStreetMap embed, no map library. */}
              {coordsValid && parsedLat !== null && parsedLng !== null && (
                <div className="space-y-1.5">
                  <iframe
                    title="Map preview of the shop location"
                    src={openStreetMapEmbedUrl(parsedLat, parsedLng)}
                    className="h-48 w-full rounded-md border border-border"
                    loading="lazy"
                  />
                  <p className="text-xs text-muted-foreground">
                    <a
                      href={openStreetMapUrl(parsedLat, parsedLng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-brand hover:underline"
                    >
                      Open in OpenStreetMap ↗
                    </a>
                    {' '}· {parsedLat.toFixed(5)}, {parsedLng.toFixed(5)}
                  </p>
                </div>
              )}

              {locationUpdatedAt && (
                <p className="text-xs text-muted-foreground">
                  Location last updated {new Date(locationUpdatedAt).toLocaleString('en-IN')}.
                </p>
              )}
              {locationError && <p className="text-sm text-danger">⚠ {locationError}</p>}
            </CardContent>
            <CardFooter className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:gap-2">
              <Button
                onClick={() => void saveLocation()}
                disabled={savingLocation || geocoding}
                className="w-full min-h-[44px] gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90 sm:w-auto"
              >
                {savingLocation ? <Loader2 className="size-4 animate-spin" /> : locationSaved ? <Check className="size-4" /> : <Save className="size-4" />}
                {savingLocation ? 'Saving…' : locationSaved ? 'Saved' : 'Save location'}
              </Button>
              {locationSaved && (
                <span className="text-xs font-medium text-success">✓ Location saved.</span>
              )}
            </CardFooter>
          </Card>

          {/* Pricing — editable per-shop prices (shopkeeper-controlled) */}
          <Card className="mt-4 bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <CreditCard className="size-4 text-brand" aria-hidden="true" /> Pricing & Print Services
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
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
                        <div key={String(key)} className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2">
                          <span className="text-sm font-medium text-muted-foreground">{label}</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-muted-foreground tabular-nums">₹</span>
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
                              className="h-11 text-base tabular-nums sm:h-9"
                              disabled={savingPricing}
                            />
                            <span className="text-xs text-muted-foreground">/ page</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Duplex discount + bulk discount + min order */}
                  <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2">
                      <span className="text-sm font-medium text-muted-foreground">Duplex discount (%)</span>
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
                        className="h-11 text-base tabular-nums sm:h-9"
                        disabled={savingPricing}
                      />
                    </div>
                    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2">
                      <span className="text-sm font-medium text-muted-foreground">Bulk threshold (pages)</span>
                      <Input
                        type="number"
                        step="1"
                        min="0"
                        value={pricingDraft.bulk_threshold}
                        onChange={(e) => {
                          const v = parseInt(e.target.value) || 0;
                          setPricingDraft((prev) => prev ? { ...prev, bulk_threshold: Math.max(0, v) } : prev);
                        }}
                        className="h-11 text-base tabular-nums sm:h-9"
                        disabled={savingPricing}
                      />
                    </div>
                    <div className="flex flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2">
                      <span className="text-sm font-medium text-muted-foreground">Bulk discount (%)</span>
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
                        className="h-11 text-base tabular-nums sm:h-9"
                        disabled={savingPricing}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-md border border-success/30 bg-success-soft px-3 py-2 text-sm">
                    <span className="text-success">Minimum order value</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-success tabular-nums">₹</span>
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
                        className="h-11 w-20 text-base tabular-nums sm:h-9"
                        disabled={savingPricing}
                      />
                    </div>
                  </div>

                  {/* Save + feedback */}
                  <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:gap-3">
                    <Button onClick={savePricing} disabled={savingPricing} size="sm" className="w-full min-h-[44px] gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90 sm:w-auto">
                      {savingPricing ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                      {savingPricing ? 'Saving…' : 'Save prices'}
                    </Button>
                    {pricingSaved && (
                      <span className="text-xs font-medium text-success">✓ Prices saved — customers see the new prices immediately.</span>
                    )}
                    {pricingError && (
                      <span className="text-xs font-medium text-danger">✗ {pricingError}</span>
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
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <Clock className="size-4 text-brand" aria-hidden="true" /> Business hours
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
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
                      sched.closed ? 'border-border bg-muted/40' : 'border-border bg-surface'
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
                      {sched.closed && <Badge variant="outline" className="text-xs">Closed</Badge>}
                    </div>
                    <div className={`flex items-center gap-2 ${sched.closed ? 'opacity-40' : ''}`}>
                      <Input
                        type="time"
                        value={sched.open}
                        onChange={(e) => setHours((h) => ({ ...h, [d.key]: { ...h[d.key], open: e.target.value } }))}
                        disabled={sched.closed}
                        className="h-11 w-full tabular-nums sm:flex-initial sm:w-28"
                        aria-label={`${d.label} opening time`}
                      />
                      <span className="text-xs text-muted-foreground">to</span>
                      <Input
                        type="time"
                        value={sched.close}
                        onChange={(e) => setHours((h) => ({ ...h, [d.key]: { ...h[d.key], close: e.target.value } }))}
                        disabled={sched.closed}
                        className="h-11 w-full tabular-nums sm:flex-initial sm:w-28"
                        aria-label={`${d.label} closing time`}
                      />
                    </div>
                  </div>
                );
              })}
              {hoursError && <p className="text-sm text-danger">⚠ {hoursError}</p>}
            </CardContent>
            <CardFooter className="border-t pt-4">
              <Button
                onClick={() => void saveHours()}
                disabled={savingHours}
                className="min-h-[44px] gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90"
              >
                {savingHours ? <Loader2 className="size-4 animate-spin" /> : hoursSaved ? <Check className="size-4" /> : <Save className="size-4" />}
                {savingHours ? 'Saving…' : hoursSaved ? 'Saved' : 'Save hours'}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* ── Payment tab ── */}
        <TabsContent value="payment">
          {/* Payment Provider Management (PhonePe / Paytm) — must be at the TOP of the tab. */}
          <PaymentProviderSettings />
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <CreditCard className="size-4 text-brand" aria-hidden="true" /> Payment settings
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Where customers pay you. The UPI ID is what they send money to.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="upiId">
                  <span className="flex items-center gap-1"><CreditCard className="size-3.5" aria-hidden="true" /> UPI ID</span>
                </Label>
                <Input
                  id="upiId"
                  value={upiId}
                  onChange={(e) => setUpiId(e.target.value)}
                  placeholder="myshop@okaxis"
                  disabled={savingPayment}
                  pattern="^[\w.\-]+@[\w.\-]+$"
                  className="h-11 text-base sm:h-9"
                />
                <p className="text-xs text-muted-foreground">
                  Customers pay directly to this UPI ID. 0% commission — money lands in your account instantly.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paymentPhone">
                  <span className="flex items-center gap-1"><Phone className="size-3.5" aria-hidden="true" /> Payment phone (for UPI verification)</span>
                </Label>
                <Input
                  id="paymentPhone"
                  value={paymentPhone}
                  onChange={(e) => setPaymentPhone(e.target.value)}
                  placeholder="+91…"
                  disabled={savingPayment}
                  className="h-11 text-base sm:h-9"
                />
                <p className="text-xs text-muted-foreground">
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
                <p className="text-xs text-muted-foreground">
                  Shown to the customer after they tap "I've paid" in the order flow.
                </p>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface p-3">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="cashOnPickup" className="text-sm font-medium">Cash on pickup</Label>
                  <span className="text-xs text-muted-foreground">
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
              {paymentError && <p className="text-sm text-danger">⚠ {paymentError}</p>}
            </CardContent>
            <CardFooter className="border-t pt-4">
              <Button
                onClick={() => void savePayment()}
                disabled={savingPayment}
                className="min-h-[44px] gap-1.5 bg-brand text-brand-foreground hover:bg-brand/90"
              >
                {savingPayment ? <Loader2 className="size-4 animate-spin" /> : paymentSaved ? <Check className="size-4" /> : <Save className="size-4" />}
                {savingPayment ? 'Saving…' : paymentSaved ? 'Saved' : 'Save payment'}
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        {/* ── UPI QR (uploaded image) tab ── */}
        <TabsContent value="upi-qr">
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <ImageIcon className="size-4 text-brand" aria-hidden="true" /> UPI Payment QR
              </CardTitle>
              <CardDescription className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Info className="size-3" aria-hidden="true" /> This is the PAYMENT QR — the one customers scan to send you money. Different from the shop-ordering QR (next tab).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
                <div className="flex size-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface p-2 sm:size-44">
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
                        className={`inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-md bg-brand px-4 text-sm font-medium text-brand hover:bg-brand/90 ${
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
                        className="min-h-[44px] gap-1.5"
                      >
                        <Trash2 className="size-4" /> Remove
                      </Button>
                    )}
                  </div>
                  {upiQrError && <p className="text-sm text-danger">⚠ {upiQrError}</p>}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Shop QR (ordering) tab ── */}
        <TabsContent value="shop-qr">
          <Card className="bg-surface">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold">
                <QrCode className="size-4 text-brand" aria-hidden="true" /> Shop Ordering QR
              </CardTitle>
              <CardDescription className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Info className="size-3" aria-hidden="true" /> Customers scan this to open your shop page, upload files, and pay. Generated automatically from your public URL.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
              <div className="flex size-32 shrink-0 items-center justify-center rounded-md border border-border bg-surface p-2 sm:size-44">
                {qr?.pngDataUrl ? (
                  <img src={qr.pngDataUrl} alt={`QR for ${shop.name}`} className="size-full object-contain" width={176} height={176} />
                ) : (
                  <div className="flex flex-col items-center gap-1 text-center text-xs text-muted-foreground">
                    <QrCode className="size-6" aria-hidden="true" />
                    QR unavailable
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-3">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Customer URL</p>
                  <code className="block break-all rounded bg-muted px-2 py-1.5 font-mono text-xs">
                    {qr?.customerUrl ?? `/${shop.slug}`}
                  </code>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void downloadShopQr('png')} className="min-h-[44px] gap-1.5">
                    <Download className="size-4" /> PNG
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void downloadShopQr('svg')} className="min-h-[44px] gap-1.5">
                    <Download className="size-4" /> SVG
                  </Button>
                  <Button variant="outline" size="sm" onClick={printQr} className="min-h-[44px] gap-1.5">
                    <Printer className="size-4" /> Print
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copyUrl()} className="min-h-[44px] gap-1.5">
                    <Copy className="size-4" /> Copy URL
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Security tab (H16) — change password + account security ── */}
        <TabsContent value="security" className="space-y-4">
          <ChangePasswordCard />
        </TabsContent>
      </Tabs>

      {/* ── Ordering rules (spec screen 30) ── */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Tag className="size-4 text-brand" aria-hidden="true" /> Ordering rules
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            How orders from phones are handled. These switches are saved on
            this device only — there is no server setting for them yet, so
            they do not change how the website treats orders.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex min-h-[48px] items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Manual printing from phones</p>
              <p className="text-xs text-muted-foreground">
                Let the shop print phone orders by hand instead of auto-dispatch.
              </p>
            </div>
            <Switch
              checked={manualPhonePrinting}
              onCheckedChange={setManualPhonePrinting}
              aria-label="Manual printing from phones"
            />
          </div>
          <div className="flex min-h-[48px] items-center justify-between gap-3 border-t pt-4">
            <div>
              <p className="text-sm font-medium">Hold unpaid orders</p>
              <p className="text-xs text-muted-foreground">
                Keep unpaid orders on hold instead of queueing them for print.
              </p>
            </div>
            <Switch
              checked={holdUnpaid}
              onCheckedChange={setHoldUnpaid}
              aria-label="Hold unpaid orders"
            />
          </div>
        </CardContent>
      </Card>

      {/* ── More (spec screen 34) — the mobile overflow menu, as a card.
          The bottom tab bar's "More" tab lands on this page, so the menu
          lives here. Audit log has no shopkeeper API (only the admin
          /api/v1/admin/audit exists), so it is honestly marked coming soon. */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Store className="size-4 text-brand" aria-hidden="true" /> More
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            Pricing, reports, customers, walk-ins, QR, billing and help.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <ul>
            {[
              { href: '/shop/services', label: 'Pricing', icon: <Wrench className="size-4" aria-hidden="true" /> },
              { href: '/shop/reports', label: 'Reports', icon: <FileBarChart className="size-4" aria-hidden="true" /> },
              { href: '/shop/customers', label: 'Customers', icon: <Users className="size-4" aria-hidden="true" /> },
              { href: '/shop/walk-in', label: 'Print a file', icon: <FileText className="size-4" aria-hidden="true" /> },
              { href: '/shop/qr-poster', label: 'QR poster', icon: <QrCode className="size-4" aria-hidden="true" /> },
              { href: '/shop/billing', label: 'Billing', icon: <CreditCard className="size-4" aria-hidden="true" /> },
              { href: '/help', label: 'Help', icon: <CircleHelp className="size-4" aria-hidden="true" /> },
            ].map((item) => (
              <li key={item.href} className="border-b last:border-b-0">
                <Link
                  href={item.href}
                  className="flex min-h-[48px] items-center gap-3 px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  <span className="text-muted-foreground">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
            <li className="flex min-h-[48px] items-center gap-3 px-4 py-2 text-sm">
              <span className="text-muted-foreground">
                <ScrollText className="size-4" aria-hidden="true" />
              </span>
              <span className="flex-1">
                Audit log
                <span className="block text-xs text-muted-foreground">
                  Coming soon — no shopkeeper audit API exists yet.
                </span>
              </span>
              <Badge variant="outline">Soon</Badge>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* ── Sign out (the Clear shell has no logout button) ── */}
      <Card className="bg-surface">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">Sign out</p>
            <p className="text-xs text-muted-foreground">
              Signed in as {shop?.name ?? 'shop owner'}.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="min-h-[44px] gap-1.5"
            onClick={async () => {
              await api.logout();
              window.location.href = '/shop/login';
            }}
          >
            <LogOut className="size-4" aria-hidden="true" /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
