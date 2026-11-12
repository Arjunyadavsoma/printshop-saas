'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useApiClient } from '@/components/portal/use-api-client';
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
import {
  Loader2, ArrowRight, ShieldCheck, UserPlus, Eye, EyeOff,
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

export default function ShopLoginPage() {
  const api = useApiClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setEmail(demo.email);
    setPassword('demo1234');
    setError(null);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-page px-4 py-10">
      {/* Theme toggle (top-right corner) */}
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
              <CardTitle className="text-lg font-semibold text-foreground">Sign in to your shop</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Use your shop owner email and password to manage your queue, orders, and printer agent.
              </CardDescription>
            </div>
          </CardHeader>
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
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
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
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* Create Shop Account — the primary CTA for new shopkeepers */}
        <div className="mt-4 rounded-lg border border-brand-border bg-brand-soft p-4 text-center">
          <p className="text-sm font-medium text-brand">Don&apos;t have a shop account?</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Set up your print shop in minutes — 0% commission, customers pay you directly via UPI.
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-3 min-h-[44px] w-full gap-2 border border-brand-border bg-surface text-brand hover:bg-brand-soft"
          >
            <Link href="/shop/register">
              <UserPlus className="size-4" aria-hidden="true" />
              Create Shop Account
            </Link>
          </Button>
        </div>

        {/* Demo accounts — only visible in development (not production) */}
        {process.env.NODE_ENV !== 'production' && (
          <Card className="mt-4 border-dashed border-brand-border bg-surface">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
                Demo accounts (dev only)
              </CardTitle>
              <CardDescription className="text-xs">
                Click any account to autofill the form (password: demo1234).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-1.5 pt-0">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => fillDemo(acc)}
                  className="flex min-h-[44px] w-full items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-brand-border hover:bg-brand-soft"
                >
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{acc.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">{acc.email}</span>
                  </div>
                  <ArrowRight className="size-3 text-brand" aria-hidden="true" />
                </button>
              ))}
            </CardContent>
            <CardFooter className="pt-0 text-xs text-muted-foreground">
              Admin accounts are redirected to <code className="font-mono">/admin</code> after login.
            </CardFooter>
          </Card>
        )}

        <div className="mt-4 text-center text-xs text-muted-foreground">
          Customer?{' '}
          <Link href="/" className="font-medium text-brand hover:underline">
            Open the customer app →
          </Link>
        </div>
      </div>
    </div>
  );
}
