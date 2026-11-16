'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Printer Setup has been removed from the portal. Redirect to dashboard. */
export default function PrinterRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/shop/dashboard'); }, [router]);
  return null;
}
