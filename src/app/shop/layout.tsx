'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useApiClient } from '@/components/portal/use-api-client';
import { AppShell } from '@/components/layout/app-shell';
import type { NavGroup } from '@/components/layout/app-sidebar';
import {
  LayoutDashboard,
  ClipboardList,
  Monitor,
  Printer,
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
import { ShopShellMobile } from '@/components/clear/shop-shell-mobile';
import { ShopShellTablet } from '@/components/clear/shop-shell-tablet';
import { ShopShellDesktop } from '@/components/clear/shop-shell-desktop';

/**
 * Sidebar navigation for the shopkeeper portal — kept for the AppShell
 * fallback path (used when a page renders inside the legacy AppShell,
 * e.g. a settings sub-page that hasn't migrated yet).
 *
 * Main group: Dashboard, Orders, Devices, Customers, Services & Pricing,
 * Payments, Reports & Analytics.
 * Settings group: Shop Profile, Business Hours, Payments & UPI, Shop QR,
 * Shop Settings.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/shop/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/shop/orders', label: 'Orders', icon: ClipboardList },
      { href: '/shop/devices', label: 'Devices', icon: Monitor },
      { href: '/shop/print-jobs', label: 'Print Jobs', icon: Printer },
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
      { href: '/shop/settings#security', label: 'Account Security', icon: ShieldCheck, sub: true },
      { href: '/shop/settings', label: 'All Settings', icon: Settings, sub: true },
    ],
  },
];

/**
 * Shared layout for every page under /shop/*. The login + register pages
 * render bare (no sidebar, no auth gate) — every other page expects an
 * authenticated owner.
 *
 * The chrome is rendered by the new Clear shells:
 *  - ShopShellMobile  for < 768px
 *  - ShopShellTablet  for 768–1023px
 *  - ShopShellDesktop for >= 1024px
 *
 * Breakpoint detection is pure CSS (the shells use Tailwind responsive
 * visibility classes — `md:hidden`, `hidden md:flex lg:hidden`,
 * `hidden lg:flex`). All three render in the tree but only one is
 * visible at a time; the others are `display:none`.
 *
 * The legacy AppShell is retained as a fallback for any sub-route that
 * hasn't migrated to the Clear chrome yet — pass `?legacy=1` to force it.
 */
const OPEN_KEY = 'printshop:shop-open';
const COUNTER_KEY = 'printshop:shop-counter-mode';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const api = useApiClient();
  const pathname = usePathname();
  const router = useRouter();
  const [shopName, setShopName] = useState<string | null>(null);
  const [shopSlug, setShopSlug] = useState<string | null>(null);

  // "Open for orders" + "Counter mode" — presentation-only for now (the
  // backend endpoint to toggle shop.isActive is a follow-up task).
  // Persisted to localStorage so the choice survives a refresh and so
  // the dashboard page (which also reads these keys) stays in sync.
  const [shopOpen, setShopOpen] = useState(true);
  const [counterMode, setCounterMode] = useState(false);

  // Pending counts surfaced as badges on the Orders + Payments tabs /
  // sidebar rows. Best-effort fetch from the shop's me/orders list.
  const [pendingOrders, setPendingOrders] = useState(0);
  const [pendingPayments, setPendingPayments] = useState(0);

  // Login + register + password-reset pages render bare.
  const isLoginPage =
    pathname === '/shop/login' ||
    pathname === '/shop/register' ||
    pathname === '/shop/forgot-password' ||
    pathname === '/shop/reset-password';

  // Ref-shop routes render their own `.ref-screen` chrome (`.ref-top` + 
  // `.ref-tab` / `.ref-sb`) directly in the page — they must NOT be wrapped
  // by the legacy Clear shells (which would produce duplicate top bars +
  // bottom navs). The page itself uses <RefShopLayout> for auth + shop name.
  const isRefShopRoute =
    pathname === '/shop/dashboard' ||
    pathname === '/shop/orders' ||
    pathname === '/shop/payments' ||
    pathname.startsWith('/shop/orders/');

  // Optional ?legacy=1 forces the legacy AppShell chrome for un-migrated pages.
  const useLegacyShell =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('legacy') === '1';

  // Auth gate + lazy-load the shop name + slug.
  useEffect(() => {
    if (!api.ready) return;
    if (isLoginPage) return;
    if (!api.token || api.role !== 'owner') {
      router.replace('/shop/login');
      return;
    }
    void (async () => {
      const r = await api.request<{
        data?: { name?: string; slug?: string; isActive?: boolean };
      }>('GET', '/api/v1/shops/me');
      if (r.status === 200 && r.data?.data) {
        if (r.data.data.name) setShopName(r.data.data.name);
        if (r.data.data.slug) setShopSlug(r.data.data.slug);
        // Seed the open toggle from the shop's isActive the first time.
        if (r.data.data.isActive != null) {
          const stored = window.localStorage.getItem(OPEN_KEY);
          if (stored === null) setShopOpen(Boolean(r.data.data.isActive));
        }
      }
    })();
  }, [api.ready, api.token, api.role, isLoginPage, router, api]);

  // Restore the open + counter-mode flags from localStorage on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedOpen = window.localStorage.getItem(OPEN_KEY);
    if (storedOpen !== null) setShopOpen(storedOpen === '1');
    const storedCounter = window.localStorage.getItem(COUNTER_KEY);
    if (storedCounter !== null) setCounterMode(storedCounter === '1');
  }, []);

  // Persist open + counter-mode flags.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(OPEN_KEY, shopOpen ? '1' : '0');
  }, [shopOpen]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(COUNTER_KEY, counterMode ? '1' : '0');
  }, [counterMode]);

  // Best-effort: fetch the pending orders + payments counts for the
  // sidebar badges. Refresh on route change so a fresh tab load after
  // acting on an order doesn't show a stale count.
  useEffect(() => {
    if (!api.ready || !api.token || api.role !== 'owner' || isLoginPage) return;
    void (async () => {
      try {
        const r = await api.request<{
          data?: { pendingCount?: number; paymentPendingCount?: number };
        }>('GET', '/api/v1/shops/me/orders?status=awaiting_payment,paid');
        if (r.status === 200 && r.data?.data) {
          setPendingOrders(r.data.data.pendingCount ?? 0);
          setPendingPayments(r.data.data.paymentPendingCount ?? 0);
        }
      } catch {
        // Counts are decoration — silent on failure.
      }
    })();
  }, [api, api.ready, api.token, api.role, isLoginPage, pathname]);

  // Login + register pages render bare — no sidebar, no auth check.
  if (isLoginPage) {
    return <div className="min-h-screen bg-page">{children}</div>;
  }

  // While we wait for the auth state to settle, show a minimal spinner.
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

  const logout = async () => {
    await api.logout();
    window.location.href = '/shop/login';
  };

  const footerHref = shopSlug ? `/shops/${shopSlug}` : '/shop/dashboard';

  // Ref-shop routes render their own `.ref-screen` chrome (top bar, bottom
  // tab bar / desktop sidebar) directly in the page. The page does its own
  // shop-name fetch + auth refresh; we just pass the children through bare.
  if (isRefShopRoute) {
    return <div className="min-h-dvh bg-page">{children}</div>;
  }

  // Legacy fallback (for un-migrated sub-pages that opt in via ?legacy=1).
  if (useLegacyShell) {
    return (
      <AppShell
        navGroups={NAV_GROUPS}
        brandName={shopName ?? 'Shop Portal'}
        brandSubtitle="Shopkeeper Portal"
        brandHref="/shop/dashboard"
        roleBadge="owner"
        onLogout={logout}
        footerHref={footerHref}
        footerLabel="View storefront"
      >
        {children}
      </AppShell>
    );
  }

  // Clear shells — all three render, CSS shows only one at a time.
  // The visible chrome depends on the viewport; children render once
  // per shell (acceptable for the shop portal's mostly-server-component
  // children).
  return (
    <>
      <ShopShellMobile
        shopName={shopName ?? 'Shop Portal'}
        open={shopOpen}
        onToggleOpen={setShopOpen}
        pendingOrdersCount={pendingOrders}
        pendingPaymentsCount={pendingPayments}
      >
        {children}
      </ShopShellMobile>
      <ShopShellTablet
        shopName={shopName ?? 'Shop Portal'}
        open={shopOpen}
        onToggleOpen={setShopOpen}
        pendingOrdersCount={pendingOrders}
        pendingPaymentsCount={pendingPayments}
        counterMode={counterMode}
        onToggleCounterMode={setCounterMode}
        onLogout={logout}
      >
        {children}
      </ShopShellTablet>
      <ShopShellDesktop
        shopName={shopName ?? 'Shop Portal'}
        open={shopOpen}
        onToggleOpen={setShopOpen}
        pendingOrdersCount={pendingOrders}
        pendingPaymentsCount={pendingPayments}
        onLogout={logout}
      >
        {children}
      </ShopShellDesktop>
    </>
  );
}
