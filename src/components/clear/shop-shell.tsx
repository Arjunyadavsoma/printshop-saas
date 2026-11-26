'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  ClipboardList,
  FileText,
  CreditCard,
  Users,
  Wrench,
  Monitor,
  Printer,
  BarChart3,
  UserCog,
  Receipt,
  Settings,
  PanelLeft,
  PanelLeftClose,
  MoreHorizontal,
  Home,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from './badge';

/**
 * Printelyx Shopkeeper Desktop-First Visual Identity
 * (docs/PRINTELYX-SHOPKEEPER-VISUAL-IDENTITY.md)
 *
 * Steel-blue sidebar + blue-violet accents + desktop topbar.
 * Mobile keeps the existing top bar + 5-tab bottom nav.
 *
 * SINGLE-MOUNT: `{children}` is rendered exactly once, in the single
 * `<main>` below; the breakpoint chrome is switched with CSS visibility
 * only (`lg:hidden` / `hidden lg:flex`). Never mount the page inside
 * ShopShellMobile + ShopShellTablet + ShopShellDesktop at the same time.
 */

/* ------------------------------------------------------------------ */
/* Navigation model                                                    */
/* ------------------------------------------------------------------ */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Optional pending-count badge (driven by orderCount / paymentCount). */
  badge?: 'orders' | 'payments';
}

interface NavSection {
  heading: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    heading: 'Operations',
    items: [
      { href: '/shop/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/shop/orders', label: 'Orders', icon: ClipboardList, badge: 'orders' },
      { href: '/shop/print-jobs', label: 'Print Jobs', icon: FileText },
      { href: '/shop/payments', label: 'Payments', icon: CreditCard, badge: 'payments' },
    ],
  },
  {
    heading: 'Catalog',
    items: [
      { href: '/shop/customers', label: 'Customers', icon: Users },
      { href: '/shop/services', label: 'Services', icon: Wrench },
      { href: '/shop/devices', label: 'Devices', icon: Monitor },
      { href: '/shop/printer', label: 'Printers', icon: Printer },
    ],
  },
  {
    heading: 'Manage',
    items: [
      { href: '/shop/reports', label: 'Reports', icon: BarChart3 },
      { href: '/shop/staff', label: 'Staff', icon: UserCog },
      { href: '/shop/billing', label: 'Billing', icon: Receipt },
      { href: '/shop/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const PAGE_TITLES: Record<string, string> = {
  '/shop/dashboard': 'Dashboard',
  '/shop/orders': 'Orders',
  '/shop/print-jobs': 'Print Jobs',
  '/shop/payments': 'Payments',
  '/shop/customers': 'Customers',
  '/shop/services': 'Services',
  '/shop/devices': 'Devices',
  '/shop/printer': 'Printers',
  '/shop/reports': 'Reports',
  '/shop/staff': 'Staff',
  '/shop/billing': 'Billing',
  '/shop/settings': 'Settings',
};

function pageTitle(activePath: string): string {
  if (PAGE_TITLES[activePath]) return PAGE_TITLES[activePath];
  // Longest-prefix match so `/shop/orders/123` resolves to "Orders".
  const match = Object.keys(PAGE_TITLES)
    .filter((k) => activePath === k || activePath.startsWith(k + '/'))
    .sort((a, b) => b.length - a.length)[0];
  return match ? PAGE_TITLES[match] : 'Shop';
}

const COLLAPSE_KEY = 'printshop:shop-sidebar-collapsed';

function isActivePath(activePath: string, href: string): boolean {
  return activePath === href || activePath.startsWith(href + '/');
}

/* ------------------------------------------------------------------ */
/* Sidebar count pill (shopkeeper tokens, not consumer Badge)          */
/* ------------------------------------------------------------------ */

function SidebarCountPill({ kind, count }: { kind: 'orders' | 'payments'; count: number }) {
  if (count <= 0) return null;
  const bg = kind === 'payments' ? 'var(--shop-warning)' : 'var(--shop-accent)';
  return (
    <span
      aria-label={`${count} pending`}
      className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[11px] font-semibold leading-none tnum text-white select-none"
      style={{ backgroundColor: bg }}
    >
      {count}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* ShopSidebar — desktop steel-blue sidebar                            */
/* ------------------------------------------------------------------ */

export interface ShopSidebarProps {
  activePath: string;
  shopName: string;
  orderCount?: number;
  paymentCount?: number;
  /** When true, the sidebar renders in its 76px collapsed (icon-only) form. */
  collapsed?: boolean;
}

export function ShopSidebar({
  activePath,
  shopName,
  orderCount = 0,
  paymentCount = 0,
  collapsed = false,
}: ShopSidebarProps) {
  return (
    <aside
      className="hidden lg:flex flex-col h-[100dvh] sticky top-0 shrink-0 bg-[var(--shop-steel)] text-[var(--shop-side-text)] transition-[width] duration-200 ease-out"
      style={{ width: collapsed ? 'var(--shop-sidebar-w-collapsed)' : 'var(--shop-sidebar-w)' }}
      aria-label="Shopkeeper sidebar"
    >
      {/* Brand row — sits flush with the 64px topbar */}
      <div
        className="flex items-center gap-2.5 px-4 border-b border-[var(--shop-side-border)] shrink-0"
        style={{ height: 'var(--shop-topbar-h)' }}
      >
        <span
          className="size-7 rounded-[8px] bg-[var(--shop-accent)] grid place-items-center shrink-0 shadow-[0_0_0_3px_rgba(99,102,241,0.18)]"
          aria-hidden="true"
        >
          <span className="size-2 rounded-full bg-white" />
        </span>
        {!collapsed && (
          <span className="text-[15px] font-semibold tracking-tight text-[var(--shop-side-text-on)] truncate">
            Printelyx
          </span>
        )}
      </div>

      {/* Shop identity */}
      {!collapsed ? (
        <div className="px-4 pt-3 pb-1 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--shop-side-text)] mb-0.5">
            Shop
          </p>
          <p className="text-[13px] font-medium text-[var(--shop-side-text-on)] truncate" title={shopName}>
            {shopName}
          </p>
        </div>
      ) : (
        <div className="h-3 shrink-0" aria-hidden="true" />
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2" aria-label="Shopkeeper primary">
        <div className={collapsed ? 'space-y-1' : 'space-y-4'}>
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading} className="space-y-0.5">
              {!collapsed && (
                <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--shop-side-text)]">
                  {section.heading}
                </p>
              )}
              {section.items.map((item) => {
                const isActive = isActivePath(activePath, item.href);
                const Icon = item.icon;
                const count =
                  item.badge === 'orders'
                    ? orderCount
                    : item.badge === 'payments'
                      ? paymentCount
                      : 0;
                return (
                  <a
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={collapsed ? item.label : undefined}
                    className={[
                      'group relative flex items-center rounded-[10px] text-[14px] font-medium transition-colors',
                      collapsed ? 'justify-center h-[40px]' : 'gap-3 px-3 h-[36px]',
                      isActive
                        ? 'bg-[var(--shop-accent)] text-[var(--shop-side-text-on)]'
                        : 'text-[var(--shop-side-text)] hover:bg-white/[0.06] hover:text-[var(--shop-side-text-on)]',
                    ].join(' ')}
                  >
                    <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                    {!collapsed && <span className="truncate flex-1">{item.label}</span>}
                    {!collapsed && item.badge && <SidebarCountPill kind={item.badge} count={count} />}
                    {collapsed && item.badge && count > 0 && (
                      <span
                        className="absolute top-1 right-1.5 size-[7px] rounded-full ring-2 ring-[var(--shop-steel)]"
                        style={{
                          backgroundColor:
                            item.badge === 'payments' ? 'var(--shop-warning)' : 'var(--shop-side-text-on)',
                        }}
                        aria-hidden="true"
                      />
                    )}
                  </a>
                );
              })}
            </div>
          ))}
        </div>
      </nav>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* ShopTopBar — desktop 64px white top bar (lives in the right column) */
/* ------------------------------------------------------------------ */

interface ShopTopBarProps {
  activePath: string;
  shopName: string;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function ShopTopBar({ activePath, shopName, collapsed, onToggleCollapse }: ShopTopBarProps) {
  const initial = (shopName.trim().charAt(0) || 'S').toUpperCase();
  return (
    <header
      className="hidden lg:flex sticky top-0 z-10 items-center gap-2 px-4 bg-[var(--shop-surface)] border-b border-[var(--shop-border)] shrink-0"
      style={{ height: 'var(--shop-topbar-h)' }}
      aria-label="Shopkeeper top bar"
    >
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="grid place-items-center size-9 rounded-[10px] text-[var(--shop-ink-2)] hover:bg-[var(--shop-bg)] hover:text-[var(--shop-ink)] transition-colors"
      >
        {collapsed ? (
          <PanelLeft className="size-5" strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <PanelLeftClose className="size-5" strokeWidth={1.75} aria-hidden="true" />
        )}
      </button>

      <div className="text-[var(--shop-ink-3)] select-none" aria-hidden="true">
        /
      </div>
      <h1 className="text-[15px] font-semibold tracking-tight text-[var(--shop-ink)] truncate">
        {pageTitle(activePath)}
      </h1>

      <div className="ml-auto flex items-center gap-2">
        <a
          href="/"
          className="text-[13px] font-medium text-[var(--shop-ink-2)] hover:text-[var(--shop-ink)] px-3 py-1.5 rounded-[8px] hover:bg-[var(--shop-bg)] transition-colors"
        >
          View customer app
        </a>
        <a
          href="/shop/settings"
          aria-label={`Open settings for ${shopName}`}
          title="Settings"
          className="grid place-items-center size-9 rounded-full text-white text-[13px] font-semibold bg-[var(--shop-accent)] hover:bg-[var(--shop-accent-press)] transition-colors select-none"
        >
          {initial}
        </a>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* ShopBottomTabBar — mobile bottom navigation (kept, recolored)       */
/* ------------------------------------------------------------------ */

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

const TABS: Tab[] = [
  { href: '/shop/dashboard', label: 'Home', icon: Home },
  { href: '/shop/orders', label: 'Orders', icon: ClipboardList },
  { href: '/shop/payments', label: 'Payments', icon: CreditCard },
  { href: '/shop/devices', label: 'Printers', icon: Monitor },
  { href: '/shop/settings', label: 'More', icon: MoreHorizontal },
];

export function ShopBottomTabBar({
  activePath,
  orderCount = 0,
  paymentCount = 0,
}: {
  activePath: string;
  orderCount?: number;
  paymentCount?: number;
}) {
  const tabs = TABS.map((t) => ({
    ...t,
    badge:
      t.href === '/shop/orders'
        ? orderCount
        : t.href === '/shop/payments'
          ? paymentCount
          : undefined,
  }));

  return (
    <nav
      className="lg:hidden sticky bottom-0 z-20 frosted-bar border-t border-[var(--shop-border)] safe-bottom-bar"
      aria-label="Shopkeeper navigation"
    >
      <div className="flex items-stretch justify-around">
        {tabs.map((tab) => {
          const isActive = isActivePath(activePath, tab.href);
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
                  className={`size-[22px] ${isActive ? 'text-[var(--shop-accent)]' : 'text-[var(--shop-ink-3)]'}`}
                  strokeWidth={1.75}
                  aria-hidden="true"
                />
                {tab.badge ? <Badge count={tab.badge} /> : null}
              </span>
              <span
                className={`text-[12px] font-semibold ${isActive ? 'text-[var(--shop-accent)]' : 'text-[var(--shop-ink-3)]'}`}
              >
                {tab.label}
              </span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* ShopShell — wires sidebar + topbar + main + mobile chrome           */
/* ------------------------------------------------------------------ */

export function ShopShell({
  shopName,
  activePath,
  children,
  orderCount,
  paymentCount,
}: {
  shopName: string;
  activePath: string;
  children: ReactNode;
  orderCount?: number;
  paymentCount?: number;
}) {
  // Sidebar collapse state — persisted to localStorage. Read on mount to
  // avoid an SSR/CSR mismatch; default to expanded.
  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(COLLAPSE_KEY);
      setCollapsed(v === '1');
    } catch {
      // localStorage may be unavailable (private mode) — keep default.
    }
    setHydrated(true);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Persist best-effort; in-memory state still flips.
      }
      return next;
    });
  };

  // Before hydration, render expanded to match the server-rendered markup
  // (the localStorage value is unknown on the server). After hydration the
  // real value takes over.
  const effectiveCollapsed = hydrated ? collapsed : false;

  return (
    <div className="min-h-[100dvh] bg-[var(--shop-bg)] flex">
      <ShopSidebar
        activePath={activePath}
        shopName={shopName}
        orderCount={orderCount}
        paymentCount={paymentCount}
        collapsed={effectiveCollapsed}
      />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop top bar — lives to the RIGHT of the sidebar */}
        <ShopTopBar
          activePath={activePath}
          shopName={shopName}
          collapsed={effectiveCollapsed}
          onToggleCollapse={toggleCollapsed}
        />
        {/* Mobile top bar */}
        <header
          className="lg:hidden sticky top-0 z-10 frosted-bar border-b border-[var(--shop-border)] px-5 flex items-center safe-top shrink-0"
          style={{ height: 56 }}
          aria-label="Shopkeeper mobile top bar"
        >
          <p className="text-[17px] font-semibold text-[var(--shop-ink)] truncate flex-1">{shopName}</p>
        </header>
        <main className="flex-1 overflow-x-hidden">{children}</main>
        <ShopBottomTabBar activePath={activePath} orderCount={orderCount} paymentCount={paymentCount} />
      </div>
    </div>
  );
}

export { pageTitle as getShopPageTitle };
