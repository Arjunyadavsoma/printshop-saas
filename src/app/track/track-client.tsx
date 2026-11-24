'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CustomerShell } from '@/components/clear/customer-shell';
import { Search } from 'lucide-react';

/**
 * /track — order lookup by tracking link or order token.
 * Uses CustomerShell + .rv-* classes for visual consistency with the
 * rest of the consumer flow (home, shop, orders, profile, scan).
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

  return (
    <CustomerShell shopName="Printelyx">
      <div className="rv-g" style={{ gap: 14 }}>
        <div>
          <h1 className="text-[27px]">Track your order</h1>
          <p className="rv-t" style={{ margin: '6px 0 0' }}>
            Paste your tracking link from your receipt, or your order number.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ position: 'relative' }}>
            <span
              aria-hidden="true"
              style={{ position: 'absolute', left: 13, top: 13, color: 'var(--rv-muted,#566274)' }}
            >
              <Search className="size-[22px]" strokeWidth={2} />
            </span>
            <label className="rv-t" htmlFor="track-input" style={{ position: 'absolute', left: -9999 }}>
              Tracking link or order number
            </label>
            <input
              id="track-input"
              className="rv-input"
              type="text"
              placeholder="https://printelyx.cc.cd/o/…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
            />
          </div>
          {error && (
            <p className="rv-t mt-2" role="alert" style={{ color: 'var(--danger,#B3261E)' }}>
              {error}
            </p>
          )}
          <button type="submit" className="rv-btn mt-4">
            Track order
          </button>
        </form>

        <div className="rv-card" style={{ padding: 0 }}>
          <Link href="/orders" className="rv-row">
            <span>My orders</span>
            <span className="rv-t" aria-hidden="true">›</span>
          </Link>
          <Link href="/help" className="rv-row">
            <span>Help</span>
            <span className="rv-t" aria-hidden="true">›</span>
          </Link>
        </div>
      </div>
    </CustomerShell>
  );
}
