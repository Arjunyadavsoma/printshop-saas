'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  ClipboardList,
  CreditCard,
  Printer,
  MoreHorizontal,
} from 'lucide-react';
import { Badge } from './badge';
import { Switch } from './switch';

/**
 * ShopShellMobile — the Clear design system chrome for the shopkeeper
 * portal on small viewports (< 768px).
 *
 * Layout:
 *  - Top bar (sticky, frosted): shop name + open-for-orders switch.
 *  - Content slot fills the middle.
 *  - Bottom tab bar (sticky, frosted): Home, Orders (badge), Payments
 *    (badge), Printers, More. Five tabs, 22-24px icons + 12/600 labels,
 *    min 48px touch targets, active tab in accent. Safe-area aware.
 *
 * No hamburger menu — the "More" tab routes to a settings index page
 * rather than opening an overflow drawer.
 *
 * Badge counts are passed in as numbers; a count of 0 renders nothing
 * (the absence is the signal — see Badge).
 */

export interface ShopShellMobileProps {
  /** Shop display name. */
  shopName: string;
  /** Whether the shop is currently accepting orders. */
  open: boolean;
  /** Toggle the open-for-orders switch. */
  onToggleOpen: (next: boolean) => void;
  /** Pending orders count — surfaces as a badge on the Orders tab. */
  pendingOrdersCount?: number;
  /** Pending payments count — surfaces as a badge on the Payments tab. */
  pendingPaymentsCount?: number;
  /** Page content. */
  children: ReactNode;
}

interface TabDef {
  href: string;
  label: string;
  Icon: typeof Home;
  badge?: number;
}

export function ShopShellMobile({
  shopName,
  open,
  onToggleOpen,
  pendingOrdersCount = 0,
  pendingPaymentsCount = 0,
  children,
}: ShopShellMobileProps) {
  const pathname = usePathname() ?? '';
  const tabs: TabDef[] = [
    { href: '/shop/dashboard', label: 'Home', Icon: Home },
    { href: '/shop/orders', label: 'Orders', Icon: ClipboardList, badge: pendingOrdersCount },
    { href: '/shop/payments', label: 'Payments', Icon: CreditCard, badge: pendingPaymentsCount },
    { href: '/shop/print-jobs', label: 'Printers', Icon: Printer },
    { href: '/shop/settings', label: 'More', Icon: MoreHorizontal },
  ];

  return (
    <div className="min-h-dvh flex flex-col bg-[var(--ground)] md:hidden">
      {/* Top bar */}
      <header
        className="sticky top-0 z-30 frosted-bar border-b border-[var(--hairline)] safe-top"
        role="banner"
      >
        <div className="flex items-center gap-3 px-4 min-h-[56px]">
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span
              className={[
                'inline-block size-2 rounded-full shrink-0',
                open ? 'bg-[var(--success)]' : 'bg-[var(--label-3)]',
              ].join(' ')}
              aria-hidden="true"
            />
            <h1 className="text-base font-semibold text-[var(--label)] truncate leading-tight">
              {shopName}
            </h1>
          </div>
          <Switch
            checked={open}
            onChange={onToggleOpen}
            aria-label="Open for orders"
          />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 w-full mx-auto max-w-[640px] px-4 pt-4 pb-24 safe-bottom">
        {children}
      </main>

      {/* Bottom tab bar */}
      <nav
        className="sticky bottom-0 z-30 frosted-bar border-t border-[var(--hairline)] safe-bottom-bar md:hidden"
        role="tablist"
        aria-label="Shopkeeper navigation"
      >
        <ul className="flex items-stretch justify-around">
          {tabs.map((tab) => {
            const active = isActive(pathname, tab.href);
            const { Icon } = tab;
            return (
              <li key={tab.href} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'flex flex-col items-center justify-center gap-0.5',
                    'min-h-[48px] py-1.5 px-1',
                    'transition-colors duration-150',
                    'focus:outline-none',
                    active
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--label-2)] hover:text-[var(--label)]',
                  ].join(' ')}
                >
                  <span className="relative inline-flex">
                    <Icon
                      className="size-[22px]"
                      strokeWidth={active ? 2.4 : 2}
                      aria-hidden="true"
                    />
                    {tab.badge ? (
                      <Badge
                        count={tab.badge}
                        className="absolute -top-1.5 -right-2"
                      />
                    ) : null}
                  </span>
                  <span
                    className={[
                      'text-[12px] font-semibold leading-none',
                      active ? 'text-[var(--accent)]' : 'text-[var(--label-2)]',
                    ].join(' ')}
                  >
                    {tab.label}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

/** A tab is active when the pathname matches the tab href, or any sub-path
 *  of it. `/shop/orders/123` matches `/shop/orders`. */
function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // Avoid false-positive where /shop/orders matches /shop/print-jobs by prefix.
  return pathname.startsWith(href + '/');
}

export default ShopShellMobile;
