'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * M22 fix: this route is kept as a safety-net redirect for any stale
 * bookmarks / external links / cached PWA shortcuts that still point at
 * /shop/printer. All in-app links now point at /shop/devices (the live
 * device-management route), so this redirect only fires for legacy URLs.
 *
 * It redirects to /shop/devices (the canonical destination) rather than
 * /shop/dashboard — that way a user who clicked a stale "Printer Setup"
 * PWA shortcut lands on the device-management page they were trying to
 * reach, not the generic dashboard.
 */
export default function PrinterRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/shop/devices'); }, [router]);
  return null;
}
