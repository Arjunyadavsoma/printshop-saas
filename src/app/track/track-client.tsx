'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConsumerTabBar } from '@/components/clear/consumer-tab-bar';
import { SiteFooter } from '@/components/clear/site-footer';

/**
 * /track — order lookup by tracking link or order token.
 * Clear design (matches the homepage: .x/.m mobile + .x/.d desktop).
 */
export function TrackPageClient() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = value.trim();
    if (!trimmed) { setError('Enter your tracking link or order number.'); return; }
    if (trimmed.startsWith('http')) {
      try {
        const url = new URL(trimmed);
        const token = url.pathname.split('/o/')[1];
        if (token) { router.push(`/o/${token}`); return; }
      } catch { /* not a URL */ }
    }
    if (/^[a-f0-9]{32,}$/i.test(trimmed)) { router.push(`/o/${trimmed}`); return; }
    setError('That does not look like a valid tracking link. Check your receipt for the link.');
  };

  const form = () => (
    <form onSubmit={handleSubmit}>
      <div className="g p">
        <label htmlFor="track-input" style={{ fontSize: 14, fontWeight: 600, display: 'block', marginTop: 12 }}>Tracking link or order number</label>
        <input id="track-input" className="in" type="text" placeholder="https://printelyx.cc.cd/o/…" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        {error && <p className="cap" role="alert" style={{ color: '#9C1F18', margin: '8px 0 0' }}>{error}</p>}
        <button type="submit" className="btn" style={{ width: '100%', marginTop: 16 }}>Track order</button>
      </div>
    </form>
  );

  return (
    <>
      {/* Mobile */}
      <div className="x m">
        <div className="top"><i className="dot" /><b style={{ color: '#1C1C1E', fontSize: 17 }}>Printelyx</b></div>
        <h1 className="h">Track your order</h1>
        <p className="sub">Paste your tracking link from your receipt, or your order number.</p>
        {form()}
        <div className="g">
          <Link href="/orders" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>My orders</span><span className="v">›</span></Link>
          <Link href="/help" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Help</span><span className="v">›</span></Link>
        </div>
        <div style={{ height: 'calc(80px + env(safe-area-inset-bottom))' }} />
      </div>

      {/* Desktop */}
      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />Printelyx</b>
          <span className="v">
            <Link href="/" style={{ color: '#5B5F66', textDecoration: 'none', marginRight: 20 }}>Home</Link>
            <Link href="/help" style={{ color: '#5B5F66', textDecoration: 'none' }}>Help</Link>
          </span>
        </div>
        <div className="wrap"><div className="l" style={{ maxWidth: 560, margin: '0 auto' }}>
          <h1 className="h1">Track your order</h1>
          <p className="s2">Paste your tracking link from your receipt, or your order number.</p>
          {form()}
          <div className="gg">
            <Link href="/orders" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>My orders</span><span className="v">›</span></Link>
            <Link href="/help" className="r" style={{ textDecoration: 'none', color: 'inherit' }}><span>Help</span><span className="v">›</span></Link>
          </div>
        </div></div>
        <SiteFooter />
      </div>

      <ConsumerTabBar />
    </>
  );
}
