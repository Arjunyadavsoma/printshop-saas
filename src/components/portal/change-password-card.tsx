'use client';

import { useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Eye, EyeOff, Loader2, Lock, CheckCircle2, AlertCircle } from 'lucide-react';

/**
 * ChangePasswordCard — the "Account security" form for the shop settings page.
 *
 * H16 fix: this is the authenticated change-password flow. The user enters
 * their CURRENT password (verification — prevents a session hijacker from
 * silently changing the password) plus a new password, and we POST to
 * /api/v1/me/password. The server verifies the old password against the
 * stored hash, hashes the new one, and updates the row.
 *
 * The form deliberately does NOT auto-logout after a successful change.
 * The user's current session remains valid (the access token is
 * independent of the password) — they can keep using the dashboard. Other
 * sessions on different devices will continue to work until their access
 * tokens expire (15min) — see the route.ts header comment for the session-
 * revocation TODO.
 *
 * Strength meter mirrors the reset-password page so the UX is consistent
 * across both flows.
 */
export function ChangePasswordCard() {
  const api = useApiClient();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const reset = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setSuccess(false);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError('The new passwords don&apos;t match.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (oldPassword === newPassword) {
      setError('The new password must be different from the current password.');
      return;
    }

    setSubmitting(true);
    try {
      const r = await api.request<{ success?: boolean; error?: { message?: string } }>(
        'POST',
        '/api/v1/me/password',
        { body: { oldPassword, newPassword } },
      );
      if (r.status !== 200 || !r.data?.success) {
        setError(r.data?.error?.message ?? 'Could not change password — please try again.');
        return;
      }
      setSuccess(true);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error — please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="bg-surface">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Lock className="size-4 text-brand" aria-hidden="true" /> Change password
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Update your account password. You&apos;ll need to enter your current password to confirm the change.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="oldPassword" className="text-sm font-medium">Current password</Label>
            <div className="relative">
              <Input
                id="oldPassword"
                type={showOld ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                disabled={submitting}
                className="h-11 pr-10 sm:h-9"
              />
              <button
                type="button"
                onClick={() => setShowOld((s) => !s)}
                aria-label={showOld ? 'Hide password' : 'Show password'}
                aria-controls="oldPassword"
                className="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {showOld ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="newPassword" className="text-sm font-medium">New password</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                required
                disabled={submitting}
                className="h-11 pr-10 sm:h-9"
              />
              <button
                type="button"
                onClick={() => setShowNew((s) => !s)}
                aria-label={showNew ? 'Hide password' : 'Show password'}
                aria-controls="newPassword"
                className="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {showNew ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>
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

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword" className="text-sm font-medium">Confirm new password</Label>
            <Input
              id="confirmPassword"
              type={showNew ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter the new password"
              autoComplete="new-password"
              required
              disabled={submitting}
              className="h-11 sm:h-9"
            />
          </div>

          {success && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-md border border-success-border bg-success-soft px-3 py-2 text-sm text-success"
            >
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>Password updated successfully. Use the new password next time you sign in.</span>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] gap-2 bg-brand text-brand-foreground hover:bg-brand-hover"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Lock className="size-4" aria-hidden="true" />
              )}
              {submitting ? 'Updating…' : 'Update password'}
            </Button>
            {(oldPassword || newPassword || confirmPassword || success || error) && (
              <Button
                type="button"
                variant="outline"
                onClick={reset}
                disabled={submitting}
                className="min-h-[44px]"
              >
                Clear
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
