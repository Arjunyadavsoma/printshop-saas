'use client';

import Link from 'next/link';
import { User, ReceiptText, Store } from 'lucide-react';
import { CustomerShell } from '@/components/clear/customer-shell';

/**
 * /profile — "Profile" consumer tab. Sign-in for customers is planned but
 * NOT built yet (the platform has no customer accounts — orders are
 * tracked by device-stored order links). This page is the honest
 * placeholder: it states exactly what works today, where the customer's
 * orders live, and where shopkeepers sign in. When customer accounts
 * ship, sign-in lands here and existing device orders get claimed by the
 * signed-in account (cross-device order history).
 */
export default function ProfilePage() {
  return (
    <CustomerShell shopName="Printelyx">
      <h1 className="text-3xl font-extrabold tracking-tight text-[var(--label)]">Profile</h1>
      <p className="mt-1 text-base text-[var(--label-2)]">Your account, orders and shops in one place.</p>

      <section className="mt-5 rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)] p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-12 items-center justify-center rounded-full bg-[var(--accent-tint)] text-[var(--accent-tint-text)]" aria-hidden="true">
            <User className="size-6" strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-[var(--label)]">Sign in is coming soon</p>
            <p className="text-[13px] text-[var(--label-2)]">Customer accounts are on the way.</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-[var(--label-2)]">
          You don&apos;t need an account to print. Every order you place is saved on this device
          and tracked with its own link — sign-in later will link those orders across your devices.
        </p>
        <button
          type="button"
          disabled
          className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-[var(--accent-tint)] px-5 text-sm font-semibold text-[var(--accent-tint-text)] opacity-60"
          aria-disabled="true"
        >
          Sign in — coming soon
        </button>
      </section>

      <section className="mt-4 divide-y divide-[var(--hairline)] rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)]" aria-label="Your activity">
        <Link href="/orders" className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-3 text-sm font-medium text-[var(--label)]">
            <ReceiptText className="size-5 text-[var(--label-2)]" aria-hidden="true" />
            Your orders
          </span>
          <span aria-hidden="true" className="text-[var(--label-3)]">›</span>
        </Link>
        <Link href="/find-a-shop" className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3">
          <span className="flex items-center gap-3 text-sm font-medium text-[var(--label)]">
            <Store className="size-5 text-[var(--label-2)]" aria-hidden="true" />
            Shops near you
          </span>
          <span aria-hidden="true" className="text-[var(--label-3)]">›</span>
        </Link>
      </section>

      <section className="mt-4 divide-y divide-[var(--hairline)] rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface)]" aria-label="For shopkeepers">
        <Link href="/shop/login" className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-[var(--label)]">Shopkeeper login</span>
            <span className="block text-[13px] text-[var(--label-2)]">You run a shop? This is your sign-in.</span>
          </span>
          <span aria-hidden="true" className="text-[var(--label-3)]">›</span>
        </Link>
        <Link href="/shop/register" className="flex min-h-[56px] items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-[var(--label)]">Register your shop</span>
            <span className="block text-[13px] text-[var(--label-2)]">Get a QR code and start taking orders.</span>
          </span>
          <span aria-hidden="true" className="text-[var(--label-3)]">›</span>
        </Link>
      </section>

      <p className="mt-4 text-[13px] text-[var(--label-2)]">
        Questions? <Link href="/help" className="underline">Help centre</Link>
      </p>
    </CustomerShell>
  );
}
