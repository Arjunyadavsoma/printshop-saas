'use client';

import Link from 'next/link';
import { ConsumerPage } from '@/components/clear/consumer-page';
import { TintedButton } from '@/components/clear/button';

/**
 * /profile — "Profile" consumer tab.
 * Customer sign-in is planned but not built yet — this is the honest
 * placeholder stating what works today.
 *
 * Shared consumer shell (ConsumerPage) — the old `.x .m` / `.x .d` dual
 * canvas is gone. Copy is unchanged (the longer mobile wording is kept
 * on both viewports).
 */
const cardClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-1';
const cardPadClass = 'rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] p-4';

export default function ProfilePage() {
  return (
    <ConsumerPage>
      <h1 className="type-hero">Profile</h1>
      <p className="type-sub mt-2">Your account, orders and shops in one place.</p>

      <div className={`${cardPadClass} mt-6`}>
        <p className="text-base font-semibold text-[var(--label)]">Sign in is coming soon</p>
        <small className="mt-0.5 block text-sm text-[var(--label-2)]">Customer accounts are on the way.</small>
        <p className="mt-3 text-sm text-[var(--label-2)]">
          You don&apos;t need an account to print. Every order you place is saved on this device and tracked with its own link — sign-in later will link those orders across your devices.
        </p>
        <TintedButton type="button" size="compact" disabled aria-disabled="true" className="mt-3">
          Sign in — coming soon
        </TintedButton>
      </div>

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
