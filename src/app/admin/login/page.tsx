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
import { ThemeToggle } from '@/components/layout/theme-toggle';

/**
 * /admin/login — platform admin login.
 *
 * SECURITY LAYERS:
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

  // No access key → show a "not found" page (not the login form).
  if (keyValid === false) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-page px-4">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <ThemeToggle />
        </div>
        <div className="text-center">
          <Lock className="mx-auto size-12 text-muted-foreground" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold text-foreground">404</h1>
          <p className="mt-1 text-sm text-muted-foreground">This page does not exist.</p>
        </div>
      </div>
    );
  }

  // Checking the key...
  if (keyValid === null) {
    return (
      <div className="relative flex min-h-screen items-center justify-center bg-page">
        <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
          <ThemeToggle />
        </div>
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }

  // Key valid → show the login form.
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
              <ShieldCheck className="size-6" />
            </div>
            <div className="space-y-1">
              <CardTitle className="text-lg font-semibold text-foreground">Admin sign-in</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Restricted access. Use your platform admin credentials.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  disabled={submitting}
                  className="h-11 text-base"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">Password</Label>
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
                    className="h-11 pr-10 text-base"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-controls="password"
                    className="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
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
                <Alert variant="destructive" className="border-danger-border bg-danger-soft text-danger">
                  <AlertCircle className="size-4" aria-hidden="true" />
                  <AlertTitle>Sign-in failed</AlertTitle>
                  <AlertDescription className="text-danger">{error}</AlertDescription>
                </Alert>
              )}
              <Button
                type="submit"
                disabled={submitting}
                className="min-h-[44px] w-full gap-2 bg-brand text-brand-foreground hover:bg-brand-hover"
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
          <CardFooter className="flex flex-col gap-2 text-xs text-muted-foreground">
            <Link href="/" className="inline-flex items-center gap-1 hover:text-foreground">
              Back to landing page <ArrowRight className="size-3" aria-hidden="true" />
            </Link>
          </CardFooter>
        </Card>
        <p className="mt-6 text-center text-xs text-muted-foreground">PrintShop SaaS · Platform admin portal</p>
      </div>
    </div>
  );
}
