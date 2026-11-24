'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Crosshair } from 'lucide-react';
import {
  geolocationErrorMessage,
  requestGeolocation,
  saveStoredLocation,
  type GeolocationFailure,
} from '@/lib/location/shop-filters';

/**
 * DesktopTopNav — the ≥1024px top navigation for consumer pages, per the
 * redesign reference: logo, primary links (Find Shops, Scan QR Code,
 * Track Order, How It Works), Detect Location action, Register Your Shop,
 * Shopkeeper login and My Orders.
 *
 * "Detect Location" geolocates once, stores the coordinates (sessionStorage,
 * same store the home page and /find-a-shop read) and hands off to
 * /find-a-shop — no invented location names.
 */

const LINKS = [
  { href: '/find-a-shop', label: 'Find Shops' },
  { href: '/scan', label: 'Scan QR Code' },
  { href: '/track', label: 'Track Order' },
  { href: '/how-it-works', label: 'How It Works' },
];

export function DesktopTopNav() {
  const router = useRouter();
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  const detect = async () => {
    setLocating(true);
    setLocError(null);
    try {
      const loc = await requestGeolocation();
      saveStoredLocation(loc);
      router.push('/find-a-shop');
    } catch (cause) {
      const code = (cause as { code?: GeolocationFailure })?.code ?? 'unavailable';
      setLocError(geolocationErrorMessage(code));
    } finally {
      setLocating(false);
    }
  };

  return (
    <div className="hidden lg:block border-b border-[var(--hairline)] frosted-bar" role="banner">
      <div className="mx-auto flex min-h-[64px] max-w-[1120px] items-center gap-6 px-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-[var(--label)]">
          <span className="flex size-7 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--on-accent)]" aria-hidden="true">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9 3 12l9 6 9-6-3-3" />
              <path d="m12 3 9 6-9 6-9-6Z" />
            </svg>
          </span>
          Printelyx
        </Link>

        <nav className="flex items-center gap-1" aria-label="Primary">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full px-3 py-2 text-sm font-medium text-[var(--label-2)] hover:bg-[var(--fill)] hover:text-[var(--label)]"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void detect()}
            disabled={locating}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-[var(--hairline)] bg-[var(--surface)] px-4 text-sm font-medium text-[var(--label)] hover:bg-[var(--fill)] disabled:opacity-60"
          >
            <Crosshair className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {locating ? 'Detecting…' : 'Detect Location'}
          </button>
          <Link
            href="/shop/register"
            className="inline-flex min-h-[40px] items-center rounded-full bg-[var(--accent)] px-4 text-sm font-semibold text-[var(--on-accent)]"
          >
            Register Your Shop
          </Link>
          <Link
            href="/shop/login"
            className="inline-flex min-h-[40px] items-center rounded-full px-3 text-sm font-medium text-[var(--label-2)] hover:text-[var(--label)]"
          >
            Shopkeeper login
          </Link>
          <Link
            href="/orders"
            className="inline-flex min-h-[40px] items-center rounded-full px-3 text-sm font-medium text-[var(--label)] hover:bg-[var(--fill)]"
          >
            My Orders
          </Link>
        </div>
      </div>
      {locError && (
        <p className="mx-auto max-w-[1120px] px-8 pb-2 text-[13px] text-[var(--label-2)]" role="alert">
          {locError}
        </p>
      )}
    </div>
  );
}

export default DesktopTopNav;
