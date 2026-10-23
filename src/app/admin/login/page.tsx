'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
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
 * No demo credentials are shown. Admin access is controlled via
 * environment variables (ADMIN_EMAIL + ADMIN_PASSWORD) on the server.
 * The admin login page is not linked from the public homepage —
 * only people who know the URL can access it.
 */
export default function AdminLoginPage() {
  const api = useApiClient();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        throw new Error(env?.error?.message ?? `Login failed (HTTP ${res.status})`);
      }
      const data = unwrap<LoginResponse>(res);
      if (data.user.role !== 'admin') {
        api.clearAuth();
        setError('Admin access required. This portal is for platform admins only.');
        setTimeout(() => router.replace('/shop/login'), 1800);
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-600/20">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">PrintShop Admin</h1>
          <p className="mt-1 text-sm text-zinc-400">Platform administration portal</p>
        </div>

        <Card className="border-zinc-800 bg-zinc-900 text-zinc-100 shadow-xl">
          <CardHeader>
            <CardTitle className="text-zinc-100">Sign in</CardTitle>
            <CardDescription className="text-zinc-400">Use your platform admin credentials.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="email" className="text-zinc-200">Email</Label>
                <Input
                  id="email" type="email" autoComplete="email" required
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className="border-zinc-700 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500"
                  placeholder="admin@example.com" disabled={submitting}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-zinc-200">Password</Label>
                <Input
                  id="password" type="password" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="border-zinc-700 bg-zinc-950 text-zinc-100 placeholder:text-zinc-500"
                  placeholder="••••••••" disabled={submitting}
                />
              </div>
              {error && (
                <Alert variant="destructive" className="border-red-800 bg-red-950/50 text-red-200">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Sign-in failed</AlertTitle>
                  <AlertDescription className="text-red-200">{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={submitting} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500 min-h-[44px]">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="flex flex-col gap-2 text-xs text-zinc-400">
            <Link href="/" className="inline-flex items-center gap-1 hover:text-zinc-200">
              Back to landing page <ArrowRight className="h-3 w-3" />
            </Link>
            <p>Shop owner? <Link href="/shop/login" className="text-emerald-400 hover:underline">Sign in here</Link></p>
          </CardFooter>
        </Card>

        <p className="mt-6 text-center text-xs text-zinc-500">PrintShop SaaS · Platform admin portal</p>
      </div>
    </div>
  );
}
