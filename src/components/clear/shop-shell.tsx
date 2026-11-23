'use client';

import { type ReactNode } from 'react';
import { Home, ClipboardList, CreditCard, Monitor, MoreHorizontal } from 'lucide-react';
import { Badge } from './badge';

/**
 * ShopBottomTabBar — mobile bottom navigation for the shopkeeper portal.
 *
 * Frosted bar, safe-area aware. Icons 22-24px + 12/600 label.
 * Active tab in accent. Badges for Orders + Payments counts.
 * Min touch target 48px.
 */

interface Tab {
  href: string;
  label: string;
  icon: typeof Home;
  badge?: number;
}

const TABS: Tab[] = [
  { href: '/shop/dashboard', label: 'Home', icon: Home },
  { href: '/shop/orders', label: 'Orders', icon: ClipboardList },
  { href: '/shop/payments', label: 'Payments', icon: CreditCard },
  { href: '/shop/devices', label: 'Printers', icon: Monitor },
  { href: '/shop/settings', label: 'More', icon: MoreHorizontal },
];

export function ShopBottomTabBar({ activePath, orderCount = 0, paymentCount = 0 }: { activePath: string; orderCount?: number; paymentCount?: number }) {
  const tabs = TABS.map((t) => ({
    ...t,
    badge: t.href === '/shop/orders' ? orderCount : t.href === '/shop/payments' ? paymentCount : undefined,
  }));

  return (
    <nav
      className="lg:hidden sticky bottom-0 z-20 frosted-bar border-t border-[var(--hairline)] safe-bottom-bar"
      aria-label="Shopkeeper navigation"
    >
      <div className="flex items-stretch justify-around">
        {tabs.map((tab) => {
          const isActive = activePath.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <a
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className="relative flex flex-col items-center justify-center gap-1 py-2 px-3 min-w-[48px] flex-1"
            >
              <span className="relative">
                <Icon
                  className={`size-[22px] ${isActive ? 'text-[var(--accent)]' : 'text-[var(--label-3)]'}`}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                {tab.badge ? <Badge count={tab.badge} /> : null}
              </span>
              <span className={`text-[12px] font-semibold ${isActive ? 'text-[var(--accent)]' : 'text-[var(--label-3)]'}`}>
                {tab.label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * ShopSidebar — desktop sidebar for the shopkeeper portal.
 * 240px, white, hairline right border.
 */
export function ShopSidebar({ activePath, shopName, orderCount = 0, paymentCount = 0 }: { activePath: string; shopName: string; orderCount?: number; paymentCount?: number }) {
  const navItems = [
    { href: '/shop/dashboard', label: 'Home' },
    { href: '/shop/orders', label: 'Orders', badge: orderCount },
    { href: '/shop/payments', label: 'Payments', badge: paymentCount },
    { href: '/shop/devices', label: 'Printers' },
    { href: '/shop/services', label: 'Pricing' },
    { href: '/shop/reports', label: 'Reports' },
    { href: '/shop/settings', label: 'Settings' },
  ];

  return (
    <aside
      className="hidden lg:flex flex-col w-[240px] shrink-0 bg-[var(--surface)] border-r border-[var(--hairline)] h-[100dvh] sticky top-0"
      aria-label="Shopkeeper sidebar"
    >
      <div className="p-5 border-b border-[var(--hairline)]">
        <p className="text-[15px] font-semibold text-[var(--label)] truncate">{shopName}</p>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = activePath.startsWith(item.href);
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'flex items-center justify-between px-3 py-2 rounded-[10px] text-[14px] font-medium transition-colors',
                isActive
                  ? 'bg-[var(--accent-tint)] text-[var(--accent-tint-text)]'
                  : 'text-[var(--label-2)] hover:bg-[var(--fill)]',
              ].join(' ')}
            >
              <span>{item.label}</span>
              {item.badge ? <Badge count={item.badge} /> : null}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

/**
 * ShopShell — wraps shopkeeper pages with responsive navigation.
 * Mobile: top bar + bottom tab bar.
 * Desktop: sidebar.
 */
export function ShopShell({ shopName, activePath, children, orderCount, paymentCount }: { shopName: string; activePath: string; children: ReactNode; orderCount?: number; paymentCount?: number }) {
  return (
    <div className="min-h-[100dvh] bg-[var(--ground)] flex">
      <ShopSidebar activePath={activePath} shopName={shopName} orderCount={orderCount} paymentCount={paymentCount} />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-10 frosted-bar border-b border-[var(--hairline)] px-5 h-[56px] flex items-center safe-top">
          <p className="text-[17px] font-semibold text-[var(--label)] truncate flex-1">{shopName}</p>
        </header>
        <main className="flex-1 overflow-x-hidden">
          {children}
        </main>
        <ShopBottomTabBar activePath={activePath} orderCount={orderCount} paymentCount={paymentCount} />
      </div>
    </div>
  );
}
