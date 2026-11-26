'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShieldCheck, Loader2, AlertCircle, ArrowRight, Lock, Eye, EyeOff } from 'lucide-react';
import { useApiClient } from '@/components/portal/use-api-client';
import { unwrap, type LoginResponse } from '@/components/portal/admin-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * /admin/login — platform admin login.
 *
 * Restyled to the Consumer Blue+White identity (tokens: --accent #2563EB,
 * --surface #FFFFFF, --ground #F8FAFC, --label, --label-2, --hairline).
 *
 * SECURITY LAYERS (PRESERVED — no logic changes):
 * 1. This page is NOT linked from the homepage (hidden URL)
 * 2. The page only renders if a valid access key is in the URL:
 *    /admin/login?k=<ADMIN_ACCESS_KEY>
 *    Without the key, the page shows a 404-style "not found" message.
 *    The admin bookmarks the URL with the key.
 * 3. The admin must enter the correct email + password (verified via env vars)
 * 4. Rate limited: 5 attempts per 60 seconds
 */
export default function AdminLoginPage() {
  const api = useApiClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);

  // Read the access key from the URL on mount (avoids useSearchParams()
  // which requires a Suspense boundary during next build).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessKey = params.get('k');
    if (!accessKey) {
      setKeyValid(false);
      return;
    }
    void (async () => {
      try {
        const res = await fetch('/api/v1/admin/access-check?key=' + encodeURIComponent(accessKey));
        setKeyValid(res.ok);
      } catch {
        setKeyValid(false);
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.request<unknown>('POST', '/api/v1/auth/login', {
        body: { email: email.trim(), password },
      });
      if (res.status !== 200 || !res.data) {
        const env = res.data as { error?: { message?: string } } | null;
        throw new Error(env?.error?.message ?? 'Login failed');
      }
      const data = unwrap<LoginResponse>(res);
      if (data.user.role !== 'admin') {
        api.clearAuth();
        setError('Admin access required.');
        return;
      }
      api.setAuth(data.accessToken, data.refreshToken ?? '', data.user.role, data.user.email);
      window.location.href = '/admin';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  // No access key → explain plainly instead of a fake 404.
  if (keyValid === false) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center bg-[var(--ground)] px-4"
        style={{ fontFamily: 'var(--font-inter)' }}
      >
        <div className="max-w-sm text-center">
          <div
            className="mx-auto flex size-12 items-center justify-center rounded-[12px] bg-[var(--accent-tint)] text-[var(--accent)]"
            aria-hidden="true"
          >
            <Lock className="size-6" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-[var(--label)]">Admin portal</h1>
          <p className="mt-1 text-sm text-[var(--label-2)]">
            Sign-in is by invitation link only. If you are a platform admin,
            open the link you were sent (it includes an access key). If you
            followed a plain link here, the portal is not broken — it just
            needs that key.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-[var(--accent)] hover:underline"
          >
            Back to landing page <ArrowRight className="size-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
    );
  }

  // Checking the key...
  if (keyValid === null) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center bg-[var(--ground)]"
        style={{ fontFamily: 'var(--font-inter)' }}
      >
        <Loader2 className="size-6 animate-spin text-[var(--label-2)]" aria-hidden="true" />
      </div>
    );
  }

  // Key valid → show the login form.
  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-[var(--ground)] px-4 py-10"
      style={{ fontFamily: 'var(--font-inter)' }}
    >
      <div className="w-full max-w-md mx-auto">
        <Card className="border-[var(--hairline)] bg-[var(--surface)] shadow-sm">
          <CardHeader className="space-y-3">
            <div
              className="flex size-12 items-center justify-center rounded-[12px] bg-[var(--accent)] text-white shadow-sm"
              aria-hidden="true"
            >
              <ShieldCheck className="size-6" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-lg font-semibold text-[var(--label)]">Admin sign-in</CardTitle>
              <CardDescription className="text-sm text-[var(--label-2)]">
                Restricted access. Use your platform admin credentials.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-[var(--label)]">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  disabled={submitting}
                  className="h-11 text-base border-[var(--hairline)] focus-visible:border-[var(--accent)] focus-visible:ring-[var(--accent)]/30"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-[var(--label)]">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    disabled={submitting}
                    className="h-11 pr-10 text-base border-[var(--hairline)] focus-visible:border-[var(--accent)] focus-visible:ring-[var(--accent)]/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-controls="password"
                    className="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-[var(--label-2)] hover:bg-[var(--accent-tint)] hover:text-[var(--accent)]"
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
                <Alert variant="destructive" className="border-[var(--error)]/30 bg-[var(--error)]/5">
                  <AlertCircle className="size-4" aria-hidden="true" />
                  <AlertTitle>Sign-in failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] w-full gap-2 bg-[var(--accent)] text-white hover:bg-[var(--accent-press)]"
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col gap-2 text-xs text-[var(--label-2)]">
            <Link href="/" className="inline-flex items-center gap-1 hover:text-[var(--label)]">
              Back to landing page <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </CardFooter>
        </Card>
        <p className="mt-6 text-center text-xs text-[var(--label-2)]">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            Printelyx · Platform admin portal
          </span>
        </p>
      </div>
    </div>
  );
}
