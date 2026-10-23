'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
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
} from 'lucide-react';

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
  business: { shopName: '', slug: '', description: '', upiId: '', address: '' },
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
  const colors = ['bg-rose-500', 'bg-rose-500', 'bg-amber-500', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-600'];
  return { score, label: labels[score] ?? 'Too short', color: colors[score] ?? 'bg-rose-500' };
}

export default function ShopRegisterPage() {
  const api = useApiClient();
  const [step, setStep] = useState<StepId>('account');
  const [state, setState] = useState<WizardState>(DEFAULT_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Slug uniqueness probe state.
  const [slugStatus, setSlugStatus] = useState<'idle' | 'checking' | 'taken' | 'ok' | 'invalid'>('idle');

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
    setHydrated(true);
  }, []);

  // Persist on every change (after hydration to avoid wiping).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

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
    if (!canAdvance) return;
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
          services: state.services,
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-50 via-background to-background px-4 py-8">
      <div className="w-full max-w-2xl">
        {/* Brand */}
        <div className="mb-5 flex flex-col items-center text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-amber-600 text-white shadow-sm">
            <Store className="size-6" />
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">Start your print shop</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set up your shop in four quick steps — no credit card, no commission.
          </p>
        </div>

        {/* Progress */}
        <Card className="border-border shadow-sm">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {STEPS.map((s, i) => {
                  const Icon = s.icon;
                  const active = s.id === step;
                  const done = i < stepIndex;
                  return (
                    <div key={s.id} className="flex items-center gap-1.5">
                      <div
                        className={`flex size-7 items-center justify-center rounded-full border text-[11px] font-semibold transition-colors sm:size-8 ${
                          active
                            ? 'border-amber-500 bg-amber-600 text-white'
                            : done
                              ? 'border-emerald-400 bg-emerald-100 text-emerald-700'
                              : 'border-border bg-card text-muted-foreground'
                        }`}
                        aria-current={active ? 'step' : undefined}
                      >
                        {done ? <Check className="size-3.5" /> : <Icon className="size-3.5" />}
                      </div>
                      <span className={`hidden text-xs font-medium sm:inline ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {s.label}
                      </span>
                      {i < STEPS.length - 1 && (
                        <span className="hidden h-px w-6 bg-border sm:inline-block" aria-hidden />
                      )}
                    </div>
                  );
                })}
              </div>
              <Badge variant="outline" className="text-[10px]">
                Step {stepIndex + 1} of {STEPS.length}
              </Badge>
            </div>
            <Progress value={progress} className="mt-3 h-1.5" />
          </CardHeader>

          {/* Step content */}
          <CardContent className="space-y-4">
            {step === 'account' && (
              <>
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="size-4 text-amber-600" /> Account details
                </CardTitle>
                <CardDescription className="text-xs">
                  Your sign-in credentials. The email becomes your login — pick something you check often.
                </CardDescription>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    id="name"
                    label="Your name"
                    value={state.account.name}
                    onChange={(v) => setState((s) => ({ ...s, account: { ...s.account, name: v } }))}
                    error={accountErrors.name}
                    placeholder="Priya Sharma"
                    disabled={submitting}
                  />
                  <Field
                    id="phone"
                    label="Phone (Indian mobile)"
                    value={state.account.phone}
                    onChange={(v) => setState((s) => ({ ...s, account: { ...s.account, phone: v } }))}
                    error={accountErrors.phone}
                    placeholder="+919876543210"
                    disabled={submitting}
                  />
                </div>
                <Field
                  id="email"
                  label="Email"
                  type="email"
                  value={state.account.email}
                  onChange={(v) => setState((s) => ({ ...s, account: { ...s.account, email: v } }))}
                  error={accountErrors.email}
                  placeholder="owner@myprintshop.com"
                  disabled={submitting}
                  autoComplete="email"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Field
                      id="password"
                      label="Password"
                      type="password"
                      value={state.account.password}
                      onChange={(v) => setState((s) => ({ ...s, account: { ...s.account, password: v } }))}
                      error={accountErrors.password}
                      placeholder="At least 8 characters"
                      disabled={submitting}
                      autoComplete="new-password"
                    />
                    {state.account.password && (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className={`h-full transition-all ${passwordStrength(state.account.password).color}`}
                            style={{ width: `${(passwordStrength(state.account.password).score / 5) * 100}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {passwordStrength(state.account.password).label}
                        </span>
                      </div>
                    )}
                  </div>
                  <Field
                    id="passwordConfirm"
                    label="Confirm password"
                    type="password"
                    value={state.account.passwordConfirm}
                    onChange={(v) => setState((s) => ({ ...s, account: { ...s.account, passwordConfirm: v } }))}
                    error={accountErrors.passwordConfirm}
                    placeholder="Re-enter password"
                    disabled={submitting}
                    autoComplete="new-password"
                  />
                </div>
              </>
            )}

            {step === 'business' && (
              <>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Store className="size-4 text-amber-600" /> Business profile
                </CardTitle>
                <CardDescription className="text-xs">
                  What customers see when they scan your shop QR.
                </CardDescription>
                <Field
                  id="shopName"
                  label="Shop name"
                  value={state.business.shopName}
                  onChange={(v) => setState((s) => ({ ...s, business: { ...s.business, shopName: v } }))}
                  error={businessErrors.shopName}
                  placeholder="Sharma Xerox & Print Hub"
                  disabled={submitting}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="slug">Shop URL slug</Label>
                  <div className="flex items-center gap-2">
                    <code className="rounded-md border border-border bg-muted px-2 py-2 text-xs text-muted-foreground">
                      /shops/
                    </code>
                    <Input
                      id="slug"
                      value={state.business.slug}
                      onChange={(e) => {
                        setSlugTouched(true);
                        setState((s) => ({ ...s, business: { ...s.business, slug: e.target.value.toLowerCase() } }));
                      }}
                      placeholder="sharma-print"
                      disabled={submitting}
                      className="flex-1"
                    />
                  </div>
                  {slugStatus === 'checking' && (
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" /> Checking availability…
                    </p>
                  )}
                  {slugStatus === 'ok' && (
                    <p className="flex items-center gap-1 text-[11px] text-emerald-700">
                      <CheckCircle2 className="size-3" /> URL is available.
                    </p>
                  )}
                  {slugStatus === 'taken' && (
                    <p className="flex items-center gap-1 text-[11px] text-rose-700">
                      <AlertCircle className="size-3" /> This URL is already taken — pick another.
                    </p>
                  )}
                  {slugStatus === 'invalid' && (
                    <p className="text-[11px] text-rose-700">Lowercase letters, digits and hyphens only.</p>
                  )}
                  {businessErrors.slug && slugStatus === 'idle' && (
                    <p className="text-[11px] text-rose-700">{businessErrors.slug}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Textarea
                    id="description"
                    value={state.business.description}
                    onChange={(e) => setState((s) => ({ ...s, business: { ...s.business, description: e.target.value } }))}
                    placeholder="A short bio shown on your public shop page."
                    rows={3}
                    disabled={submitting}
                    maxLength={2000}
                  />
                </div>
                <Field
                  id="upiId"
                  label="UPI ID (where customers pay you)"
                  value={state.business.upiId}
                  onChange={(v) => setState((s) => ({ ...s, business: { ...s.business, upiId: v } }))}
                  error={businessErrors.upiId}
                  placeholder="myshop@okaxis"
                  disabled={submitting}
                />
                <Field
                  id="address"
                  label="Address (optional)"
                  value={state.business.address}
                  onChange={(v) => setState((s) => ({ ...s, business: { ...s.business, address: v } }))}
                  placeholder="Shop 12, MG Road, Bengaluru"
                  disabled={submitting}
                />
              </>
            )}

            {step === 'services' && (
              <>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Wrench className="size-4 text-amber-600" /> Services you offer
                </CardTitle>
                <CardDescription className="text-xs">
                  Pick at least one. You can change these later from Settings. The selected services appear on your public shop page.
                </CardDescription>
                <div className="grid gap-2 sm:grid-cols-2">
                  {SERVICE_OPTIONS.map((opt) => {
                    const checked = state.services.includes(opt.key);
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => toggleService(opt.key)}
                        aria-pressed={checked}
                        className={`flex items-start gap-2.5 rounded-md border p-3 text-left transition-colors ${
                          checked
                            ? 'border-amber-400 bg-amber-50'
                            : 'border-border bg-card hover:bg-muted'
                        }`}
                      >
                        <div
                          className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border ${
                            checked ? 'border-amber-600 bg-amber-600 text-white' : 'border-border'
                          }`}
                        >
                          {checked && <Check className="size-3" />}
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium">{opt.label}</span>
                          <span className="text-[11px] text-muted-foreground">{opt.description}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {state.services.length === 0 && (
                  <p className="text-xs text-rose-700">Pick at least one service to continue.</p>
                )}
              </>
            )}

            {step === 'review' && (
              <>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ClipboardCheck className="size-4 text-amber-600" /> Review &amp; create
                </CardTitle>
                <CardDescription className="text-xs">
                  Confirm the details below. You can edit any of this later from Settings.
                </CardDescription>

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
                  {state.business.description && <ReviewRow label="Description" value={state.business.description} />}
                </ReviewBlock>
                <ReviewBlock title="Services">
                  <div className="flex flex-wrap gap-1.5">
                    {state.services.map((k) => {
                      const opt = SERVICE_OPTIONS.find((o) => o.key === k);
                      return (
                        <Badge key={k} variant="outline" className="bg-amber-50">
                          {opt?.label ?? k}
                        </Badge>
                      );
                    })}
                  </div>
                </ReviewBlock>

                {error && (
                  <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                )}
              </>
            )}
          </CardContent>

          <CardFooter className="flex items-center justify-between gap-2 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={back}
              disabled={stepIndex === 0 || submitting}
              className="gap-1.5"
            >
              <ArrowLeft className="size-4" /> Back
            </Button>
            <div className="flex items-center gap-2">
              {step !== 'review' ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={advance}
                  disabled={!canAdvance || submitting}
                  className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90"
                >
                  Continue <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void submit()}
                  disabled={submitting}
                  className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90"
                >
                  {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {submitting ? 'Creating shop…' : 'Create my shop'}
                </Button>
              )}
            </div>
          </CardFooter>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Already have an account?{' '}
          <Link href="/shop/login" className="font-medium text-amber-700 hover:underline">
            Sign in
          </Link>
          {' · '}
          <Link href="/" className="font-medium text-amber-700 hover:underline">
            Customer app
          </Link>
        </p>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
  type = 'text',
  disabled,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
      />
      {error && <p className="text-[11px] text-rose-700">{error}</p>}
    </div>
  );
}

function ReviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium break-words">{value}</span>
    </div>
  );
}
