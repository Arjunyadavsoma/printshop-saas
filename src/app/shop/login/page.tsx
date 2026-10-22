'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { Store, Loader2, ArrowRight, KeyRound, ShieldCheck } from 'lucide-react';

interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  user?: { id: string; email: string; role: 'owner' | 'staff' | 'admin'; shopId: string | null };
}

const DEMO_ACCOUNTS: { email: string; label: string }[] = [
  { email: 'owner@quickprint.demo', label: 'QuickPrint Demo Shop' },
  { email: 'owner@copycenter.demo', label: 'CopyCenter' },
  { email: 'owner@prinithub.demo', label: 'PrintHub Express' },
  { email: 'admin@printshop.demo', label: 'Platform Admin' },
];

export default function ShopLoginPage() {
  const api = useApiClient();
  const router = useRouter();
  const [email, setEmail] = useState('owner@quickprint.demo');
  const [password, setPassword] = useState('demo1234');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already authed, bounce to the right portal immediately.
  useEffect(() => {
    if (!api.ready) return;
    if (api.token && api.role === 'owner') {
      router.replace('/shop/dashboard');
    } else if (api.token && api.role === 'admin') {
      router.replace('/admin');
    }
  }, [api.ready, api.token, api.role, router]);

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
      // The API wraps the data in an envelope: { success, data: { accessToken, user } }
      const inner = r.data?.data;
      if (r.status !== 200 || !inner?.accessToken) {
        const msg = r.data?.error?.message ?? 'Login failed — check your email and password.';
        setError(msg);
        return;
      }
      const accessToken = inner.accessToken;
      const role = inner.user?.role ?? 'owner';
      const emailVal = inner.user?.email ?? email;
      api.setAuth(accessToken, role, emailVal);

      // Route by role: admins go to the platform admin portal; owners stay here.
      if (role === 'admin') {
        router.replace('/admin');
      } else {
        router.replace('/shop/dashboard');
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-50 via-background to-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-amber-600 text-white shadow-sm">
            <Store className="size-6" />
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight">Shopkeeper Portal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to manage your print shop queue, orders, and printer agent.
          </p>
        </div>

        <Card className="border-border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="size-4 text-amber-600" />
              Sign in
            </CardTitle>
            <CardDescription>
              Use your shop owner email and password. Demo accounts are listed below.
            </CardDescription>
          </CardHeader>
          <form onSubmit={submit}>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@quickprint.demo"
                  autoComplete="email"
                  required
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="demo1234"
                  autoComplete="current-password"
                  required
                  disabled={submitting}
                />
              </div>
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
                >
                  {error}
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button
                type="submit"
                className="w-full gap-2 bg-amber-600 text-white hover:bg-amber-600/90"
                disabled={submitting}
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                Demo password for every account: <code className="font-mono">demo1234</code>
              </p>
            </CardFooter>
          </form>
        </Card>

        <Card className="mt-4 border-dashed border-amber-300 bg-amber-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="size-4 text-amber-700" />
              Demo accounts
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
                className="flex w-full items-center justify-between rounded-md border border-amber-200 bg-white/70 px-3 py-2 text-left text-xs transition-colors hover:border-amber-400 hover:bg-amber-50"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-foreground">{acc.label}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{acc.email}</span>
                </div>
                <ArrowRight className="size-3 text-amber-700" />
              </button>
            ))}
          </CardContent>
          <CardFooter className="pt-0 text-[10px] text-muted-foreground">
            Admin accounts are redirected to <code className="font-mono">/admin</code> after login.
          </CardFooter>
        </Card>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          Customer?{' '}
          <Link href="/" className="font-medium text-amber-700 hover:underline">
            Open the customer app →
          </Link>
        </div>
      </div>
    </div>
  );
}
