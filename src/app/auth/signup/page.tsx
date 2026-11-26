'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell, AuthHeader, AuthIllustration, AuthTextField, PasswordField, PrimaryAuthButton, AuthBanner, AuthDivider } from '@/components/auth/auth-ui';
import { GoogleMark } from '@/components/clear/provider-marks';

/**
 * SCREEN 6 — Get Started / Sign Up (reference image 6).
 *
 * Printelyx has TWO real account flows (both preserved exactly):
 *
 *   1. CUSTOMERS sign up with Google (Clerk) — "Google sign-in IS the
 *      signup" (see /profile/clerk-customer-signin.tsx). This screen
 *      surfaces that existing flow first, restyled to the reference.
 *
 *   2. SHOPKEEPERS register via the existing /shop/register wizard
 *      (POST /api/v1/auth/register creates User + Shop). The form below
 *      validates account fields with the wizard's own rules, then hands
 *      off via sessionStorage prefill — the wizard is unchanged.
 *
 * Customers who want neither can continue without an account (guest
 * ordering via token links — untouched).
 */

/** Same validation rules as the existing /shop/register wizard (step 1). */
function validate(email: string, phone: string, password: string, name: string) {
  const e: Record<string, string> = {};
  if (!name.trim()) e.name = 'Your full name is required';
  if (!email.trim()) e.email = 'Email is required';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = 'Enter a valid email';
  if (!phone.trim()) e.phone = 'Phone number is required';
  else if (!/^(\+91)?[6-9]\d{9}$/.test(phone.replace(/[\s-]/g, ''))) e.phone = 'Enter a valid Indian mobile (e.g. 98765 43210)';
  if (!password) e.password = 'Password is required';
  else if (password.length < 8) e.password = 'Password must be at least 8 characters';
  return e;
}

export default function AuthSignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  const errors = validate(email, phone, password, name);
  const hasErrors = Object.keys(errors).length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setShowErrors(true);
    setError(null);
    if (hasErrors) return;
    if (!terms) {
      setError('Please accept the Terms and Conditions to continue.');
      return;
    }
    if (submitting) return;

    setSubmitting(true);
    try {
      // Carry the validated account fields into the existing wizard —
      // the wizard calls the real register endpoint and surfaces the
      // backend's 409 "account exists, log in instead" error itself.
      sessionStorage.setItem('printelyx:signup-prefill', JSON.stringify({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.replace(/[\s-]/g, ''),
        password,
      }));
      router.push('/shop/register?from=auth');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      illustration="/auth/signup-hero.png"
      illustrationAlt="A person standing next to a giant smartphone holding printed papers"
    >
      <AuthIllustration src="/auth/signup-hero.png" alt="A person holding printed papers" hideOnDesktop />
      <AuthHeader title="Get Started" subtitle="Create your Printelyx account." />

      <form className="au-form" onSubmit={submit} noValidate>
        {error && <AuthBanner kind="error">{error}</AuthBanner>}

        {/* Customer signup — the EXISTING Google (Clerk) flow, restyled.
            Only rendered when Clerk is configured. */}
        {clerkEnabled && (
          <>
            <a
              href="/profile?signin=1"
              className="au-btn"
              style={{ background: '#FFFFFF', color: 'var(--au-ink)', border: '1.5px solid var(--au-input-border)', textDecoration: 'none' }}
              aria-label="Sign up with Google"
            >
              <GoogleMark />
              <span style={{ marginLeft: 6 }}>Sign up with Google</span>
            </a>
            <AuthDivider label="or register a print shop" />
          </>
        )}

        <AuthTextField
          label="Full name"
          icon="user"
          autoComplete="name"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={showErrors ? errors.name ?? null : null}
        />

        <AuthTextField
          label="Email"
          icon="mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={showErrors ? errors.email ?? null : null}
        />

        <AuthTextField
          label="Phone number"
          icon="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={showErrors ? errors.phone ?? null : null}
          hint="Indian mobile — used for order updates"
        />

        <PasswordField
          label="Password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={showErrors ? errors.password ?? null : null}
        />

        <label className="au-check">
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" className="au-link">Terms and Conditions</Link>
            {' '}and{' '}
            <Link href="/privacy" className="au-link">Privacy Policy</Link>
          </span>
        </label>

        <PrimaryAuthButton loading={submitting}>
          {submitting ? 'Creating account…' : 'Create Account'}
        </PrimaryAuthButton>

        <p className="au-hint" style={{ textAlign: 'center', padding: '2px 8px' }}>
          Next, you&apos;ll set up your print shop — name, pricing and UPI. It takes about two minutes.
        </p>
      </form>

      <div className="au-footer">
        Already have an account?{' '}
        <Link href="/auth/login" className="au-link">Sign in</Link>
        <br />
        <Link href="/" className="au-link" style={{ fontSize: 13 }}>Continue without an account</Link>
      </div>
    </AuthShell>
  );
}
