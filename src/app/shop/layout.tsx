'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useApiClient } from '@/components/portal/use-api-client';
import { AppShell } from '@/components/layout/app-shell';
import type { NavGroup } from '@/components/layout/app-sidebar';
import {
  LayoutDashboard,
  ClipboardList,
  Users,
  Wrench,
  CreditCard,
  FileBarChart,
  Store,
  Clock,
  QrCode,
  Settings,
  ShieldCheck,
} from 'lucide-react';

/**
 * Sidebar navigation for the shopkeeper portal.
 *
 * Main group: Dashboard, Orders, Customers, Services & Pricing, Payments,
 * Reports & Analytics.
 * Settings group: Shop Profile, Business Hours, Payments & UPI, Shop QR,
 * Shop Settings.
 *
 * PrintLatch / printer setup has been removed from the main navigation —
 * it is not a core shopkeeper feature.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/shop/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/shop/orders', label: 'Orders', icon: ClipboardList },
      { href: '/shop/customers', label: 'Customers', icon: Users },
      { href: '/shop/services', label: 'Services & Pricing', icon: Wrench },
      { href: '/shop/payments', label: 'Payments', icon: CreditCard },
      { href: '/shop/reports', label: 'Reports', icon: FileBarChart },
      { href: '/shop/staff', label: 'Staff & Permissions', icon: ShieldCheck },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/shop/settings#profile', label: 'Shop Profile', icon: Store, sub: true },
      { href: '/shop/settings#hours', label: 'Business Hours', icon: Clock, sub: true },
      { href: '/shop/settings#payment', label: 'Payments & UPI', icon: CreditCard, sub: true },
      { href: '/shop/settings#qr', label: 'Shop QR Code', icon: QrCode, sub: true },
      { href: '/shop/settings', label: 'All Settings', icon: Settings, sub: true },
    ],
  },
];

/**
 * Shared layout for every page under /shop/*. The login + register pages
 * render bare (no sidebar, no auth gate) — every other page expects an
 * authenticated owner.
 */
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const api = useApiClient();
  const pathname = usePathname();
  const router = useRouter();
  const [shopName, setShopName] = useState<string | null>(null);

  // Login + register pages render bare (no sidebar, no auth gate).
  const isLoginPage = pathname === '/shop/login' || pathname === '/shop/register';

  // Auth gate: redirect to login unless we're already on it.
  useEffect(() => {
    if (!api.ready) return;
    if (isLoginPage) return;
    if (!api.token || api.role !== 'owner') {
      router.replace('/shop/login');
      return;
    }
    // Lazy-load the shop name for the sidebar header. Best-effort: if it
    // fails the sidebar still renders, just without the shop name.
    void (async () => {
      const r = await api.request<{
        data?: { name?: string; slug?: string };
      }>('GET', '/api/v1/shops/me');
      if (r.status === 200 && r.data?.data?.name) setShopName(r.data.data.name);
    })();
  }, [api.ready, api.token, api.role, isLoginPage, router, api]);

  // Login + register pages render bare — no sidebar, no auth check.
  if (isLoginPage) {
    return <div className="min-h-screen bg-page">{children}</div>;
  }

  // While we wait for the auth state to settle, show a minimal spinner — this
  // avoids a one-frame flash of the dashboard before the redirect fires.
  if (!api.ready || !api.token || api.role !== 'owner') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <div className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          <span className="text-sm">Loading shop portal…</span>
        </div>
      </div>
    );
  }

  const logout = () => {
    api.clearAuth();
    // Hard navigation — avoids any RSC transition race. The auth state is
    // cleared in the shared context + localStorage; a full page load
    // guarantees the login page mounts fresh with no stale token.
    window.location.href = '/shop/login';
  };

  return (
    <AppShell
      navGroups={NAV_GROUPS}
      brandName={shopName ?? 'Shop Portal'}
      brandSubtitle="Shopkeeper Portal"
      brandHref="/shop/dashboard"
      roleBadge="owner"
      onLogout={logout}
      footerHref="/"
      footerLabel="View storefront"
    >
      {children}
    </AppShell>
  );
}
