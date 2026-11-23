'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  ClipboardList,
  CreditCard,
  Printer,
  Settings,
  LogOut,
  Maximize2,
} from 'lucide-react';
import { Switch } from './switch';
import { Badge } from './badge';

/**
 * ShopShellTablet — the Clear design system chrome for the shopkeeper
 * portal on medium viewports (768–1023px).
 *
 * Layout:
 *  - Left icon rail (~72px wide): just icons — Home, Orders (badge),
 *    Payments (badge), Printers, Settings — with the active one tinted
 *    accent + a tiny accent strip on the left edge. Below the icons:
 *    a "Counter mode" toggle + logout.
 *  - Content fills the rest, max-width 960px.
 *
 * "Counter mode" (the optional Maximize2 toggle) flips the content into
 * a simplified, bigger-type board intended for a shared counter tablet:
 * when `counterMode` is true, the children render with an extra
 * `data-counter-mode` attribute + a `.counter-mode` class so the page
 * can opt into larger type + simplified chrome. This shell itself does
 * not change layout much — the counter mode is a content-level
 * affordance.
 *
 * Touch targets are 56px (the spec calls for "larger touch targets" on
 * tablet vs. the 48px mobile floor).
 */

export interface ShopShellTabletProps {
  shopName: string;
  open: boolean;
  onToggleOpen: (next: boolean) => void;
  pendingOrdersCount?: number;
  pendingPaymentsCount?: number;
  counterMode: boolean;
  onToggleCounterMode: (next: boolean) => void;
  onLogout: () => void;
  children: ReactNode;
}

interface RailItemDef {
  href: string;
  label: string;
  Icon: typeof LayoutDashboard;
  badge?: number;
}

export function ShopShellTablet({
  shopName,
  open,
  onToggleOpen,
  pendingOrdersCount = 0,
  pendingPaymentsCount = 0,
  counterMode,
  onToggleCounterMode,
  onLogout,
  children,
}: ShopShellTabletProps) {
  const pathname = usePathname() ?? '';
  const rail: RailItemDef[] = [
    { href: '/shop/dashboard', label: 'Home', Icon: LayoutDashboard },
    { href: '/shop/orders', label: 'Orders', Icon: ClipboardList, badge: pendingOrdersCount },
    { href: '/shop/payments', label: 'Payments', Icon: CreditCard, badge: pendingPaymentsCount },
    { href: '/shop/print-jobs', label: 'Printers', Icon: Printer },
    { href: '/shop/settings', label: 'Settings', Icon: Settings },
  ];

  return (
    <div
      className={[
        'hidden md:flex lg:hidden min-h-dvh bg-[var(--ground)]',
        counterMode ? 'counter-mode' : '',
      ].join(' ')}
      data-counter-mode={counterMode ? 'true' : 'false'}
    >
      {/* Icon rail */}
      <aside
        className="w-[72px] shrink-0 h-dvh sticky top-0 bg-[var(--surface)] border-r border-[var(--hairline)] flex flex-col items-stretch py-3"
        aria-label="Shop navigation"
      >
        {/* Shop dot — no name on the rail (too narrow). The full name is
            rendered at the top of the content via the page itself. */}
        <div className="px-3 pb-3 flex flex-col items-center gap-2 border-b border-[var(--hairline)]">
          <span
            className={[
              'inline-block size-2.5 rounded-full',
              open ? 'bg-[var(--success)]' : 'bg-[var(--label-3)]',
            ].join(' ')}
            aria-hidden="true"
          />
          <Switch
            checked={open}
            onChange={onToggleOpen}
            aria-label={`Open for orders — ${shopName}`}
          />
        </div>

        {/* Rail items */}
        <nav className="flex-1 overflow-y-auto py-2" aria-label="Sections">
          <ul className="flex flex-col items-stretch gap-1 px-2">
            {rail.map((item) => {
              const active = isActive(pathname, item.href);
              const { Icon } = item;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    aria-label={item.label}
                    title={item.label}
                    className={[
                      'relative flex flex-col items-center justify-center gap-1',
                      'min-h-[56px] rounded-[var(--radius-input)]',
                      'transition-colors duration-150',
                      'focus:outline-none',
                      active
                        ? 'bg-[var(--accent-tint)] text-[var(--accent-tint-text)]'
                        : 'text-[var(--label-2)] hover:bg-[var(--fill)] hover:text-[var(--label)]',
                    ].join(' ')}
                  >
                    {/* Active strip on the left edge — the Clear "where am I" affordance. */}
                    {active && (
                      <span
                        className="absolute left-0 top-2 bottom-2 w-1 rounded-full bg-[var(--accent)]"
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative inline-flex">
                      <Icon
                        className="size-6"
                        strokeWidth={active ? 2.4 : 2}
                        aria-hidden="true"
                      />
                      {item.badge ? (
                        <Badge
                          count={item.badge}
                          className="absolute -top-1.5 -right-2"
                        />
                      ) : null}
                    </span>
                    <span
                      className={[
                        'text-[11px] font-semibold leading-none',
                        active ? 'text-[var(--accent-tint-text)]' : 'text-[var(--label-2)]',
                      ].join(' ')}
                    >
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Counter mode + logout */}
        <div className="px-2 pt-2 border-t border-[var(--hairline)] flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleCounterMode(!counterMode)}
            aria-pressed={counterMode}
            aria-label="Counter mode"
            title="Counter mode — bigger type, simplified board"
            className={[
              'flex items-center justify-center min-h-[48px] w-full rounded-[var(--radius-input)]',
              'transition-colors duration-150',
              'focus:outline-none',
              counterMode
                ? 'bg-[var(--accent-tint)] text-[var(--accent-tint-text)]'
                : 'text-[var(--label-2)] hover:bg-[var(--fill)] hover:text-[var(--label)]',
            ].join(' ')}
          >
            <Maximize2 className="size-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sign out"
            title="Sign out"
            className={[
              'flex items-center justify-center min-h-[48px] w-full rounded-[var(--radius-input)]',
              'text-[var(--label-2)] hover:bg-[var(--fill)] hover:text-[var(--label)]',
              'transition-colors duration-150',
              'focus:outline-none',
            ].join(' ')}
          >
            <LogOut className="size-5" aria-hidden="true" />
          </button>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <main className="mx-auto w-full max-w-[960px] px-5 py-5 safe-bottom">
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

export default ShopShellTablet;
