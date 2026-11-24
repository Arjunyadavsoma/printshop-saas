'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * /track — order lookup by tracking link or order token.
 * Clear design (no dedicated board — derived from the site-page pattern:
 * top bar, heading, card with a labelled input, pill button).
 */
export function TrackPageClient() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Enter your tracking link or order number.');
      return;
    }
    // If it looks like a full tracking URL, extract the token
    if (trimmed.startsWith('http')) {
      try {
        const url = new URL(trimmed);
        const token = url.pathname.split('/o/')[1];
        if (token) {
          router.push(`/o/${token}`);
          return;
        }
      } catch {
        // Not a valid URL — treat as a token
      }
    }
    // Treat as a direct token (hex string)
    if (/^[a-f0-9]{32,}$/i.test(trimmed)) {
      router.push(`/o/${trimmed}`);
      return;
    }
    setError('That does not look like a valid tracking link. Check your receipt for the link.');
  };

  const form = (inputId: string) => (
    <form onSubmit={handleSubmit}>
      <div className="g p">
        <label htmlFor={inputId} style={{ fontSize: 14, fontWeight: 600, display: 'block', marginTop: 12 }}>
          Tracking link or order number
        </label>
        <input
          id={inputId}
          className="in"
          type="text"
          placeholder="https://printelyx.cc.cd/o/…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {error && <p className="cap" role="alert" style={{ color: '#9C1F18' }}>{error}</p>}
        <button type="submit" className="btn" style={{ width: '100%', marginTop: 16 }}>Track order</button>
      </div>
    </form>
  );

  return (
    <>
      <div className="x m">
        <div className="top"><b style={{ color: '#1C1C1E', fontSize: 17 }}>Printelyx</b></div>
        <h1 className="h">Track your order</h1>
        <p className="sub">Paste your tracking link from your receipt, or your order number.</p>
        {form('track-input')}
        <div className="g">
          <Link href="/orders" className="r"><span>My orders</span><span className="v">›</span></Link>
          <Link href="/help" className="r"><span>Help</span><span className="v">›</span></Link>
        </div>
        <p className="cap" />
      </div>

      <div className="x d">
        <div className="dtop">
          <b><i className="dot" />Printelyx</b>
          <Link href="/help" className="v">Help</Link>
        </div>
        <div className="wrap">
          <div className="l">
            <h1 className="h1">Track your order</h1>
            <p className="s2">Paste your tracking link from your receipt, or your order number.</p>
            {form('track-input-d')}
          </div>
        </div>
      </div>
    </>
  );
}
