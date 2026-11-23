'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PrimaryButton } from '@/components/clear/button';
import { Input } from '@/components/clear/input';

/**
 * /track — order lookup by tracking link or order token.
 *
 * Customers paste their tracking link (from the receipt or SMS) or their
 * order token to find their order.
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
    <div className="min-h-[100dvh] bg-[var(--ground)]">
      <main className="max-w-md mx-auto px-5 py-12">
        <h1 className="text-[24px] font-bold text-[var(--label)] tracking-[-0.01em]">Track your order</h1>
        <p className="mt-2 text-[16px] text-[var(--label-2)]">
          Paste your tracking link from your receipt, or your order number.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <Input
            id="track-input"
            label="Tracking link or order number"
            placeholder="https://printelyx.app/o/..."
            value={value}
            onChange={(v) => setValue(v)}
            error={error ?? undefined}
          />
          <PrimaryButton className="w-full">Track order</PrimaryButton>
        </form>
      </main>
    </div>
  );
}
