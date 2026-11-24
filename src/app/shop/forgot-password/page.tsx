'use client';

import { useState } from 'react';
import Link from 'next/link';
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
import { Loader2, ArrowLeft, ArrowRight, MailCheck } from 'lucide-react';

/**
 * /shop/forgot-password — the email-entry step of the password-reset flow.
 *
 * H16: this page + /shop/reset-password + the /api/v1/auth/forgot-password
 * and /api/v1/auth/reset-password endpoints together form the password-reset
 * flow that was previously entirely missing from the app.
 *
 * The page ALWAYS shows the "if your email exists, a reset link has been
 * sent" success message after submit, regardless of whether the email
 * matched a real account. This matches the server's anti-enumeration
 * behaviour (see /api/v1/auth/forgot-password/route.ts) — we don't want to
 * leak which emails are registered.
 *
 * In dev, the StubEmailAdapter captures the email to memory (visible in the
 * server logs) rather than actually sending it. The reset URL is logged —
 * copy it into the browser to test the reset-password page. In production
 * with a real email adapter, the link arrives in the user's inbox.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // The endpoint always returns 200 (anti-enumeration). We don't need to
      // branch on the response — the success UI is shown unconditionally.
      await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-page px-4 py-10">

      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          ← Back to Printelyx
        </Link>
        <Card className="border-border bg-surface shadow-sm">
          <CardHeader className="space-y-3">
            <div className="flex items-center gap-2.5">
              <div
                className="flex size-12 items-center justify-center rounded-xl bg-brand text-brand-foreground shadow-sm"
                aria-hidden="true"
              >
                <span className="text-xl font-bold">P</span>
              </div>
              <span className="text-lg font-bold tracking-tight text-foreground">Printelyx</span>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Printelyx for shops
              </p>
              <CardTitle className="text-lg font-semibold text-foreground">Reset your password</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Enter your shop account email and we&apos;ll send you a link to choose a new password.
                The link lasts 15 minutes and can only be used once.
              </CardDescription>
            </div>
          </CardHeader>

          {submitted ? (
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 rounded-md border border-brand-border bg-brand-soft p-4">
                <MailCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">Check your email</p>
                  <p className="text-sm text-muted-foreground">
                    If an account exists for <span className="font-medium text-foreground">{email}</span>,
                    you&apos;ll receive a reset link within a few minutes. The link expires in 15 minutes.
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Didn&apos;t get the email? Check your spam and promotions folders — the link
                expires 15 minutes after it is sent. If it still hasn&apos;t arrived after a
                few minutes, you can request a new one (up to 5 requests every 15 minutes), then{' '}
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="font-medium text-brand hover:underline"
                >
                  try again
                </button>
                .
              </p>
            </CardContent>
          ) : (
            <form onSubmit={submit}>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    disabled={submitting}
                    className="h-11 text-base"
                    autoFocus
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
                  {submitting ? 'Sending…' : 'Send reset link'}
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
          {' · '}
          <Link href="/" className="font-medium text-brand hover:underline">
            Back to Printelyx
          </Link>
        </div>
      </div>
    </div>
  );
}
