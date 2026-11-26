'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell, AuthHeader, AuthTextField, PrimaryAuthButton, AuthBanner } from '@/components/auth/auth-ui';

/**
 * SCREEN 7 — Verify Code / OTP (reference image 7).
 *
 * Wired to the EXISTING phone-OTP backend — no new OTP API:
 *   POST /api/v1/auth/otp/send   { phone }        → { sent: true }
 *   POST /api/v1/auth/otp/verify { phone, code }  → { valid, attemptsRemaining }
 *
 * Existing contract preserved exactly:
 *   - 6-digit code (OTP provider constant),
 *   - 5-minute expiry, 5-attempt lockout, 30s resend cooldown,
 *   - anti-enumeration: `send` always returns 200 `{ sent: true }`,
 *   - `verify` returns attemptsRemaining — we surface it verbatim.
 *
 * The phone number comes from the signup prefill (sessionStorage) or can
 * be typed. The screen is reachable standalone (e.g. from login) via
 * ?phone=98xxxx.
 */

const OTP_LENGTH = 6;

export default function AuthVerifyPage() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [phoneLocked, setPhoneLocked] = useState(false);
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  // Read phone from URL or signup prefill on mount; auto-send the first code.
  useEffect(() => {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get('phone');
    let initial = fromQuery ?? '';
    if (!initial) {
      try {
        const raw = sessionStorage.getItem('printelyx:signup-prefill');
        if (raw) {
          const pre = JSON.parse(raw) as { phone?: string };
          if (pre.phone) initial = pre.phone;
        }
      } catch { /* ignore */ }
    }
    if (initial) {
      setPhone(initial);
      setPhoneLocked(true);
    }
  }, []);

  const sendCode = useCallback(async (targetPhone: string, isResend = false) => {
    if (!targetPhone) return;
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/v1/auth/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: targetPhone.replace(/[\s-]/g, '') }),
      });
      if (!res.ok && res.status !== 200) {
        setError('Could not send the code right now. Please try again.');
        return;
      }
      const body = (await res.json().catch(() => null)) as { data?: { sent?: boolean; reason?: string } } | null;
      if (body?.data?.reason === 'disabled') {
        setNotice('Phone verification is currently unavailable on this deployment.');
        return;
      }
      setNotice(isResend ? 'A new code is on its way.' : `We sent a 6-digit code to ${targetPhone}.`);
      // Existing backend resend cooldown: 30s (OTP_RESEND_COOLDOWN_SECONDS).
      setCooldown(30);
    } catch {
      setError('Network error — check your connection and try again.');
    } finally {
      setSending(false);
    }
  }, []);

  // Auto-send once a phone is known (first render with a locked phone).
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (phoneLocked && phone && !autoSentRef.current) {
      autoSentRef.current = true;
      void sendCode(phone);
    }
  }, [phoneLocked, phone, sendCode]);

  // Countdown timer.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const setDigit = (index: number, raw: string) => {
    const clean = raw.replace(/\D/g, '');
    if (!clean) {
      setDigits(d => d.map((v, i) => (i === index ? '' : v)));
      return;
    }
    // Support paste of the full code into any box.
    if (clean.length > 1) {
      const next = Array(OTP_LENGTH).fill('');
      for (let i = 0; i < Math.min(clean.length, OTP_LENGTH); i++) next[i] = clean[i];
      setDigits(next);
      inputsRef.current[Math.min(clean.length, OTP_LENGTH) - 1]?.focus();
      return;
    }
    setDigits(d => d.map((v, i) => (i === index ? clean : v)));
    if (index < OTP_LENGTH - 1) inputsRef.current[index + 1]?.focus();
  };

  const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').replace(/\D/g, '');
    if (text) setDigit(0, text);
  };

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const code = digits.join('');
    if (code.length !== OTP_LENGTH) {
      setError(`Enter all ${OTP_LENGTH} digits of the code.`);
      return;
    }
    if (!phone.replace(/[\s-]/g, '')) {
      setError('Enter your phone number first.');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/auth/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone.replace(/[\s-]/g, ''), code }),
      });
      if (res.status === 429) {
        setError('Too many attempts. Please wait a moment and try again.');
        return;
      }
      const body = (await res.json().catch(() => null)) as { data?: { valid?: boolean; attemptsRemaining?: number; reason?: string } } | null;
      const data = body?.data;
      if (data?.reason === 'disabled') {
        setNotice('Phone verification is currently unavailable on this deployment.');
        return;
      }
      if (!data?.valid) {
        const left = data?.attemptsRemaining;
        setError(
          left === 0
            ? 'Too many wrong attempts — the code is locked. Request a new one.'
            : `That code didn't match. ${left ?? 5} attempts remaining.`
        );
        setDigits(Array(OTP_LENGTH).fill(''));
        inputsRef.current[0]?.focus();
        return;
      }
      // Verified — clear the prefill secret, then continue to the
      // registration wizard (phone now verified) or the provided next.
      try { sessionStorage.removeItem('printelyx:signup-prefill-password'); } catch { /* ignore */ }
      const url = new URL(window.location.href);
      const next = url.searchParams.get('next');
      router.replace(next ?? '/shop/register?from=auth&verified=1');
    } catch {
      setError('Network error — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const code = digits.join('');
  const canSubmit = code.length === OTP_LENGTH && !submitting;

  return (
    <AuthShell onBack={() => router.back()}>
      <AuthHeader
        title="Verify Your Account"
        subtitle="We sent a verification code to your registered phone number."
      />

      <form className="au-form" onSubmit={submit} noValidate>
        {error && <AuthBanner kind="error">{error}</AuthBanner>}
        {notice && <AuthBanner kind="info">{notice}</AuthBanner>}

        {!phoneLocked && (
          <AuthTextField
            label="Phone number"
            icon="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            hint="The number the code was sent to"
          />
        )}

        <div className="au-field">
          <span className="au-label">Verification code<span className="req" aria-hidden="true">*</span></span>
          <div className="au-otp" onPaste={onPaste}>
            {digits.map((d, i) => (
              <input
                key={i}
                ref={el => { inputsRef.current[i] = el; }}
                type="text"
                inputMode="numeric"
                autoComplete={i === 0 ? 'one-time-code' : 'off'}
                maxLength={OTP_LENGTH}
                value={d}
                onChange={e => setDigit(i, e.target.value)}
                onKeyDown={e => onKeyDown(i, e)}
                onFocus={e => e.target.select()}
                className={d ? 'au-filled' : ''}
                aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
              />
            ))}
          </div>
        </div>

        <PrimaryAuthButton loading={submitting} disabled={!canSubmit && !submitting}>
          {submitting ? 'Verifying…' : 'Verify'}
        </PrimaryAuthButton>

        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          {cooldown > 0 ? (
            <span className="au-hint">Resend available in {cooldown}s</span>
          ) : (
            <button
              type="button"
              className="au-link"
              disabled={sending || !phone}
              onClick={() => void sendCode(phone, true)}
            >
              {sending ? 'Sending…' : "Didn't receive any code? Resend"}
            </button>
          )}
        </div>
      </form>

      <div className="au-footer">
        Wrong number?{' '}
        <Link href="/auth/signup" className="au-link">Go back</Link>
      </div>
    </AuthShell>
  );
}
