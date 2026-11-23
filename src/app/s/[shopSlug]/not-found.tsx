import Link from 'next/link';
import { Store } from 'lucide-react';

import { AppBar } from '@/components/clear/app-bar';

/**
 * /s/[shopSlug]/not-found — renders when `notFound()` is called from the
 * shop landing's server component (slug didn't match any shop).
 *
 * Kept deliberately distinct from the generic root `not-found.tsx` so the
 * customer gets a shop-themed message ("Shop not found") instead of the
 * generic "Page not found". Offers a link back to the shop discovery grid.
 */
export default function ShopNotFound() {
  return (
    <div className="customer-flow">
      <AppBar title="Shop not found" />
      <main className="mx-auto max-w-xl px-6 py-12">
        <div
          className="flex flex-col items-center justify-center text-center"
          role="alert"
        >
          <div
            className="flex size-14 items-center justify-center rounded-full bg-[rgb(0_111_166_/_0.12)] text-[var(--color-cyan-ink)]"
            aria-hidden="true"
          >
            <Store className="size-7" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-[var(--color-ink)]">
            Shop not found
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted)] max-w-xs">
            The shop link is invalid or the shop is no longer listed. Scan the QR code at the shop again, or browse all shops.
          </p>
          <Link
            href="/"
            className="touch-target mt-5 inline-flex items-center justify-center rounded-[var(--radius-default)] bg-[var(--color-cyan-ink)] px-6 py-3 text-sm font-medium text-white min-h-[48px]"
          >
            Browse all shops
          </Link>
        </div>
      </main>
    </div>
  );
}
