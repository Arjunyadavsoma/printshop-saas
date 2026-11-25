'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { LiveDot } from '@/components/clear/consumer-page';
import { GoogleMark, AppleMark } from '@/components/clear/provider-marks';
import { ClerkGoogleButton, ClerkSessionSync } from './clerk-signin';
import {
  Loader2, ArrowRight, ShieldCheck, UserPlus, Eye, EyeOff, Mail,
} from 'lucide-react';

interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  user?: { id: string; email: string; role: 'owner' | 'staff' | 'admin'; shopId: string | null };
}

const DEMO_ACCOUNTS: { email: string; label: string }[] = process.env.NODE_ENV === 'production' ? [] : [
  { email: 'owner@quickprint.demo', label: 'QuickPrint Demo Shop' },
  { email: 'owner@copycenter.demo', label: 'CopyCenter' },
  { email: 'owner@prinithub.demo', label: 'PrintHub Express' },
  { email: 'admin@printshop.demo', label: 'Platform Admin' },
];

/**
 * Halo-style sign-in for Printelyx shopkeepers (and platform admins).
 *
 * Design: dark near-black full screen, centred column, three full-width
 * pill buttons (Google / Apple / email) — the same layout as the "halo"
 * reference. Email is always a real sign-in (POST /api/v1/auth/login,
 * JWT, role-based redirect). Google is real too once Clerk is configured
 * (see src/lib/clerk.ts): the button runs Clerk Google OAuth and the
 * session is exchanged for the same JWT pair. Until Clerk is configured
 * the Google button is visibly marked "Soon" and explains that on tap
 * instead of pretending to work. Apple has no OAuth provider configured
 * anywhere, so it stays "Soon" — same honest note, same behaviour.
 *
 * Colours come from the shared `--halo-*` tokens in globals.css (see
 * HALO_TOKENS in components/clear/tokens.ts) so the screen looks
 * identical in light and dark mode — the reference is dark by design.
 */
export default function ShopLoginPage() {
  const api = useApiClient();
  // Clerk (Google OAuth) lights up only when its publishable key is set
  // (inlined into the client bundle by Next.js). Without it the page
  // behaves exactly as before — email only, Google marked "Soon".
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  // Which unavailable provider the user last tapped (null = no note shown).
  const [unavailableNote, setUnavailableNote] = useState<'google' | 'apple' | null>(null);

  // NOTE: The auto-redirect ("if already authed, bounce to dashboard") was
  // REMOVED because it caused a redirect loop with expired tokens. The old
  // logic checked localStorage presence (not validity) → an expired token
  // triggered a redirect to /shop/dashboard → 401 → the dashboard showed
  // "session expired" but the login page kept bouncing the user back. Now
  // the login page stays put — the user clicks "Sign in" to get a fresh
  // token. The layout's auth gate handles the redirect for valid tokens.

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await api.request<{ success?: boolean; data?: LoginResponse; error?: { message?: string } }>(
        'POST',
        '/api/v1/auth/login',
        { body: { email, password } },
      );
      const inner = r.data?.data;
      if (r.status !== 200 || !inner?.accessToken) {
        const msg = r.data?.error?.message ?? 'Login failed — check your email and password.';
        setError(msg);
        return;
      }
      const accessToken = inner.accessToken;
      const refreshToken = inner.refreshToken ?? '';
      const role = inner.user?.role ?? 'owner';
      const emailVal = inner.user?.email ?? email;
      // Store BOTH access + refresh tokens (the old code discarded the
      // refresh token — after 15min the access token expired with no way
      // to refresh. Now the request() method auto-refreshes on 401.)
      api.setAuth(accessToken, refreshToken, role, emailVal);

      // Route by role: admins go to the platform admin portal; owners stay here.
      if (role === 'admin') {
        window.location.href = '/admin';
      } else {
        window.location.href = '/shop/dashboard';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (demo: { email: string }) => {
    // H17 fix: do NOT autofill the password. The previous behaviour
    // pre-filled `demo1234` into the password field — convenient for dev,
    // but it meant the shared demo password was hardcoded in client-
    // side source (visible in the JS bundle), AND any screenshot of the
    // login page after a demo-account click would show the password in
    // the (masked) field. The user must now type the demo password
    // manually (it's documented in the README + the panel below).
    setEmail(demo.email);
    setPassword('');
    setError(null);
    setEmailOpen(true);
  };

  const openEmail = () => {
    setEmailOpen(true);
    setUnavailableNote(null);
  };

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-halo-surface text-halo-text">
      {/* Ambient glow — restrained, like the reference's planet light. */}
      <div
        aria-hidden="true"
        className="halo-glow-top pointer-events-none absolute inset-x-0 top-0 h-[480px]"
      />
      <div
        aria-hidden="true"
        className="halo-glow-bottom pointer-events-none absolute inset-x-0 bottom-0 h-[300px]"
      />

      {/* Desktop-only top bar — the mobile screen stays 1:1 with the reference. */}
      <header className="relative z-10 hidden items-center justify-between px-8 py-5 lg:flex">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Printelyx — home">
          <span className="flex size-8 items-center justify-center rounded-full border border-halo-border-25 text-halo-text">
            <span className="size-2 rounded-full bg-accent" aria-hidden="true" />
          </span>
          <span className="text-base font-bold tracking-tight">Printelyx</span>
        </Link>
        <Link href="/" className="text-sm font-medium text-halo-text-60 transition-colors hover:text-halo-text">
          Customer app →
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-[420px]">
          {/* Logo mark + wordmark — centred, as in the reference. */}
          <div className="flex flex-col items-center text-center">
            <div
              className="flex size-14 items-center justify-center rounded-full border border-halo-border-strong bg-halo-fill"
              aria-hidden="true"
            >
              <span className="size-3 rounded-full bg-accent" />
            </div>
            <p className="mt-4 text-[28px] font-bold leading-none tracking-tight">Printelyx</p>
            <p className="mt-3 flex items-center gap-2 text-sm text-halo-text-3">
              <LiveDot />
              Sign in to your <em className="not-italic font-semibold text-halo-text-2">shop</em>
            </p>
          </div>

          {/* Provider buttons — full-width pills, stacked, as in the reference. */}
          <div className="mt-10 flex flex-col gap-3">
            {clerkEnabled ? (
              <ClerkGoogleButton />
            ) : (
              <button
                type="button"
                onClick={() => setUnavailableNote('google')}
                aria-disabled="true"
                className="flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-full bg-halo-pill text-[15px] font-semibold text-halo-ink transition-colors hover:bg-halo-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <GoogleMark />
                Continue with Google
                <span className="rounded-full bg-halo-ink/10 px-2 py-0.5 text-[11px] font-semibold text-halo-ink-soft">
                  Soon
                </span>
              </button>
            )}
            {clerkEnabled && <ClerkSessionSync />}
            <button
              type="button"
              onClick={() => setUnavailableNote('apple')}
              aria-disabled="true"
              className="flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-full bg-halo-pill text-[15px] font-semibold text-halo-ink transition-colors hover:bg-halo-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <AppleMark />
              Continue with Apple
              <span className="rounded-full bg-halo-ink/10 px-2 py-0.5 text-[11px] font-semibold text-halo-ink-soft">
                Soon
              </span>
            </button>
            <button
              type="button"
              onClick={openEmail}
              aria-expanded={emailOpen}
              className="flex min-h-[56px] w-full items-center justify-center gap-2.5 rounded-full border border-halo-border bg-halo-card text-[15px] font-semibold text-halo-text transition-colors hover:bg-halo-card-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Mail className="size-5" aria-hidden="true" />
              Continue with email
            </button>
          </div>

          {/* Honest note for the not-yet-available providers. */}
          {unavailableNote && (
            <div
              role="status"
              className="mt-4 rounded-2xl border border-halo-border-soft bg-halo-fill-5 px-4 py-3 text-center text-sm leading-relaxed text-halo-text-70"
            >
              {unavailableNote === 'google' ? 'Google' : 'Apple'} sign-in isn&apos;t available
              yet — Printelyx signs shops in with email for now. Use{' '}
              <button type="button" onClick={openEmail} className="font-semibold text-halo-text underline underline-offset-2">
                Continue with email
              </button>{' '}
              below.
            </div>
          )}

          {/* Real email sign-in form — expands in place. */}
          {emailOpen && (
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate={false}>
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium text-halo-text-2">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  disabled={submitting}
                  className="h-12 w-full rounded-2xl border border-halo-border bg-halo-fill-strong px-4 text-base text-halo-text placeholder:text-halo-text-5 focus:border-accent focus:outline-none disabled:opacity-60"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-sm font-medium text-halo-text-2">
                    Password
                  </label>
                  <Link
                    href="/shop/forgot-password"
                    className="text-xs font-medium text-halo-text-60 hover:text-halo-text hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    disabled={submitting}
                    className="h-12 w-full rounded-2xl border border-halo-border bg-halo-fill-strong px-4 pr-12 text-base text-halo-text placeholder:text-halo-text-5 focus:border-accent focus:outline-none disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-controls="password"
                    className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-xl text-halo-text-3 hover:bg-halo-fill-10 hover:text-halo-text"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" aria-hidden="true" />
                    ) : (
                      <Eye className="size-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>
              {error && (
                <div
                  role="alert"
                  className="rounded-2xl border border-halo-danger/40 bg-halo-danger-soft px-4 py-3 text-sm text-halo-danger-text"
                >
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-semibold text-white transition-colors hover:bg-[var(--accent-press)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowRight className="size-4" aria-hidden="true" />
                )}
                {submitting ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {/* Privacy / Terms — as in the reference. */}
          <p className="mt-8 text-center text-xs text-halo-text-4">
            <Link href="/privacy" className="hover:text-halo-text hover:underline">
              Privacy policy
            </Link>
            <span className="mx-3" aria-hidden="true">·</span>
            <Link href="/terms" className="hover:text-halo-text hover:underline">
              Terms of service
            </Link>
          </p>

          {/* Create Shop Account — the primary CTA for new shopkeepers. */}
          <div className="mt-8 rounded-3xl border border-halo-border-soft bg-halo-fill p-5 text-center">
            <p className="text-sm font-semibold text-halo-text">Don&apos;t have a shop account?</p>
            <p className="mt-1 text-xs leading-relaxed text-halo-text-3">
              Set up your print shop in minutes — 0% commission, customers pay you directly via UPI.
            </p>
            <Link
              href="/shop/register"
              className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full border border-halo-border bg-halo-fill-strong text-sm font-semibold text-halo-text transition-colors hover:bg-halo-fill-10"
            >
              <UserPlus className="size-4" aria-hidden="true" />
              Create Shop Account
            </Link>
          </div>

          {/* Demo accounts — only visible in development (not production) */}
          {process.env.NODE_ENV !== 'production' && DEMO_ACCOUNTS.length > 0 && (
            <div className="mt-4 rounded-3xl border border-dashed border-halo-border bg-halo-fill-3 p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-halo-text">
                <ShieldCheck className="size-4 text-halo-live" aria-hidden="true" />
                Demo accounts (dev only)
              </p>
              <p className="mt-1 text-xs leading-relaxed text-halo-text-50">
                Tap any account to fill the email. Type the demo password manually — it&apos;s in the
                project README.
              </p>
              <div className="mt-3 space-y-1.5">
                {DEMO_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.email}
                    type="button"
                    onClick={() => fillDemo(acc)}
                    className="flex min-h-[44px] w-full items-center justify-between rounded-2xl border border-halo-border-soft bg-halo-fill px-3 py-2 text-left transition-colors hover:border-halo-border-strong hover:bg-halo-fill-7"
                  >
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-halo-text">{acc.label}</span>
                      <span className="font-mono text-xs text-halo-text-50">{acc.email}</span>
                    </span>
                    <ArrowRight className="size-3 text-halo-text-60" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="mt-6 text-center text-xs text-halo-text-4">
            Customer?{' '}
            <Link href="/" className="font-medium text-halo-text hover:underline">
              Open the customer app →
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
