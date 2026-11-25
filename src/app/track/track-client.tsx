'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConsumerPage } from '@/components/clear/consumer-page';
import { Input } from '@/components/clear/input';
import { PrimaryButton } from '@/components/clear/button';

/**
 * /track — order lookup by tracking link or order token.
 *
 * Shared consumer shell (ConsumerPage: SiteHeader + centred column +
 * SiteFooter + ConsumerTabBar) — the old `.x .m` / `.x .d` dual canvas
 * with duplicated mobile + desktop markup is gone. Behaviour is
 * unchanged: same token/URL parsing, same error copy, same links.
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

  return (
    <ConsumerPage>
      <h1 className="type-hero">Track your order</h1>
      <p className="type-sub mt-2">Paste your tracking link from your receipt, or your order number.</p>

      <form onSubmit={handleSubmit} className="mt-6">
        <div className="space-y-4 rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] p-4">
          <Input
            id="track-input"
            label="Tracking link or order number"
            placeholder="https://printelyx.cc.cd/o/…"
            value={value}
            onChange={(v) => { setValue(v); setError(null); }}
            autoComplete="off"
            error={error ?? undefined}
          />
          <PrimaryButton type="submit" className="w-full">
            Track order
          </PrimaryButton>
        </div>
      </form>

      <div className="mt-4 rounded-[22px] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-1">
        <Link href="/orders" className="r"><span>My orders</span><span className="v">›</span></Link>
        <Link href="/help" className="r"><span>Help</span><span className="v">›</span></Link>
      </div>
    </ConsumerPage>
  );
}
