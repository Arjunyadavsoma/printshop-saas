'use client';

import dynamic from 'next/dynamic';
import { CustomerFlowSkeleton } from './CustomerFlowSkeleton';

/**
 * CustomerOrderFlowV2Lazy — a thin Client Component wrapper around the
 * `next/dynamic` import of CustomerOrderFlowV2.
 *
 * Why this exists: Next.js 16 forbids `ssr: false` on `next/dynamic` when
 * the caller is a Server Component (the previous `page.tsx` was a Server
 * Component that called `dynamic(..., { ssr: false })` directly — that
 * broke compilation of every route in the app, not just /s/[shopSlug],
 * because the dev server treats any compilation error in a route file as
 * a hard 500 for every request while the broken module is on disk).
 *
 * The fix is the one the Next.js 16 error message itself recommends:
 * move the `dynamic(..., { ssr: false })` call into a Client Component,
 * then the Server Component (page.tsx) imports this wrapper. The wrapper
 * is `'use client'`, so `ssr: false` is legal again, and the lazy chunk
 * behaviour (lighter initial JS, skeleton placeholder, hydrate after
 * mount) is preserved exactly.
 *
 * CustomerOrderFlowV2 uses IndexedDB, the File API, and other client-only
 * state that can't be meaningfully server-rendered; rendering a skeleton
 * on the server is faster + correct.
 */
const CustomerOrderFlowV2 = dynamic(
  () => import('./CustomerOrderFlowV2').then((m) => m.CustomerOrderFlowV2),
  {
    loading: () => <CustomerFlowSkeleton />,
    ssr: false,
  },
);

export interface CustomerOrderFlowV2LazyProps {
  shopSlug: string;
  shopName: string;
  upiId: string;
  upiPayeeName: string;
  paymentMode: string;
  retentionHours: number;
}

export function CustomerOrderFlowV2Lazy(props: CustomerOrderFlowV2LazyProps) {
  return <CustomerOrderFlowV2 {...props} />;
}
