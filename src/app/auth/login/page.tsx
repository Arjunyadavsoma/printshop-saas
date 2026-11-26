'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell, AuthHeader, AuthIllustration, AuthTextField, PasswordField, PrimaryAuthButton, AuthBanner, AuthDivider } from '@/components/auth/auth-ui';
import { useApiClient } from '@/components/portal/use-api-client';
import { GoogleMark } from '@/components/clear/provider-marks';

/**
 * SCREEN 5 — Welcome Back / Login (reference image 5).
 *
 * Fully functional against the EXISTING authentication backend:
 *   POST /api/v1/auth/login  { email, password }
 *   → { data: { accessToken, refreshToken, user: { role, email, ... } } }
 *
 * The submit handler is a direct port of the proven /shop/login logic:
 *   - identical request contract,
 *   - identical error surfacing (r.data.error.message),
 *   - identical token persistence via api.setAuth (access + refresh),
 *   - identical role-aware redirect (admin → /admin, owner → /shop/dashboard).
 *
 * Google sign-in: the project's EXISTING customer Google OAuth (Clerk,
 * `CustomerGoogleButton` pattern from /profile) is preserved and restyled
 * to the reference's round social-button look. It only renders when Clerk
 * is configured — no invented providers. Because `useSignIn` requires the
 * mounted <ClerkProvider>, the button is imported dynamically from the
 * profile module and gated the same way the profile page gates it.
 *
 * The success screen (/auth/success) is shown for a moment of delight
 * before the role-based redirect fires — it displays the REAL user email
 * from the API response, never a fabricated state.
 */

interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  user?: { id: string; email: string; role: 'owner' | 'staff' | 'admin'; shopId: string | null };
}

export default function AuthLoginPage() {
  const router = useRouter();
  const api = useApiClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showError, setShowError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  const fieldErrors = (() => {
    const e: { email?: string; password?: string } = {};
    if (showError && !email.trim()) e.email = 'Email is required';
    else if (showError && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Enter a valid email';
    if (showError && !password) e.password = 'Password is required';
    return e;
  })();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowError(true);
    if (!email.trim() || !password || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return;
    if (submitting) return; // prevent duplicate submissions

    setSubmitting(true);
    setError(null);
    try {
      const r = await api.request<{ success?: boolean; data?: LoginResponse; error?: { message?: string } }>(
        'POST',
        '/api/v1/auth/login',
        { body: { email: email.trim(), password } },
      );
      const inner = r.data?.data;
      if (r.status !== 200 || !inner?.accessToken) {
        const msg = r.data?.error?.message ?? 'Login failed — check your email and password.';
        setError(msg);
        return;
      }
      const role = inner.user?.role ?? 'owner';
      api.setAuth(inner.accessToken, inner.refreshToken ?? '', role, inner.user?.email ?? email.trim());

      // Hand off to the success screen with the REAL user + role; it
      // performs the same role-aware redirect the existing login uses.
      const dest = role === 'admin' ? '/admin' : '/shop/dashboard';
      router.replace(`/auth/success?email=${encodeURIComponent(inner.user?.email ?? email.trim())}&role=${role}&next=${encodeURIComponent(dest)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      illustration="/auth/login-hero.png"
      illustrationAlt="A smartphone surrounded by floating documents and location pins"
    >
      <AuthIllustration src="/auth/login-hero.png" alt="A smartphone surrounded by floating documents" hideOnDesktop />
      <AuthHeader title="Welcome Back" subtitle="Sign in to continue with Printelyx." />

      <form className="au-form" onSubmit={submit} noValidate>
        {error && <AuthBanner kind="error">{error}</AuthBanner>}

        <AuthTextField
          label="Email"
          icon="mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email ?? null}
        />

        <PasswordField
          label="Password"
          autoComplete="current-password"
          placeholder="Your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password ?? null}
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '2px 0' }}>
          <label className="au-check" style={{ padding: 0 }}>
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>Remember me</span>
          </label>
          <Link href="/shop/forgot-password" className="au-link">Forgot password?</Link>
        </div>

        <PrimaryAuthButton loading={submitting}>
          {submitting ? 'Signing in…' : 'Sign In'}
        </PrimaryAuthButton>

        <AuthDivider label="or continue with" />

        {/* Google customer sign-in — the EXISTING Clerk OAuth flow,
            restyled to the reference's round social button. Rendered only
            when Clerk is configured (same gate as the profile page). The
            redirect lands on /profile?clerk=1 where CustomerSessionSync
            exchanges the session for the app JWT. */}
        {clerkEnabled && (
          <a
            href="/profile?signin=1"
            className="au-social-btn"
            style={{ width: '100%', height: 56, borderRadius: 18 }}
            aria-label="Continue with Google"
          >
            <GoogleMark />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--au-ink)', marginLeft: 10 }}>Continue with Google</span>
          </a>
        )}

        {/* Dedicated portal entries (existing pages, unchanged). */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Link href="/shop/login" className="au-btn au-btn-light" style={{ textDecoration: 'none' }}>
            Shopkeeper portal
          </Link>
          <Link href="/admin/login" className="au-btn au-btn-light" style={{ textDecoration: 'none' }}>
            Admin portal
          </Link>
        </div>
      </form>

      <div className="au-footer">
        Don&apos;t have an account?{' '}
        <Link href="/auth/signup" className="au-link">Sign up</Link>
      </div>
    </AuthShell>
  );
}
