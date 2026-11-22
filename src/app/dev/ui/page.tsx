import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Customer Component Gallery — PrintShop Redesign',
  description: 'Dev-only gallery showing every customer component in every state.',
  robots: { index: false, follow: false },
};

/**
 * /dev/ui — the customer component gallery.
 *
 * Shows every component from /components/customer in every state
 * (default, pressed, focus, disabled, loading, error). Dev-only —
 * not linked from production navigation.
 *
 * The gallery itself is a client component (needs interactivity for
 * toggling states, opening sheets, etc.). See gallery-client.tsx.
 */
export default function DevUIPage() {
  return <GalleryClient />;
}

// Lazy import the client component to keep this server component thin.
import { GalleryClient } from './gallery-client';
