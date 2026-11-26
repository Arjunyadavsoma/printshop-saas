'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
import { GoogleMark } from '@/components/clear/provider-marks';
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
 * /shop/login — shopkeeper entry screen.
 *
 * Light, desktop-first centered card using the Shopkeeper Desktop-First
 * Identity (steel-blue + blue-violet, white surface on a light neutral
 * background). Two provider entry points: Google (real Clerk OAuth when
 * configured, otherwise an honest "Soon" button) and email (real POST
 * /api/v1/auth/login → JWT, role-based redirect). All auth is real —
 * nothing is mocked.
 *
 * Tokens come from the `--shop-*` family in globals.css (see
 * PRINTELYX-SHOPKEEPER-VISUAL-IDENTITY.md).
 */
export default function ShopLoginPage() {
  const api = useApiClient();
  // Clerk (Google OAuth) lights up only when its publishable key is set.
  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const [unavailableNote, setUnavailableNote] = useState<'google' | null>(null);

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
    <div
      className="relative flex min-h-dvh flex-col bg-[var(--shop-bg)] text-[var(--shop-ink)]"
      style={{ fontFamily: 'var(--font-inter)' }}
    >
      {/* Desktop-only top bar with "Customer? Open the customer app →" link. */}
      <header className="hidden items-center justify-between px-8 py-5 lg:flex">
        <Link
          href="/"
          className="flex items-center gap-2.5"
          aria-label="Printelyx — home"
        >
          <span className="size-2 rounded-full bg-[var(--shop-accent)]" aria-hidden="true" />
          <span className="text-[15px] font-bold tracking-tight text-[var(--shop-ink)]">Printelyx</span>
        </Link>
        <Link
          href="/"
          className="text-[13px] font-medium text-[var(--shop-ink-2)] transition-colors hover:text-[var(--shop-ink)]"
        >
          Customer? Open the customer app →
        </Link>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div
          className="w-full max-w-[440px] rounded-[18px] border border-[var(--shop-border)] bg-[var(--shop-surface)] p-8"
          style={{
            boxShadow: '0 1px 3px rgb(16 24 40 / 0.07), 0 8px 24px -8px rgb(16 24 40 / 0.12)',
          }}
        >
          {/* Brand mark + heading */}
          <div className="flex flex-col items-start">
            <div className="flex items-center gap-2.5">
              <span className="size-2 rounded-full bg-[var(--shop-accent)]" aria-hidden="true" />
              <span className="text-[15px] font-bold tracking-tight text-[var(--shop-ink)]">Printelyx</span>
            </div>
            <h1 className="mt-6 text-[22px] font-bold leading-tight tracking-tight text-[var(--shop-ink)]">
              Sign in to your shop
            </h1>
            <p className="mt-1 text-[14px] text-[var(--shop-ink-2)]">
              Manage orders, print jobs and payments.
            </p>
          </div>

          {/* Provider buttons — stacked, full-width, 52px height, rounded-[10px] */}
          <div className="mt-7 flex flex-col gap-3">
            {clerkEnabled ? (
              <ClerkGoogleButton />
            ) : (
              <button
                type="button"
                onClick={() => setUnavailableNote('google')}
                aria-disabled="true"
                className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[10px] border border-[var(--shop-border)] bg-white text-[15px] font-semibold text-[var(--shop-ink)] transition-colors hover:bg-[var(--shop-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-accent)]"
              >
                <GoogleMark />
                Continue with Google
                <span className="ml-1 rounded-full bg-[var(--shop-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--shop-ink-3)]">
                  Soon
                </span>
              </button>
            )}
            {clerkEnabled && <ClerkSessionSync />}
            <button
              type="button"
              onClick={openEmail}
              aria-expanded={emailOpen}
              className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[10px] border border-[var(--shop-border)] bg-white text-[15px] font-semibold text-[var(--shop-ink)] transition-colors hover:bg-[var(--shop-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-accent)]"
            >
              <Mail className="size-5" aria-hidden="true" />
              Continue with email
            </button>
          </div>

          {/* Honest note for the not-yet-available provider. */}
          {unavailableNote && (
            <div
              role="status"
              className="mt-4 rounded-[10px] border border-[var(--shop-border)] bg-[var(--shop-bg)] px-4 py-3 text-center text-[13px] leading-relaxed text-[var(--shop-ink-2)]"
            >
              Google sign-in isn&apos;t available yet — Printelyx signs shops in with email for now. Use{' '}
              <button
                type="button"
                onClick={openEmail}
                className="font-semibold text-[var(--shop-accent)] underline underline-offset-2"
              >
                Continue with email
              </button>{' '}
              below.
            </div>
          )}

          {/* Real email sign-in form — expands in place. */}
          {emailOpen && (
            <form onSubmit={submit} className="mt-6 space-y-4" noValidate={false}>
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-[13px] font-medium text-[var(--shop-ink-2)]">
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
                  className="h-12 w-full rounded-[10px] border border-[var(--shop-border)] bg-white px-4 text-[15px] text-[var(--shop-ink)] placeholder:text-[var(--shop-ink-3)] focus:border-[var(--shop-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--shop-accent-soft)] disabled:opacity-60"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="password" className="text-[13px] font-medium text-[var(--shop-ink-2)]">
                    Password
                  </label>
                  <Link
                    href="/shop/forgot-password"
                    className="text-[12px] font-medium text-[var(--shop-accent)] hover:underline"
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
                    className="h-12 w-full rounded-[10px] border border-[var(--shop-border)] bg-white px-4 pr-12 text-[15px] text-[var(--shop-ink)] placeholder:text-[var(--shop-ink-3)] focus:border-[var(--shop-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--shop-accent-soft)] disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-controls="password"
                    className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-[8px] text-[var(--shop-ink-3)] hover:bg-[var(--shop-bg)] hover:text-[var(--shop-ink)]"
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
                  className="rounded-[10px] border border-[var(--shop-danger)]/30 bg-[var(--shop-danger)]/5 px-4 py-3 text-[13px] text-[var(--shop-danger)]"
                >
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--shop-accent)] text-[15px] font-semibold text-white transition-colors hover:bg-[var(--shop-accent-press)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--shop-accent)] disabled:opacity-60"
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

          {/* Create Shop Account CTA */}
          <div className="mt-7 border-t border-[var(--shop-border)] pt-6 text-center">
            <p className="text-[14px] font-semibold text-[var(--shop-ink)]">Don&apos;t have a shop account?</p>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--shop-ink-2)]">
              Set up your print shop in minutes — 0% commission, customers pay you directly via UPI.
            </p>
            <Link
              href="/shop/register"
              className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-[10px] border border-[var(--shop-border)] bg-white text-[14px] font-semibold text-[var(--shop-ink)] transition-colors hover:bg-[var(--shop-bg)]"
            >
              <UserPlus className="size-4" aria-hidden="true" />
              Create Shop Account
            </Link>
          </div>

          {/* Privacy / Terms */}
          <p className="mt-6 text-center text-[12px] text-[var(--shop-ink-3)]">
            <Link href="/privacy" className="hover:text-[var(--shop-ink-2)] hover:underline">
              Privacy
            </Link>
            <span className="mx-2" aria-hidden="true">·</span>
            <Link href="/terms" className="hover:text-[var(--shop-ink-2)] hover:underline">
              Terms
            </Link>
          </p>
        </div>

        {/* Demo accounts — only visible in development (not production) */}
        {process.env.NODE_ENV !== 'production' && DEMO_ACCOUNTS.length > 0 && (
          <div className="mt-4 w-full max-w-[440px] rounded-[14px] border border-dashed border-[var(--shop-border)] bg-[var(--shop-surface)] p-4">
            <p className="flex items-center gap-2 text-[13px] font-semibold text-[var(--shop-ink)]">
              <ShieldCheck className="size-4 text-[var(--shop-accent)]" aria-hidden="true" />
              Demo accounts (dev only)
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--shop-ink-3)]">
              Tap any account to fill the email. Type the demo password manually — it&apos;s in the
              project README.
            </p>
            <div className="mt-3 space-y-1.5">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => fillDemo(acc)}
                  className="flex min-h-[44px] w-full items-center justify-between rounded-[10px] border border-[var(--shop-border)] bg-white px-3 py-2 text-left transition-colors hover:border-[var(--shop-accent)] hover:bg-[var(--shop-accent-soft)]"
                >
                  <span className="flex flex-col">
                    <span className="text-[13px] font-medium text-[var(--shop-ink)]">{acc.label}</span>
                    <span className="font-mono text-[12px] text-[var(--shop-ink-3)]">{acc.email}</span>
                  </span>
                  <ArrowRight className="size-3 text-[var(--shop-ink-3)]" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Mobile fallback for the customer link (desktop has it in the top bar). */}
        <p className="mt-6 text-center text-[12px] text-[var(--shop-ink-3)] lg:hidden">
          Customer?{' '}
          <Link href="/" className="font-medium text-[var(--shop-accent)] hover:underline">
            Open the customer app →
          </Link>
        </p>
      </main>
    </div>
  );
}
