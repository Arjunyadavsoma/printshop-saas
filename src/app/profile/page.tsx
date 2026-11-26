'use client';

import Link from 'next/link';
import { ConsumerTabBar } from '@/components/clear/consumer-tab-bar';
import { SiteFooter } from '@/components/clear/site-footer';

/**
 * /profile — "Profile" consumer tab. Clear design (matches homepage).
 * Customer sign-in is planned but not built yet — this is the honest
 * placeholder stating what works today.
 */
export default function ProfilePage() {
  return (
    <>
      {/* Mobile */}
      <div className="x m">
        <div className="top"><i className="dot" /><b style={{ color: '#1C1C1E', fontSize: 17 }}>Printelyx</b></div>
        <h1 className="h">Profile</h1>
        <p className="sub">Your account, orders and shops in one place.</p>

        <div className="g p">
          <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1C1E' }}>Sign in is coming soon</p>
          <small style={{ display: 'block', fontSize: 14, color: '#5B5F66', marginTop: 2 }}>Customer accounts are on the way.</small>
          <p className="cap" style={{ margin: '12px 0 0' }}>
            You don&apos;t need an account to print. Every order you place is saved on this device and tracked with its own link — sign-in later will link those orders across your devices.
          </p>
          <Link href="/auth/login" className="btn" style={{ marginTop: 12, flex: 'none', height: 44, fontSize: 15, textDecoration: 'none' }}>
            Sign in
          </Link>
        </div>

        <div className="g">
          <div className="r"><span>Your activity<small>Orders and shops you&apos;ve used.</small></span></div>
          <Link href="/orders" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Your orders</span><span className="v">›</span></Link>
          <Link href="/find-a-shop" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Shops near you</span><span className="v">›</span></Link>
        </div>

        <div className="g">
          <div className="r"><span>For shopkeepers<small>You run a shop? This is your sign-in.</small></span></div>
          <Link href="/shop/login" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Shopkeeper login</span><span className="v">›</span></Link>
          <Link href="/shop/register" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Register your shop</span><span className="v">›</span></Link>
        </div>

        <p className="cap">Questions? <Link href="/help" style={{ color: '#0A58D6', textDecoration: 'none' }}>Help centre</Link></p>
        <div style={{ height: 'calc(80px + env(safe-area-inset-bottom))' }} />
      </div>

      {/* Desktop */}
      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />Printelyx</b>
          <span className="v">
            <Link href="/" style={{ color: '#5B5F66', textDecoration: 'none', marginRight: 20 }}>Home</Link>
            <Link href="/orders" style={{ color: '#5B5F66', textDecoration: 'none', marginRight: 20 }}>Orders</Link>
            <Link href="/help" style={{ color: '#5B5F66', textDecoration: 'none' }}>Help</Link>
          </span>
        </div>
        <div className="wrap"><div className="l" style={{ maxWidth: 560, margin: '0 auto' }}>
          <h1 className="h1">Profile</h1>
          <p className="s2">Your account, orders and shops in one place.</p>

          <div className="gg p">
            <p style={{ fontSize: 16, fontWeight: 600, color: '#1C1C1E' }}>Sign in is coming soon</p>
            <small style={{ display: 'block', fontSize: 14, color: '#5B5F66', marginTop: 2 }}>Customer accounts are on the way.</small>
            <p className="cap" style={{ margin: '12px 0 0' }}>
              You don&apos;t need an account to print. Every order you place is saved on this device and tracked with its own link.
            </p>
            <Link href="/auth/login" className="btn" style={{ marginTop: 12, flex: 'none', height: 44, fontSize: 15, textDecoration: 'none' }}>
              Sign in
            </Link>
          </div>

          <div className="gg">
            <div className="r"><span>Your activity<small>Orders and shops you&apos;ve used.</small></span></div>
            <Link href="/orders" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Your orders</span><span className="v">›</span></Link>
            <Link href="/find-a-shop" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Shops near you</span><span className="v">›</span></Link>
          </div>

          <div className="gg">
            <div className="r"><span>For shopkeepers<small>You run a shop? This is your sign-in.</small></span></div>
            <Link href="/shop/login" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Shopkeeper login</span><span className="v">›</span></Link>
            <Link href="/shop/register" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Register your shop</span><span className="v">›</span></Link>
          </div>
        </div></div>
        <SiteFooter />
      </div>

      <ConsumerTabBar />
    </>
  );
}
