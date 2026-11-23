'use client';

/**
 * RefShopTabBar — the bottom mobile navigation bar that appears on every
 * mobile shop-portal page (Screens 09, 10, 11). Matches the `.ref-tab`
 * CSS class in globals.css 1:1.
 *
 * Five tabs: Home, Orders, Payments, Printers, More.
 * Active tab determined by the current pathname.
 *
 * Used by:
 *  - /shop/dashboard       (Home active)
 *  - /shop/orders/[id]     (Orders active — sub-route of /shop/orders)
 *  - /shop/payments        (Payments active)
 *
 * NOT used by /shop/orders (desktop kanban — Screen 12 has no bottom tab bar,
 * it uses the sidebar `.ref-sb`).
 *
 * Implementation note: the `.ref-tab span` CSS rule styles span elements
 * inside `.ref-tab`. We render each tab as a Next.js <Link> wrapping a
 * <span> so the CSS selectors apply (the <Link> itself isn't styled —
 * we strip its default underline + colour via inline style).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type TabKey = 'home' | 'orders' | 'payments' | 'printers' | 'more';

const TABS: Array<{ key: TabKey; label: string; href: string }> = [
  { key: 'home', label: 'Home', href: '/shop/dashboard' },
  { key: 'orders', label: 'Orders', href: '/shop/orders' },
  { key: 'payments', label: 'Payments', href: '/shop/payments' },
  { key: 'printers', label: 'Printers', href: '/shop/printer' },
  { key: 'more', label: 'More', href: '/shop/settings' },
];

function activeTab(pathname: string): TabKey {
  if (pathname === '/shop/dashboard') return 'home';
  if (pathname.startsWith('/shop/orders')) return 'orders';
  if (pathname.startsWith('/shop/payments')) return 'payments';
  if (pathname.startsWith('/shop/printer')) return 'printers';
  if (
    pathname.startsWith('/shop/settings') ||
    pathname.startsWith('/shop/devices') ||
    pathname.startsWith('/shop/print-jobs') ||
    pathname.startsWith('/shop/services') ||
    pathname.startsWith('/shop/staff') ||
    pathname.startsWith('/shop/reports') ||
    pathname.startsWith('/shop/customers')
  ) {
    return 'more';
  }
  return 'home';
}

export interface RefShopTabBarProps {
  /** Reserved for future use — the reference design doesn't surface chips
   *  on the tab bar (badges live in the desktop sidebar instead). Kept in
   *  the props signature so callers can pass pending counts without breaking
   *  if we re-introduce them later. */
  pendingPayments?: number;
  pendingOrders?: number;
}

export function RefShopTabBar(_: RefShopTabBarProps) {
  const pathname = usePathname() ?? '';
  const active = activeTab(pathname);
  return (
    <div className="ref-tab" role="tablist" aria-label="Shopkeeper navigation">
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            style={{ textDecoration: 'none', color: 'inherit' }}
            aria-label={tab.label}
          >
            <span className={isActive ? 'on' : ''} role="tab" aria-selected={isActive}>
              <i aria-hidden="true" />
              {tab.label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default RefShopTabBar;
