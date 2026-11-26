'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Store,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  User,
  Wrench,
  ClipboardCheck,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { validateShopLocation } from '@/lib/location/validation';
import { DetectLocationButton } from '@/components/clear/detect-location-button';

interface AccountStep {
  email: string;
  password: string;
  passwordConfirm: string;
  phone: string;
  name: string;
}
interface BusinessStep {
  shopName: string;
  slug: string;
  description: string;
  upiId: string;
  address: string;
  // Optional shop location — never required at registration; the
  // shopkeeper can add or change it later from Settings → Shop location.
  city: string;
  state: string;
  pincode: string;
  latitude: string;
  longitude: string;
  // Payment method selection during registration.
  // NOTE: 'split' (partial-UPI + partial-cash) was removed from the UI
  // (audit H6) — it was collected but never honored by the pricing /
  // checkout flow. The API zod enum still accepts 'split' for backward
  // compat with already-stored rows, but the UI no longer offers it.
  paymentMethods: 'upi' | 'cash' | 'both' | 'split';
  // Pamphlet / cover sheet — the fields stay on the type (and are sent
  // to the API as defaults) so the registration payload remains
  // compatible with the backend zod schema, but the UI no longer
  // collects them (audit H6: the feature was never implemented in the
  // pricing engine, so the collected values were dead). DB columns are
  // retained for backward compat with existing shops.
  pamphletEnabled: boolean;
  pamphletPricePaise: number;
  pamphletName: string;
}
type ServicesStep = string[];

interface WizardState {
  account: AccountStep;
  business: BusinessStep;
  services: ServicesStep;
}

const STORAGE_KEY = 'printshop_register_wizard';

const DEFAULT_STATE: WizardState = {
  account: { email: '', password: '', passwordConfirm: '', phone: '', name: '' },
  business: {
    shopName: '', slug: '', description: '', upiId: '', address: '',
    city: '', state: '', pincode: '', latitude: '', longitude: '',
    paymentMethods: 'both',
    pamphletEnabled: false,
    pamphletPricePaise: 1000, // ₹10 default
    pamphletName: 'Pamphlet / Cover Sheet',
  },
  services: ['bw_print', 'color_print'],
};

const SERVICE_OPTIONS: { key: string; label: string; description: string }[] = [
  { key: 'bw_print', label: 'B&W Printing', description: 'Black & white prints on A4 / Letter' },
  { key: 'color_print', label: 'Colour Printing', description: 'Full-colour prints on A4' },
  { key: 'a3_print', label: 'A3 Printing', description: 'Large-format prints (posters, plans)' },
  { key: 'scan', label: 'Scanning', description: 'Document scanning to PDF' },
  { key: 'laminate', label: 'Lamination', description: 'Laminating documents' },
  { key: 'binding', label: 'Binding', description: 'Spiral & comb binding' },
  { key: 'photo_print', label: 'Photo Prints', description: 'Photo-quality prints' },
  { key: 'document_print', label: 'Documents', description: 'Document printing + finishing' },
  { key: 'id_card', label: 'ID Cards', description: 'ID / visiting card printing' },
  { key: 'passport_photo', label: 'Passport Photos', description: 'Passport-size photo prints' },
];

const STEPS = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'business', label: 'Business', icon: Store },
  { id: 'services', label: 'Services', icon: Wrench },
  { id: 'review', label: 'Review', icon: ClipboardCheck },
] as const;

type StepId = (typeof STEPS)[number]['id'];

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function passwordStrength(p: string): { score: number; label: string; color: string } {
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[A-Z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent'];
  // Shopkeeper visual identity — steel-blue + blue-violet status palette.
  const colors = [
    'bg-[var(--shop-danger)]',
    'bg-[var(--shop-danger)]',
    'bg-[var(--shop-warning)]',
    'bg-[var(--shop-warning)]',
    'bg-[var(--shop-success)]',
    'bg-[var(--shop-success)]',
  ];
  return { score, label: labels[score] ?? 'Too short', color: colors[score] ?? 'bg-[var(--shop-danger)]' };
}

// Subscription-price note: this page says "no credit card, no commission"
// and states NO fee amount — deliberately. The codebase confirms only
// tier names (free/starter/pro/enterprise, packages/core enums) and the
// design PDF's Billing screen says "Flat monthly fee" with no ₹ amount
// anywhere. Do not invent a price here; a fee amount needs a product
// decision + a priced tier source first.
export default function ShopRegisterPage() {
  const api = useApiClient();
  const [step, setStep] = useState<StepId>('account');
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Slug uniqueness probe state.
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'taken' | 'ok' | 'invalid'>('idle');

  // Error-display gating (diagnosis §4.2 fix): validation errors are
  // computed from state as before, but NOTHING is shown on first paint.
  // A field's error appears only after the field is blurred, or after the
  // user tries to continue from that step. `canAdvance` still uses the
  // raw errors, so the Continue button stays disabled until the step is
  // actually valid.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState<Partial<Record<StepId, boolean>>>({});
  const markTouched = (field: string) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  const showErr = (stepId: StepId, field: string) => Boolean(attempted[stepId] || touched[field]);

  // Show/hide toggle shared by both password fields.
  const [showPassword, setShowPassword] = useState(false);

  // Auto-fill slug from shop name (until the user manually edits the slug field).
  const [slugTouched, setSlugTouched] = useState(false);

  // NOTE: The auto-redirect ("if already authed, redirect to dashboard") was
  // REMOVED — it caused a bounce with expired tokens (token in localStorage →
  // redirect to /shop/dashboard → 401 → dashboard shows "session expired").
  // A logged-in user who visits /shop/register can navigate to /shop/dashboard
  // manually. The layout's auth gate handles the redirect for valid tokens.

  // Hydrate from localStorage so a refresh doesn't lose progress.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<WizardState>;
        setState((prev) => ({
          account: { ...prev.account, ...(parsed.account ?? {}) },
          business: { ...prev.business, ...(parsed.business ?? {}) },
          services: parsed.services ?? prev.services,
        }));
      }
    } catch { /* ignore */ }

    // Auth-signup prefill (Screen 6): the consumer signup screen carries
    // its validated account fields via sessionStorage after the user taps
    // "Create Account". Apply them over the hydrated state and clear the
    // prefill so a later visit doesn't re-apply it. The wizard itself is
    // unchanged — same steps, same validation, same submit contract.
    try {
      const prefillRaw = sessionStorage.getItem('printelyx:signup-prefill');
      if (prefillRaw) {
        const pre = JSON.parse(prefillRaw) as { name?: string; email?: string; phone?: string; password?: string };
        setState((prev) => ({
          ...prev,
          account: {
            ...prev.account,
            name: pre.name ?? prev.account.name,
            email: pre.email ?? prev.account.email,
            phone: pre.phone ?? prev.account.phone,
            password: pre.password ?? prev.account.password,
            passwordConfirm: pre.password ?? prev.account.passwordConfirm,
          },
        }));
        sessionStorage.removeItem('printelyx:signup-prefill');
      }
    } catch { /* ignore */ }

    setHydrated(true);
  }, []);

  // Persist on every change (after hydration to avoid wiping).
  useEffect(() => {
    if (!hydrated) return;
    try {
      // SECURITY: strip password fields before persisting to localStorage.
      // Previously the FULL state (including password + passwordConfirm) was
      // saved to localStorage on every keystroke — a plaintext password leak.
      const { password, passwordConfirm, ...safeAccount } = state.account;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        account: safeAccount,
        business: state.business,
        services: state.services,
      }));
    } catch { /* ignore */ }
  }, [state, hydrated]);

  // Slug uniqueness probe — debounced.
  useEffect(() => {
    if (step !== 'business' && step !== 'review') return;
    const slug = state.business.slug.trim();
    if (!slug) { setSlugStatus('idle'); return; }
    if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 2) { setSlugStatus('invalid'); return; }
    setSlugStatus('checking');
    const t = setTimeout(async () => {
      try {
        const r = await api.request<{ data?: { available?: boolean; reason?: string } }>(
          'GET',
          `/api/v1/auth/register/check-slug?slug=${encodeURIComponent(slug)}`,
        );
        if (r.status === 200 && r.data?.data) {
          setSlugStatus(r.data.data.available ? 'ok' : 'taken');
        } else {
          setSlugStatus('idle');
        }
      } catch {
        setSlugStatus('idle');
      }
    }, 450);
    return () => clearTimeout(t);
  }, [state.business.slug, step, api]);

  // Auto-fill slug from shop name as the user types (only if they haven't manually edited it).
  useEffect(() => {
    if (!slugTouched && state.business.shopName) {
      setState((s) => ({ ...s, business: { ...s.business, slug: slugify(s.business.shopName) } }));
    }
  }, [state.business.shopName, slugTouched]);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  // ── Per-step validation ──
  const accountErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!state.account.email) errs.email = 'Email is required';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.account.email)) errs.email = 'Invalid email format';
    if (!state.account.password) errs.password = 'Password is required';
    else if (state.account.password.length < 8) errs.password = 'Password must be at least 8 characters';
    if (state.account.password !== state.account.passwordConfirm) errs.passwordConfirm = 'Passwords do not match';
    if (!state.account.phone) errs.phone = 'Phone is required';
    else if (!/^(\+91)?[6-9]\d{9}$/.test(state.account.phone.replace(/[\s-]/g, ''))) errs.phone = 'Invalid Indian mobile (+91XXXXXXXXXX)';
    if (!state.account.name.trim()) errs.name = 'Your name is required';
    return errs;
  }, [state.account]);

  const businessErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!state.business.shopName.trim()) errs.shopName = 'Shop name is required';
    const slug = state.business.slug.trim();
    if (!slug) errs.slug = 'Slug is required';
    else if (!/^[a-z0-9-]+$/.test(slug) || slug.length < 2) errs.slug = 'Lowercase letters, digits, hyphens only';
    else if (slugStatus === 'taken') errs.slug = `The URL "/${slug}" is already in use`;
    if (!state.business.upiId.trim()) errs.upiId = 'UPI ID is required';
    else if (!/^[\w.\-]{2,}@[a-zA-Z][\w.\-]*$/.test(state.business.upiId)) errs.upiId = 'Invalid UPI VPA (e.g. shop@okaxis)';
    // Location is optional — but a filled-in value must be valid; an
    // invalid PIN / coordinate blocks advancing until fixed or cleared.
    const locErrs = validateShopLocation({
      pincode: state.business.pincode,
      latitude: state.business.latitude,
      longitude: state.business.longitude,
    });
    if (locErrs.pincode) errs.pincode = locErrs.pincode;
    if (locErrs.latitude) errs.latitude = locErrs.latitude;
    if (locErrs.longitude) errs.longitude = locErrs.longitude;
    return errs;
  }, [state.business, slugStatus]);

  const servicesValid = state.services.length > 0;

  const canAdvance = (() => {
    if (step === 'account') return Object.keys(accountErrors).length === 0;
    if (step === 'business') return Object.keys(businessErrors).length === 0;
    if (step === 'services') return servicesValid;
    return true;
  })();

  const advance = () => {
    if (!canAdvance) {
      // Show this step's errors now that the user tried to continue.
      setAttempted((prev) => ({ ...prev, [step]: true }));
      return;
    }
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].id);
  };
  const back = () => {
    const idx = STEPS.findIndex((s) => s.id === step);
    if (idx > 0) setStep(STEPS[idx - 1].id);
  };

  const toggleService = (key: string) => {
    setState((s) => ({
      ...s,
      services: s.services.includes(key)
        ? s.services.filter((k) => k !== key)
        : [...s.services, key],
    }));
  };

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const r = await api.request<{
        data?: {
          accessToken?: string;
          refreshToken?: string;
          user?: { id: string; email: string; role: string; shopId: string };
          shop?: { id: string; name: string; slug: string };
        };
        error?: { code?: string; message?: string };
      }>('POST', '/api/v1/auth/register', {
        body: {
          email: state.account.email,
          password: state.account.password,
          phone: state.account.phone.replace(/[\s-]/g, ''),
          name: state.account.name,
          shopName: state.business.shopName,
          slug: state.business.slug,
          description: state.business.description,
          upiId: state.business.upiId,
          address: state.business.address,
          // Optional location — sent only when filled in; coordinates
          // typed here are unverified (locationVerified=false server-side).
          city: state.business.city.trim() || undefined,
          state: state.business.state.trim() || undefined,
          pincode: state.business.pincode.trim() || undefined,
          latitude: state.business.latitude.trim() === '' ? undefined : Number(state.business.latitude),
          longitude: state.business.longitude.trim() === '' ? undefined : Number(state.business.longitude),
          services: state.services,
          paymentMethods: state.business.paymentMethods,
          pamphletEnabled: state.business.pamphletEnabled,
          pamphletPricePaise: state.business.pamphletEnabled ? state.business.pamphletPricePaise : 0,
          pamphletName: state.business.pamphletEnabled ? state.business.pamphletName : null,
        },
      });
      const inner = r.data?.data;
      if ((r.status !== 200 && r.status !== 201) || !inner?.accessToken) {
        const msg = r.data?.error?.message ?? `Registration failed (HTTP ${r.status})`;
        setError(msg);
        // If slug/email conflict, jump to the right step.
        if (r.data?.error?.code === 'EMAIL_TAKEN') setStep('account');
        if (r.data?.error?.code === 'SLUG_TAKEN') setStep('business');
        return;
      }
      // Persist auth + redirect. Store BOTH access + refresh tokens (the old
      // code discarded the refresh token → 15min expiry with no refresh).
      api.setAuth(
        inner.accessToken,
        inner.refreshToken ?? '',
        inner.user?.role ?? 'owner',
        inner.user?.email ?? state.account.email,
      );
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      // Use a full-page navigation (not router.replace) to avoid any RSC
      // transition race — the new AuthContext is shared via React Context,
      // but a hard navigation guarantees the dashboard mounts fresh with the
      // new token already in localStorage + context state.
      window.location.href = '/shop/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──
  return (
    <div className="min-h-screen bg-[var(--shop-bg)] px-4 py-6 sm:py-8 lg:py-12">
      <div className="mx-auto w-full max-w-[640px] lg:max-w-[1024px] lg:grid lg:grid-cols-[280px_1fr] lg:gap-10">
        {/* Left hero column — desktop only (>=1024px). The form card sits
            in the right column on the same row. On tablet/mobile the form
            centers alone at max-w-[640px]. */}
        <aside className="hidden lg:flex lg:flex-col lg:py-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--shop-ink-2)] transition-colors hover:text-[var(--shop-accent)]"
          >
            ← Back to Printelyx
          </Link>
          <div className="mt-12 space-y-6">
            <div className="flex size-12 items-center justify-center rounded-xl bg-[var(--shop-accent)] text-white shadow-sm">
              <Store className="size-6" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--shop-ink-3)]">
                Printelyx for shops
              </p>
              <h1 className="mt-1 text-[26px] font-bold leading-tight text-[var(--shop-ink)]">
                Set up your print shop
              </h1>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--shop-ink-2)]">
                Get live in four quick steps — no credit card, no commission.
              </p>
            </div>
            <ul className="space-y-3 text-[14px] leading-relaxed text-[var(--shop-ink-2)]">
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--shop-accent)]" aria-hidden="true" />
                <span>Your public shop page and QR — instantly.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--shop-accent)]" aria-hidden="true" />
                <span>UPI payments straight to your bank.</span>
              </li>
              <li className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--shop-accent)]" aria-hidden="true" />
                <span>Manage orders, jobs and printers from one desktop dashboard.</span>
              </li>
            </ul>
          </div>
        </aside>

        {/* Right column — form card + mobile brand header + footer links */}
        <div className="space-y-4">
          {/* Mobile / tablet brand header (hidden on lg where the hero column shows) */}
          <div className="lg:hidden">
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--shop-ink-2)] transition-colors hover:text-[var(--shop-accent)]"
            >
              ← Back to Printelyx
            </Link>
            <div className="mt-4 flex flex-col items-center text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-[var(--shop-accent)] text-white shadow-sm">
                <Store className="size-6" />
              </div>
              <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--shop-ink-3)]">
                Printelyx for shops
              </p>
              <h1 className="mt-1 text-[22px] font-bold tracking-tight text-[var(--shop-ink)]">
                Start your print shop
              </h1>
              <p className="mt-1 text-[14px] text-[var(--shop-ink-2)]">
                Set up in four quick steps — no credit card, no commission.
              </p>
            </div>
          </div>

          {/* Wizard card — white surface on light neutral bg, 18px radius,
              subtle border + shadow. */}
          <div className="bg-[var(--shop-surface)] rounded-[18px] border border-[var(--shop-border)] shadow-sm p-6 lg:p-8">
            {/* Horizontal stepper — 4 labeled dots. Active + completed steps
                fill with the blue-violet accent; upcoming steps stay on the
                surface with muted text. The Progress bar is retired. */}
            <div className="mb-6 border-b border-[var(--shop-border)] pb-5">
              <div className="flex items-start justify-between">
                {STEPS.map((s, i) => {
                  const Icon = s.icon;
                  const active = s.id === step;
                  const done = i < stepIndex;
                  return (
                    <div key={s.id} className="flex flex-col items-center gap-2">
                      <div
                        className={`flex size-9 items-center justify-center rounded-full border text-xs font-bold transition-colors ${
                          active || done
                            ? 'border-[var(--shop-accent)] bg-[var(--shop-accent)] text-white'
                            : 'border-[var(--shop-border)] bg-[var(--shop-surface)] text-[var(--shop-ink-3)]'
                        }`}
                        aria-current={active ? 'step' : undefined}
                      >
                        {done ? <Check className="size-4" aria-hidden="true" /> : <Icon className="size-4" aria-hidden="true" />}
                      </div>
                      <span
                        className={`text-[11px] font-semibold ${
                          active
                            ? 'text-[var(--shop-ink)]'
                            : done
                              ? 'text-[var(--shop-ink-2)]'
                              : 'text-[var(--shop-ink-3)]'
                        }`}
                      >
                        {s.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Step content */}
            <div className="space-y-5">
              {step === 'account' && (
                <>
                  <div>
                    <h2 className="flex items-center gap-2 text-[22px] font-bold text-[var(--shop-ink)]">
                      <User className="size-5 text-[var(--shop-accent)]" aria-hidden="true" /> Account details
                    </h2>
                    <p className="mt-1 text-[14px] text-[var(--shop-ink-2)]">
                      Your sign-in credentials. The email becomes your login — pick something you check often.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      id="name"
                      label="Your name"
                      value={state.account.name}
                      onChange={(v) => setState((s) => ({ ...s, account: { ...s.account, name: v } }))}
                      onBlur={() => markTouched('name')}
                      error={showErr('account', 'name') ? accountErrors.name : undefined}
                      placeholder="e.g. Priya Sharma"
                      disabled={submitting}
                    />
                    <Field
                      id="phone"
                      label="Phone (Indian mobile)"
                      value={state.account.phone}
                      onChange={(v) => setState((s) => ({ ...s, account: { ...s.account, phone: v } }))}
                      onBlur={() => markTouched('phone')}
                      error={showErr('account', 'phone') ? accountErrors.phone : undefined}
                      placeholder="e.g. 98765 43210"
                      disabled={submitting}
                    />
                  </div>
                  <Field
                    id="email"
                    label="Email"
                    type="email"
                    value={state.account.email}
                    onChange={(v) => setState((s) => ({ ...s, account: { ...s.account, email: v } }))}
                    onBlur={() => markTouched('email')}
                    error={showErr('account', 'email') ? accountErrors.email : undefined}
                    placeholder="e.g. owner@myprintshop.com"
                    disabled={submitting}
                    autoComplete="email"
                  />
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Field
                        id="password"
                        label="Password"
                        type={showPassword ? 'text' : 'password'}
                        value={state.account.password}
                        onChange={(v) => setState((s) => ({ ...s, account: { ...s.account, password: v } }))}
                        onBlur={() => markTouched('password')}
                        error={showErr('account', 'password') ? accountErrors.password : undefined}
                        placeholder="e.g. MyShop@2026"
                        disabled={submitting}
                        autoComplete="new-password"
                        trailing={
                          <button
                            type="button"
                            onClick={() => setShowPassword((s) => !s)}
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            aria-controls="password"
                            className="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-[8px] text-[var(--shop-ink-3)] hover:bg-[var(--shop-bg)] hover:text-[var(--shop-ink)]"
                          >
                            {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                          </button>
                        }
                      />
                      <p className="text-[12px] text-[var(--shop-ink-3)]">At least 8 characters.</p>
                      {state.account.password && (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--shop-border)]">
                            <div
                              className={`h-full transition-all ${passwordStrength(state.account.password).color}`}
                              style={{ width: `${(passwordStrength(state.account.password).score / 5) * 100}%` }}
                            />
                          </div>
                          <span className="text-[12px] text-[var(--shop-ink-3)]">
                            {passwordStrength(state.account.password).label}
                          </span>
                        </div>
                      )}
                    </div>
                    <Field
                      id="passwordConfirm"
                      label="Confirm password"
                      type={showPassword ? 'text' : 'password'}
                      value={state.account.passwordConfirm}
                      onChange={(v) => setState((s) => ({ ...s, account: { ...s.account, passwordConfirm: v } }))}
                      onBlur={() => markTouched('passwordConfirm')}
                      error={showErr('account', 'passwordConfirm') ? accountErrors.passwordConfirm : undefined}
                      placeholder="e.g. MyShop@2026"
                      disabled={submitting}
                      autoComplete="new-password"
                      trailing={
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          aria-controls="passwordConfirm"
                          className="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-[8px] text-[var(--shop-ink-3)] hover:bg-[var(--shop-bg)] hover:text-[var(--shop-ink)]"
                        >
                          {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                        </button>
                      }
                    />
                  </div>
                </>
              )}

              {step === 'business' && (
                <>
                  <div>
                    <h2 className="flex items-center gap-2 text-[22px] font-bold text-[var(--shop-ink)]">
                      <Store className="size-5 text-[var(--shop-accent)]" aria-hidden="true" /> Business profile
                    </h2>
                    <p className="mt-1 text-[14px] text-[var(--shop-ink-2)]">
                      What customers see when they scan your shop QR.
                    </p>
                  </div>
                  {/* Shop name + URL slug side by side on >=640px */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      id="shopName"
                      label="Shop name"
                      value={state.business.shopName}
                      onChange={(v) => setState((s) => ({ ...s, business: { ...s.business, shopName: v } }))}
                      onBlur={() => markTouched('shopName')}
                      error={showErr('business', 'shopName') ? businessErrors.shopName : undefined}
                      placeholder="e.g. Sharma Xerox & Print Hub"
                      disabled={submitting}
                    />
                    <div className="space-y-1.5">
                      <Label htmlFor="slug" className="text-[14px] font-semibold text-[var(--shop-ink)]">
                        Shop URL slug
                      </Label>
                      <div className="flex items-center gap-2">
                        <code className="inline-flex h-11 shrink-0 items-center rounded-[10px] border border-[var(--shop-border)] bg-[var(--shop-bg)] px-2 text-[12px] tabular-nums text-[var(--shop-ink-3)]">
                          /shops/
                        </code>
                        <Input
                          id="slug"
                          value={state.business.slug}
                          onChange={(e) => {
                            setSlugTouched(true);
                            setState((s) => ({ ...s, business: { ...s.business, slug: e.target.value.toLowerCase() } }));
                          }}
                          onBlur={() => markTouched('slug')}
                          placeholder="e.g. sharma-print"
                          disabled={submitting}
                          className="h-11 flex-1 rounded-[10px] border-[var(--shop-border)] bg-[var(--shop-surface)] text-[14px] text-[var(--shop-ink)] placeholder:text-[var(--shop-ink-3)] focus:border-[var(--shop-accent)] focus-visible:border-[var(--shop-accent)] focus-visible:ring-[var(--shop-accent)]"
                        />
                      </div>
                      {slugStatus === 'checking' && (
                        <p className="flex items-center gap-1 text-[12px] text-[var(--shop-ink-3)]">
                          <Loader2 className="size-3 animate-spin" aria-hidden="true" /> Checking availability…
                        </p>
                      )}
                      {slugStatus === 'ok' && (
                        <p className="flex items-center gap-1 text-[12px] text-[var(--shop-success)]">
                          <CheckCircle2 className="size-3" aria-hidden="true" /> URL is available.
                        </p>
                      )}
                      {slugStatus === 'taken' && (
                        <p className="flex items-center gap-1 text-[12px] text-[var(--shop-danger)]">
                          <AlertCircle className="size-3" aria-hidden="true" /> This URL is already taken — pick another.
                        </p>
                      )}
                      {slugStatus === 'invalid' && (
                        <p className="text-[12px] text-[var(--shop-danger)]">Lowercase letters, digits and hyphens only.</p>
                      )}
                      {showErr('business', 'slug') && businessErrors.slug && slugStatus === 'idle' && (
                        <p className="text-[12px] text-[var(--shop-danger)]">{businessErrors.slug}</p>
                      )}
                      {state.business.slug && slugStatus !== 'invalid' && (
                        <p className="text-[12px] tabular-nums text-[var(--shop-ink-3)]">
                          Preview: /shops/{state.business.slug}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="description" className="text-[14px] font-semibold text-[var(--shop-ink)]">
                      Description (optional)
                    </Label>
                    <Textarea
                      id="description"
                      value={state.business.description}
                      onChange={(e) => setState((s) => ({ ...s, business: { ...s.business, description: e.target.value } }))}
                      placeholder="e.g. A short bio shown on your public shop page."
                      rows={3}
                      disabled={submitting}
                      maxLength={2000}
                      className="min-h-[88px] rounded-[10px] border-[var(--shop-border)] bg-[var(--shop-surface)] text-[14px] text-[var(--shop-ink)] placeholder:text-[var(--shop-ink-3)] focus:border-[var(--shop-accent)] focus-visible:border-[var(--shop-accent)] focus-visible:ring-[var(--shop-accent)]"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      id="upiId"
                      label="UPI ID (where customers pay you)"
                      value={state.business.upiId}
                      onChange={(v) => setState((s) => ({ ...s, business: { ...s.business, upiId: v } }))}
                      onBlur={() => markTouched('upiId')}
                      error={showErr('business', 'upiId') ? businessErrors.upiId : undefined}
                      placeholder="e.g. myshop@okaxis"
                      disabled={submitting}
                    />
                    <Field
                      id="address"
                      label="Address (optional)"
                      value={state.business.address}
                      onChange={(v) => setState((s) => ({ ...s, business: { ...s.business, address: v } }))}
                      onBlur={() => markTouched('address')}
                      error={undefined}
                      placeholder="e.g. Shop 12, MG Road, Bengaluru"
                      disabled={submitting}
                    />
                  </div>

                  {/* Optional location — helps customers find the shop. Never
                      required; invalid values are flagged, not silently kept. */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field
                      id="city"
                      label="City (optional)"
                      value={state.business.city}
                      onChange={(v) => setState((s) => ({ ...s, business: { ...s.business, city: v } }))}
                      onBlur={() => markTouched('city')}
                      error={undefined}
                      placeholder="e.g. Bengaluru"
                      disabled={submitting}
                    />
                    <Field
                      id="state"
                      label="State (optional)"
                      value={state.business.state}
                      onChange={(v) => setState((s) => ({ ...s, business: { ...s.business, state: v } }))}
                      onBlur={() => markTouched('state')}
                      error={undefined}
                      placeholder="e.g. Karnataka"
                      disabled={submitting}
                    />
                    <Field
                      id="pincode"
                      label="PIN code (optional)"
                      value={state.business.pincode}
                      onChange={(v) => setState((s) => ({ ...s, business: { ...s.business, pincode: v.replace(/\D/g, '').slice(0, 6) } }))}
                      onBlur={() => markTouched('pincode')}
                      error={showErr('business', 'pincode') ? businessErrors.pincode : undefined}
                      placeholder="e.g. 560001"
                      disabled={submitting}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Field
                      id="latitude"
                      label="Latitude (optional)"
                      value={state.business.latitude}
                      onChange={(v) => setState((s) => ({ ...s, business: { ...s.business, latitude: v } }))}
                      onBlur={() => markTouched('latitude')}
                      error={showErr('business', 'latitude') ? businessErrors.latitude : undefined}
                      placeholder="e.g. 12.9716"
                      disabled={submitting}
                    />
                    <Field
                      id="longitude"
                      label="Longitude (optional)"
                      value={state.business.longitude}
                      onChange={(v) => setState((s) => ({ ...s, business: { ...s.business, longitude: v } }))}
                      onBlur={() => markTouched('longitude')}
                      error={showErr('business', 'longitude') ? businessErrors.longitude : undefined}
                      placeholder="e.g. 77.5946"
                      disabled={submitting}
                    />
                  </div>
                  <div className="mt-1">
                    <DetectLocationButton
                      disabled={submitting}
                      onDetected={(loc) =>
                        setState((s) => ({
                          ...s,
                          business: {
                            ...s.business,
                            latitude: String(loc.lat.toFixed(6)),
                            longitude: String(loc.lng.toFixed(6)),
                          },
                        }))
                      }
                    />
                  </div>
                  <p className="text-[12px] leading-relaxed text-[var(--shop-ink-3)]">
                    Location is optional — leave it blank and add it later from Settings. Coordinates entered here are saved as unverified; use “Find on map” in Settings for verified coordinates. Detect location works only while you are at the shop — it fills in your device&apos;s current position.
                  </p>

                  {/* Payment method selection — audit H6: 'split' option removed
                      (was collected but never honored by the pricing/checkout
                      flow). The three remaining options cover every supported
                      payment path: 'upi' (online only), 'cash' (cash on pickup
                      only), 'both' (customer chooses at checkout). */}
                  <div className="space-y-2">
                    <Label className="text-[14px] font-semibold text-[var(--shop-ink-2)]">
                      Payment methods you accept
                    </Label>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {[
                        { val: 'upi', label: 'UPI only', desc: 'Online payment via UPI app' },
                        { val: 'cash', label: 'Cash only', desc: 'Pay at pickup' },
                        { val: 'both', label: 'UPI + Cash', desc: 'Customer chooses' },
                      ].map((opt) => {
                        const selected = state.business.paymentMethods === opt.val;
                        return (
                          <button
                            key={opt.val}
                            type="button"
                            onClick={() => setState((s) => ({ ...s, business: { ...s.business, paymentMethods: opt.val as 'upi' | 'cash' | 'both' | 'split' } }))}
                            className={`rounded-[10px] border p-3 text-center transition-colors ${
                              selected
                                ? 'border-[var(--shop-accent)] bg-[var(--shop-accent-soft)]'
                                : 'border-[var(--shop-border)] bg-[var(--shop-surface)] hover:border-[var(--shop-accent)]/40'
                            }`}
                          >
                            <p className={`text-[13px] font-semibold ${selected ? 'text-[var(--shop-accent-press)]' : 'text-[var(--shop-ink)]'}`}>
                              {opt.label}
                            </p>
                            <p className="mt-0.5 text-[12px] text-[var(--shop-ink-3)]">{opt.desc}</p>
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[12px] text-[var(--shop-ink-3)]">You can change this later from Settings → Payments. You can also skip payment provider setup (PhonePe/Paytm) — customers pay via your UPI ID + you verify manually.</p>
                  </div>

                  {/* Pamphlet / cover sheet — audit H6: the editable form was
                      removed (the feature was never implemented in the pricing
                      engine, so the collected price/name values were dead). The
                      database columns + API schema are kept for backward compat
                      with existing shops. The placeholder defaults are still
                      sent in the registration payload so the backend zod schema
                      doesn't reject the request. */}
                  <div className="space-y-2 rounded-[10px] border border-dashed border-[var(--shop-border)] bg-[var(--shop-bg)] p-3">
                    <div className="flex items-center gap-2">
                      <Label className="text-[12px] font-semibold text-[var(--shop-ink-2)]">Pamphlet / cover sheet</Label>
                      <Badge
                        variant="outline"
                        className="border-[var(--shop-border)] bg-[var(--shop-accent-soft)] text-[10px] font-semibold text-[var(--shop-accent-press)]"
                      >
                        Coming soon
                      </Badge>
                    </div>
                    <p className="text-[12px] text-[var(--shop-ink-3)]">A folder/cover where printed pages are kept. This feature isn&apos;t available yet &mdash; your shop will be created without it, and you&apos;ll be able to add it later from Settings once it&apos;s ready.</p>
                  </div>
                </>
              )}

              {step === 'services' && (
                <>
                  <div>
                    <h2 className="flex items-center gap-2 text-[22px] font-bold text-[var(--shop-ink)]">
                      <Wrench className="size-5 text-[var(--shop-accent)]" aria-hidden="true" /> Services you offer
                    </h2>
                    <p className="mt-1 text-[14px] text-[var(--shop-ink-2)]">
                      Pick at least one. You can change these later from Settings. The selected services appear on your public shop page.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SERVICE_OPTIONS.map((opt) => {
                      const checked = state.services.includes(opt.key);
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => toggleService(opt.key)}
                          aria-pressed={checked}
                          className={`flex items-start gap-2.5 rounded-[10px] border p-3 text-left transition-colors ${
                            checked
                              ? 'border-[var(--shop-accent)] bg-[var(--shop-accent-soft)]'
                              : 'border-[var(--shop-border)] bg-[var(--shop-surface)] hover:border-[var(--shop-accent)]/40'
                          }`}
                        >
                          <div
                            className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${
                              checked
                                ? 'border-[var(--shop-accent)] bg-[var(--shop-accent)] text-white'
                                : 'border-[var(--shop-border)]'
                            }`}
                          >
                            {checked && <Check className="size-3" aria-hidden="true" />}
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <span className={`text-[14px] font-semibold ${checked ? 'text-[var(--shop-accent-press)]' : 'text-[var(--shop-ink)]'}`}>
                              {opt.label}
                            </span>
                            <span className="text-[12px] text-[var(--shop-ink-3)]">{opt.description}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {state.services.length === 0 && (
                    <p className="text-[12px] text-[var(--shop-danger)]">Pick at least one service to continue.</p>
                  )}
                </>
              )}

              {step === 'review' && (
                <>
                  <div>
                    <h2 className="flex items-center gap-2 text-[22px] font-bold text-[var(--shop-ink)]">
                      <ClipboardCheck className="size-5 text-[var(--shop-accent)]" aria-hidden="true" /> Review &amp; create
                    </h2>
                    <p className="mt-1 text-[14px] text-[var(--shop-ink-2)]">
                      Confirm the details below. You can edit any of this later from Settings.
                    </p>
                  </div>

                  <ReviewBlock title="Account">
                    <ReviewRow label="Name" value={state.account.name} />
                    <ReviewRow label="Email" value={state.account.email} />
                    <ReviewRow label="Phone" value={state.account.phone} />
                  </ReviewBlock>
                  <ReviewBlock title="Business">
                    <ReviewRow label="Shop name" value={state.business.shopName} />
                    <ReviewRow label="URL" value={`/shops/${state.business.slug}`} />
                    <ReviewRow label="UPI ID" value={state.business.upiId} />
                    {state.business.address && <ReviewRow label="Address" value={state.business.address} />}
                    {state.business.city && <ReviewRow label="City" value={state.business.city} />}
                    {state.business.state && <ReviewRow label="State" value={state.business.state} />}
                    {state.business.pincode && <ReviewRow label="PIN code" value={state.business.pincode} />}
                    {(state.business.latitude || state.business.longitude) && (
                      <ReviewRow label="Coordinates" value={`${state.business.latitude}, ${state.business.longitude}`} />
                    )}
                    {state.business.description && <ReviewRow label="Description" value={state.business.description} />}
                  </ReviewBlock>
                  <ReviewBlock title="Services">
                    <div className="flex flex-wrap gap-1.5">
                      {state.services.map((k) => {
                        const opt = SERVICE_OPTIONS.find((o) => o.key === k);
                        return (
                          <Badge
                            key={k}
                            variant="outline"
                            className="border-[var(--shop-accent)]/30 bg-[var(--shop-accent-soft)] text-[12px] font-semibold text-[var(--shop-accent-press)]"
                          >
                            {opt?.label ?? k}
                          </Badge>
                        );
                      })}
                    </div>
                  </ReviewBlock>

                  {error && (
                    <div
                      role="alert"
                      className="rounded-[10px] border border-[var(--shop-danger)]/30 bg-[#FEF2F2] px-3 py-2 text-[14px] text-[var(--shop-danger)]"
                    >
                      {error}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer — sticky-feeling action row with Back + Continue/Submit */}
            <div className="mt-7 flex items-center justify-between gap-3 border-t border-[var(--shop-border)] pt-5">
              <Button
                type="button"
                size="sm"
                onClick={back}
                disabled={stepIndex === 0 || submitting}
                className="min-h-[44px] gap-1.5 rounded-[10px] border border-[var(--shop-border)] bg-white text-[14px] font-semibold text-[var(--shop-ink)] hover:bg-[var(--shop-bg)]"
              >
                <ArrowLeft className="size-4" aria-hidden="true" /> Back
              </Button>
              <div className="flex items-center gap-2">
                {step !== 'review' ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={advance}
                    disabled={!canAdvance || submitting}
                    className="min-h-[44px] gap-1.5 rounded-[10px] bg-[var(--shop-accent)] text-[14px] font-semibold text-white hover:bg-[var(--shop-accent-press)]"
                  >
                    Continue <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void submit()}
                    disabled={submitting}
                    className="min-h-[44px] gap-1.5 rounded-[10px] bg-[var(--shop-accent)] text-[14px] font-semibold text-white hover:bg-[var(--shop-accent-press)]"
                  >
                    {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Check className="size-4" aria-hidden="true" />}
                    {submitting ? 'Creating shop…' : 'Create my shop'}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <p className="text-center text-[12px] text-[var(--shop-ink-3)]">
            Already have an account?{' '}
            <Link href="/shop/login" className="font-semibold text-[var(--shop-accent)] hover:underline">
              Sign in
            </Link>
            {' · '}
            <Link href="/" className="font-semibold text-[var(--shop-accent)] hover:underline">
              Customer app
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  placeholder,
  type = 'text',
  disabled,
  autoComplete,
  trailing,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Marks the field touched so its error may be shown (blur-gating). */
  onBlur?: () => void;
  error?: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  autoComplete?: string;
  /** Optional trailing control (e.g. password show/hide eye). */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[14px] font-semibold text-[var(--shop-ink)]">
        {label}
      </Label>
      <div className={trailing ? 'relative' : undefined}>
        <Input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          className={`h-11 rounded-[10px] border-[var(--shop-border)] bg-[var(--shop-surface)] text-[14px] text-[var(--shop-ink)] placeholder:text-[var(--shop-ink-3)] focus:border-[var(--shop-accent)] focus-visible:border-[var(--shop-accent)] focus-visible:ring-[var(--shop-accent)] ${
            trailing ? 'pr-10' : ''
          }`}
        />
        {trailing}
      </div>
      {error && <p className="text-[12px] text-[var(--shop-danger)]">{error}</p>}
    </div>
  );
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-[var(--shop-border)] bg-[var(--shop-surface)] p-4">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--shop-ink-3)]">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[14px]">
      <span className="text-[var(--shop-ink-2)]">{label}</span>
      <span className="text-right font-semibold text-[var(--shop-ink)] break-words">{value}</span>
    </div>
  );
}
