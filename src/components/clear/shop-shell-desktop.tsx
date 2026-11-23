'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ClipboardList,
  CreditCard,
  Printer,
  Wrench,
  FileBarChart,
  Settings,
  LogOut,
} from 'lucide-react';
import { Switch } from './switch';
import { Chip } from './chip';

/**
 * ShopShellDesktop — the Clear design system chrome for the shopkeeper
 * portal on large viewports (>= 1024px).
 *
 * Layout:
 *  - 256px sidebar (fixed left): shop name, open-for-orders switch,
 *    nav (Home, Orders, Payments, Printers, Pricing, Reports, Settings),
 *    + a footer logout.
 *  - Content slot fills the rest, max-width 1280px, centred.
 *
 * The "active" nav item gets a tinted accent background + 600-weight label,
 * matching the Clear spec ("active: tinted accent bg, 600").
 *
 * Order detail opens as a RIGHT DRAWER on this breakpoint — the
 * `onOpenDrawer`/`drawer` slot is rendered via a portal in the consuming
 * page (using the Clear Sheet component with desktop right-drawer mode),
 * so this shell itself stays layout-only.
 */

export interface ShopShellDesktopProps {
  shopName: string;
  open: boolean;
  onToggleOpen: (next: boolean) => void;
  pendingOrdersCount?: number;
  pendingPaymentsCount?: number;
  onLogout: () => void;
  children: ReactNode;
}

interface NavItemDef {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
  count?: number;
}

export function ShopShellDesktop({
  shopName,
  open,
  onToggleOpen,
  pendingOrdersCount = 0,
  pendingPaymentsCount = 0,
  onLogout,
  children,
}: ShopShellDesktopProps) {
  const pathname = usePathname() ?? '';
  const nav: NavItemDef[] = [
    { href: '/shop/dashboard', label: 'Home', Icon: LayoutDashboard },
    { href: '/shop/orders', label: 'Orders', Icon: ClipboardList, count: pendingOrdersCount },
    { href: '/shop/payments', label: 'Payments', Icon: CreditCard, count: pendingPaymentsCount },
    { href: '/shop/print-jobs', label: 'Printers', Icon: Printer },
    { href: '/shop/services', label: 'Pricing', Icon: Wrench },
    { href: '/shop/reports', label: 'Reports', Icon: FileBarChart },
    { href: '/shop/settings', label: 'Settings', Icon: Settings },
  ];

  return (
    <div className="hidden md:flex min-h-dvh bg-[var(--ground)]">
      {/* Sidebar */}
      <aside
        className="w-[256px] shrink-0 h-dvh sticky top-0 bg-[var(--surface)] border-r border-[var(--hairline)] flex flex-col"
        aria-label="Shop navigation"
      >
        {/* Shop identity + open switch */}
        <div className="px-4 pt-4 pb-3 border-b border-[var(--hairline)]">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={[
                'inline-block size-2 rounded-full shrink-0',
                open ? 'bg-[var(--success)]' : 'bg-[var(--label-3)]',
              ].join(' ')}
              aria-hidden="true"
            />
            <h2 className="text-base font-semibold text-[var(--label)] truncate leading-tight">
              {shopName}
            </h2>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[13px] text-[var(--label-2)]">
              {open ? 'Open for orders' : 'Closed'}
            </span>
            <Switch
              checked={open}
              onChange={onToggleOpen}
              aria-label="Open for orders"
            />
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Sections">
          <ul className="flex flex-col gap-0.5">
            {nav.map((item) => {
              const active = isActive(pathname, item.href);
              const { Icon } = item;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={[
                      'flex items-center gap-3 w-full',
                      'min-h-[44px] px-3 rounded-[var(--radius-input)]',
                      'text-sm transition-colors duration-150',
                      'focus:outline-none',
                      active
                        ? 'bg-[var(--accent-tint)] text-[var(--accent-tint-text)] font-semibold'
                        : 'text-[var(--label-2)] hover:bg-[var(--fill)] hover:text-[var(--label)] font-medium',
                    ].join(' ')}
                  >
                    <Icon
                      className="size-5 shrink-0"
                      strokeWidth={active ? 2.4 : 2}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.count ? (
                      <Chip
                        label={String(item.count)}
                        selected={active}
                        onClick={() => undefined}
                        className="pointer-events-none"
                      />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer logout */}
        <div className="px-3 py-3 border-t border-[var(--hairline)]">
          <button
            type="button"
            onClick={onLogout}
            className={[
              'flex items-center gap-3 w-full',
              'min-h-[44px] px-3 rounded-[var(--radius-input)]',
              'text-sm font-medium text-[var(--label-2)]',
              'hover:bg-[var(--fill)] hover:text-[var(--label)]',
              'transition-colors duration-150',
              'focus:outline-none',
            ].join(' ')}
          >
            <LogOut className="size-5 shrink-0" aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <main className="mx-auto w-full max-w-[1280px] px-6 py-6 safe-bottom">
          {children}
        </main>
      </div>
    </div>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  return pathname.startsWith(href + '/');
}

export default ShopShellDesktop;
