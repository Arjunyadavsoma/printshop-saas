'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useApiClient } from '@/components/portal/use-api-client';
import { ShopShell } from '@/components/clear/shop-shell';

/**
 * Shared layout for every page under /shop/*.
 *
 * Chrome decision (rebuild, Nov 2026): the Clear `ShopShell` wins and the
 * `ref-shop` system is deleted. Rationale:
 *   - `ShopShell` mounts `{children}` exactly ONCE. The previous layout
 *     mounted Mobile + Tablet + Desktop shells, each with its own copy of
 *     the children, so every page-level effect/fetch ran 3x.
 *   - `ShopShell` is breakpoint-correct by construction: the sidebar is
 *     `hidden lg:flex` and the mobile top bar + bottom tab bar are
 *     `lg:hidden`, so the 768–1023px tablet/desktop overlap (icon rail +
 *     256px sidebar side by side, each with its own copy of the page) is
 *     gone. Below `lg` the portal uses the mobile chrome (top bar + 5-tab
 *     bottom nav: Home / Orders / Payments / Printers / More).
 *   - Its nav points at the real routes: Printers → /shop/devices (the
 *     live device/printer page), Pricing → /shop/services. The old
 *     triple-shell nav pointed Printers at /shop/print-jobs, which only
 *     redirects to /shop/orders.
 *   - The ref-shop pages rendered their own `.ref-screen` 390px chrome and
 *     bypassed every shell, which is what produced the left-aligned
 *     390px column on desktop.
 *
 * Known gaps vs the old triple shell (follow-ups for the shell owner):
 *   - No tablet icon rail and no counter mode (tablet gets mobile chrome).
 *   - No "Open for orders" switch in the sidebar — the toggles live on
 *     /shop/dashboard (spec screen 21), which is where the PDF puts them.
 *   - No sign-out button in the chrome — sign-out lives on /shop/settings.
 *   - The desktop sidebar has no Customers entry (spec lists one) — use
 *     More → Customers on mobile, or /shop/customers directly, until the
 *     shell gains it.
 *
 * Login / register / password-reset pages render bare (no sidebar, no
 * auth gate) — every other page expects an authenticated owner.
 */

interface OrderRow {
  id: string;
  status:
    | 'awaiting_payment'
    | 'paid'
    | 'printing'
    | 'ready'
    | 'collected'
    | 'cancelled'
    | 'refunded';
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const api = useApiClient();
  const pathname = usePathname();
  const router = useRouter();
  const [shopName, setShopName] = useState<string | null>(null);

  // Pending counts surfaced as badges on the Orders + Payments tabs /
  // sidebar rows. Derived client-side from the order list: the list
  // endpoint returns orders (no aggregate counts), so count here.
  const [pendingOrders, setPendingOrders] = useState(0);
  const [pendingPayments, setPendingPayments] = useState(0);

  // Login + register + password-reset pages render bare.
  const isLoginPage =
    pathname === '/shop/login' ||
    pathname === '/shop/register' ||
    pathname === '/shop/forgot-password' ||
    pathname === '/shop/reset-password';

  // Auth gate + lazy-load the shop name.
  useEffect(() => {
    if (!api.ready) return;
    if (isLoginPage) return;
    if (!api.token || api.role !== 'owner') {
      router.replace('/shop/login');
      return;
    }
    void (async () => {
      try {
        const r = await api.request<{
          data?: { name?: string; slug?: string; isActive?: boolean };
        }>('GET', '/api/v1/shops/me');
        if (r.status === 200 && r.data?.data?.name) setShopName(r.data.data.name);
      } catch {
        // Name is decoration — the page still renders.
      }
    })();
  }, [api.ready, api.token, api.role, isLoginPage, router, api]);

  // Best-effort: fetch the pending orders + payments counts for the
  // sidebar badges. Refresh on route change so a fresh tab load after
  // acting on an order doesn't show a stale count.
  useEffect(() => {
    if (!api.ready || !api.token || api.role !== 'owner' || isLoginPage) return;
    void (async () => {
      try {
        const r = await api.request<{ data?: OrderRow[] }>(
          'GET',
          '/api/v1/shops/me/orders?limit=200',
        );
        if (r.status === 200 && r.data?.data) {
          const orders = r.data.data;
          setPendingPayments(orders.filter((o) => o.status === 'awaiting_payment').length);
          setPendingOrders(
            orders.filter((o) => o.status === 'awaiting_payment' || o.status === 'paid').length,
          );
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

  // Single Clear shell — children mount exactly once. The shell itself
  // switches chrome by breakpoint with CSS visibility (sidebar
  // `hidden lg:flex`, mobile top bar + bottom tab bar `lg:hidden`).
  return (
    <ShopShell
      shopName={shopName ?? 'Shop Portal'}
      activePath={pathname ?? '/shop/dashboard'}
      orderCount={pendingOrders}
      paymentCount={pendingPayments}
    >
      {children}
    </ShopShell>
  );
}
