'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ConsumerPage } from '@/components/clear/consumer-page';
import { TintedButton } from '@/components/clear/button';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  CustomerGoogleButton,
  CustomerSessionSync,
  CustomerSignOutButton,
} from './clerk-customer-signin';

/**
 * /profile — "Profile" consumer tab.
 *
 * Customers sign in with Google (Clerk) — the same sign-in shopkeepers
 * use, but minting a separate customer identity (see
 * `clerk-customer-signin.tsx`). Google sign-in IS the signup: the
 * customer account is created on first sign-in. Guest ordering is
 * untouched — you don't need an account to print, and signing in never
 * gates an order.
 *
 * What a signed-in customer gets: their name/phone (editable here, and
 * prefilled at checkout), order history across devices (/orders), and
 * sign-out. The "coming soon" placeholder this page used to show is
 * gone.
 *
 * Shared consumer shell (ConsumerPage).
 */
const cardClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-1';
const cardPadClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] p-4';

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

type CustomerProfile = { id: string; email: string; name: string | null; phone: string | null };

export default function ProfilePage() {
  const api = useApiClient();
  const signedInAsCustomer = Boolean(api.ready && api.token && api.role === 'customer');
  const signedInAsShopkeeper = Boolean(api.ready && api.token && api.role && api.role !== 'customer');

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    if (!signedInAsCustomer) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.request<{ data?: CustomerProfile; error?: { message?: string } }>(
          'GET',
          '/api/v1/customer/me',
        );
        if (cancelled) return;
        if (r.status === 200 && r.data?.data) {
          setProfile(r.data.data);
          setName(r.data.data.name ?? '');
          setPhone(r.data.data.phone ?? '');
        } else {
          setProfileError(r.data?.error?.message ?? 'Could not load your profile.');
        }
      } catch (cause) {
        if (!cancelled) setProfileError(cause instanceof Error ? cause.message : 'Network error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedInAsCustomer, api]);

  const saveProfile = async () => {
    setSaving(true);
    setSaved(false);
    setProfileError(null);
    try {
      const r = await api.request<{ data?: CustomerProfile; error?: { message?: string } }>(
        'PATCH',
        '/api/v1/customer/me',
        { body: { name: name.trim() || null, phone: phone.trim() || null } },
      );
      if (r.status !== 200 || !r.data?.data) {
        setProfileError(r.data?.error?.message ?? 'Could not save your details.');
        return;
      }
      setProfile(r.data.data);
      setSaved(true);
    } catch (cause) {
      setProfileError(cause instanceof Error ? cause.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConsumerPage>
      <h1 className="type-hero">Profile</h1>
      <p className="type-sub mt-2">Your account, orders and shops in one place.</p>

      {signedInAsCustomer ? (
        <div className={`${cardPadClass} mt-6`}>
          <p className="text-base font-semibold text-[var(--label)]">Signed in</p>
          <small className="mt-0.5 block text-sm text-[var(--label-2)]">{profile?.email ?? api.email ?? ''}</small>
          <p className="mt-3 text-sm text-[var(--label-2)]">
            Your name and phone are prefilled at checkout, so you don&apos;t have to type them every time.
          </p>
          <label className="mt-4 block text-sm font-semibold text-[var(--label)]">
            Name
            <input
              type="text"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="mt-1.5 block w-full rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2.5 text-sm font-normal text-[var(--label)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="mt-3 block text-sm font-semibold text-[var(--label)]">
            Phone
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              maxLength={10}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="10-digit mobile number"
              className="mt-1.5 block w-full rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2.5 text-sm font-normal text-[var(--label)] outline-none focus:border-[var(--accent)]"
            />
          </label>
          {profileError && (
            <p role="alert" className="mt-3 text-sm text-[var(--danger)]">{profileError}</p>
          )}
          {saved && (
            <p className="mt-3 text-sm text-[var(--label-2)]">Saved.</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <TintedButton type="button" size="compact" disabled={saving} onClick={() => void saveProfile()}>
              {saving ? 'Saving…' : 'Save details'}
            </TintedButton>
            {clerkEnabled && <CustomerSignOutButton />}
          </div>
        </div>
      ) : signedInAsShopkeeper ? (
        <div className={`${cardPadClass} mt-6`}>
          <p className="text-base font-semibold text-[var(--label)]">Signed in as a shopkeeper</p>
          <small className="mt-0.5 block text-sm text-[var(--label-2)]">{api.email ?? ''}</small>
          <p className="mt-3 text-sm text-[var(--label-2)]">
            This browser is signed in to a shop account. Customer sign-in is separate — your shop orders and your personal print orders live under different accounts, even with the same Google account.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/shop/dashboard" className="flex min-h-[48px] items-center justify-center rounded-full bg-[var(--accent)] px-6 text-sm font-semibold text-white">
              Go to shop dashboard
            </Link>
          </div>
        </div>
      ) : (
        <div className={`${cardPadClass} mt-6`}>
          <p className="text-base font-semibold text-[var(--label)]">Sign in with Google</p>
          <small className="mt-0.5 block text-sm text-[var(--label-2)]">One tap — this also creates your account.</small>
          <p className="mt-3 text-sm text-[var(--label-2)]">
            Signing in keeps your orders in one place across devices and prefills your details at checkout. You don&apos;t need an account to print — every order you place is saved on this device and tracked with its own link.
          </p>
          <div className="mt-4">
            {clerkEnabled ? (
              <>
                <CustomerGoogleButton />
                <CustomerSessionSync />
              </>
            ) : (
              <p className="text-sm text-[var(--label-2)]">Google sign-in isn&apos;t set up on this deployment yet.</p>
            )}
          </div>
        </div>
      )}

      <div className={`${cardClass} mt-4`}>
        <div className="r"><span>Your activity<small>Orders and shops you&apos;ve used.</small></span></div>
        <Link href="/orders" className="r"><span>Your orders</span><span className="v">›</span></Link>
        <Link href="/find-a-shop" className="r"><span>Shops near you</span><span className="v">›</span></Link>
      </div>

      <div className={`${cardClass} mt-4`}>
        <div className="r"><span>For shopkeepers<small>You run a shop? This is your sign-in.</small></span></div>
        <Link href="/shop/login" className="r"><span>Shopkeeper login</span><span className="v">›</span></Link>
        <Link href="/shop/register" className="r"><span>Register your shop</span><span className="v">›</span></Link>
      </div>

      <p className="mt-4 px-2 text-sm text-[var(--label-2)]">
        Questions? <Link href="/help" className="text-[var(--accent)]">Help centre</Link>
      </p>
    </ConsumerPage>
  );
}
