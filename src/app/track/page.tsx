import { TrackPageClient } from './track-client';

export const metadata = { title: 'Track your order',
  alternates: { canonical: '/track' }, };

/** /track — order lookup by order number or tracking link. */
export default function TrackPage() {
  return <TrackPageClient />;
}
