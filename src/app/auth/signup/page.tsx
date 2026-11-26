'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell, AuthHeader, AuthIllustration, AuthTextField, PasswordField, PrimaryAuthButton, AuthBanner } from '@/components/auth/auth-ui';

/**
 * SCREEN 6 — Get Started / Sign Up (reference image 6).
 *
 * Printelyx has separate customer and shopkeeper workflows, and the only
 * existing registration API (POST /api/v1/auth/register) creates a shop
 * OWNER account + Shop together — the /shop/register wizard implements
 * the full contract (shop name, slug, UPI, address, services…).
 *
 * Per the assignment: the wizard must keep working exactly as before and
 * must not be merged into this screen. So this screen is the friendly
 * account entry: it validates the account fields exactly like the
 * wizard's own validation rules (same regexes), then carries them into
 * the existing wizard via sessionStorage — the user lands on the wizard's
 * business step with their account details already filled. One flow, no
 * second auth system, no changed payload.
 *
 * Customers who don't want a shop account can "Continue without an
 * account" — ordering needs none (token-based order links).
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

export const SIGNUP_PREFILL_KEY = 'printelyx:signup-prefill';

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
      // Check for an existing account FIRST using the real API — the
      // register endpoint rejects duplicates with 409; check-slug and
      // login both leak account existence in controlled ways, but the
      // cleanest pre-flight here is a login attempt with a wrong password:
      // too noisy. Instead we simply hand off to the wizard, which calls
      // the real register endpoint and surfaces the 409 "account exists,
      // log in instead" error from the backend.
      //
      // Carry the validated account fields into the existing wizard.
      sessionStorage.setItem(SIGNUP_PREFILL_KEY, JSON.stringify({
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
