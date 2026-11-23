'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Loader2, ArrowLeft, ArrowRight, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';

/**
 * /shop/reset-password?token=... — the new-password step of the reset flow.
 *
 * H16: the second half of the forgot-password flow. The user arrives here
 * by clicking the link in the reset email (which contains the plaintext
 * single-use token in the query string). They enter a new password, we
 * POST { token, newPassword } to /api/v1/auth/reset-password, and the
 * server validates the token + updates the passwordHash.
 *
 * The token is read from the URL query string via useSearchParams. If no
 * token is present (e.g. the user navigated here directly), we show a
 * "invalid link" state instead of the form — the form would 401 on submit
 * anyway, but showing the error up-front is better UX.
 *
 * On success, we DON'T auto-login — we redirect to /shop/login so the user
 * signs in with their new password. This avoids a half-state where the
 * session is "logged in via reset token" (we don't issue tokens from the
 * reset endpoint, by design — it's a password mutation, not an auth event).
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Basic password strength meter — not a hard gate, just visual guidance.
  // The server enforces min 8 chars; we mirror that here for the meter.
  const strength = (() => {
    let score = 0;
    if (newPassword.length >= 8) score++;
    if (newPassword.length >= 12) score++;
    if (/[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword)) score++;
    if (/\d/.test(newPassword)) score++;
    if (/[^a-zA-Z0-9]/.test(newPassword)) score++;
    return score; // 0..5
  })();
  const strengthLabel = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'][strength];
  const strengthColor = ['bg-muted', 'bg-danger', 'bg-warning', 'bg-warning', 'bg-success', 'bg-success'][strength];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('The passwords don&apos;t match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/v1/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const json = (await res.json()) as { success?: boolean; error?: { message?: string } };
      if (!res.ok || !json.success) {
        setError(json.error?.message ?? 'Reset failed — the link may be invalid or expired.');
        return;
      }
      setSuccess(true);
      // Redirect to login after a short delay so the user sees the success state.
      setTimeout(() => router.push('/shop/login'), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-page px-4 py-10">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <Card className="border-border bg-surface shadow-sm">
          <CardHeader className="space-y-3">
            <div
              className="flex size-12 items-center justify-center rounded-xl bg-brand text-brand-foreground shadow-sm"
              aria-hidden="true"
            >
              <span className="text-xl font-bold">P</span>
            </div>
            <div className="space-y-1">
              <CardTitle className="text-lg font-semibold text-foreground">Choose a new password</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Enter a new password for your Printelyx account. This link can only be used once.
              </CardDescription>
            </div>
          </CardHeader>

          {!token ? (
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 rounded-md border border-danger-border bg-danger-soft p-4">
                <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Invalid reset link</p>
                  <p className="text-sm text-muted-foreground">
                    The reset link is missing its token. Use the link from your reset email, or request a new one.
                  </p>
                </div>
              </div>
            </CardContent>
          ) : success ? (
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 rounded-md border border-success-border bg-success-soft p-4">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Password updated</p>
                  <p className="text-sm text-muted-foreground">
                    Your password has been changed. Redirecting you to sign in…
                  </p>
                </div>
              </div>
            </CardContent>
          ) : (
            <form onSubmit={submit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newPassword" className="text-sm font-medium">New password</Label>
                  <div className="relative">
                    <Input
                      id="newPassword"
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                      required
                      disabled={submitting}
                      className="h-11 pr-10 text-base"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((s) => !s)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-controls="newPassword"
                      className="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                    </button>
                  </div>
                  {/* Password strength meter */}
                  {newPassword.length > 0 && (
                    <div className="space-y-1" aria-live="polite">
                      <div className="flex gap-1">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <div
                            key={i}
                            className={`h-1 flex-1 rounded-full transition-colors ${i < strength ? strengthColor : 'bg-muted'}`}
                            aria-hidden="true"
                          />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{strengthLabel}</p>
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword" className="text-sm font-medium">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter the new password"
                    autoComplete="new-password"
                    required
                    disabled={submitting}
                    className="h-11 text-base"
                  />
                </div>
                {error && (
                  <div
                    role="alert"
                    className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger"
                  >
                    {error}
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex flex-col gap-3">
                <Button
                  type="submit"
                  className="min-h-[44px] w-full gap-2 bg-brand text-brand-foreground hover:bg-brand-hover"
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowRight className="size-4" aria-hidden="true" />
                  )}
                  {submitting ? 'Updating…' : 'Update password'}
                </Button>
              </CardFooter>
            </form>
          )}
        </Card>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          <Link
            href="/shop/login"
            className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
          >
            <ArrowLeft className="size-3" aria-hidden="true" />
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
