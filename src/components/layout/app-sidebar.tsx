'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ChevronsLeft, HelpCircle, LogOut, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Rendered inset + smaller, grouped under a labelled section. */
  sub?: boolean;
  /** Optional short badge text (e.g. a count) shown on the right. */
  badge?: string;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export interface AppSidebarProps {
  groups: NavGroup[];
  /** Brand label shown in the sidebar header (shop name or "PrintShop"). */
  brandName: string;
  /** Optional secondary brand label (e.g. "Shopkeeper Portal"). */
  brandSubtitle?: string;
  /** Home link for the brand logo. */
  brandHref?: string;
  collapsed: boolean;
  onToggleCollapse?: () => void;
  /** Called when any nav item is clicked (used to close the mobile drawer). */
  onNavigate?: () => void;
  onLogout?: () => void;
  /** Optional footer link config. */
  footerHref?: string;
  footerLabel?: string;
}

/**
 * Compute the active state for a nav item from the current pathname + hash.
 * Hash-based items (Settings sub-items) are active on an exact pathname +
 * hash match. Path-based items follow the "exact OR starts-with(href + '/')"
 * rule so /shop/orders/123 highlights the Orders link.
 */
export function isItemActive(item: NavItem, pathname: string, hash: string): boolean {
  if (item.href.includes('#')) {
    const [path, hashPart] = item.href.split('#');
    return pathname === path && hash === '#' + hashPart;
  }
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

/**
 * Subscribe to URL hash changes (client-only). Returns '' on the server and
 * during the first client render to avoid hydration mismatch.
 */
export function useHashPath(): string {
  const [hash, setHash] = useState<string>('');
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setHash(window.location.hash);
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return hash;
}

export function AppSidebar({
  groups,
  brandName,
  brandSubtitle,
  brandHref = '/shop/dashboard',
  collapsed,
  onToggleCollapse,
  onNavigate,
  onLogout,
  footerHref,
  footerLabel,
}: AppSidebarProps) {
  const pathname = usePathname();
  const hash = useHashPath();

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-border bg-surface transition-[width] duration-200 ease-in-out',
        collapsed ? 'w-16' : 'w-60',
      )}
      aria-label="Primary navigation"
    >
      {/* Brand header */}
      <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <Link
          href={brandHref}
          className="flex shrink-0 items-center gap-2.5"
          aria-label={`${brandName} home`}
          onClick={onNavigate}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-brand-foreground">
            P
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-semibold text-foreground">{brandName}</span>
              {brandSubtitle && (
                <span className="truncate text-xs text-muted-foreground">{brandSubtitle}</span>
              )}
            </div>
          )}
        </Link>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Sidebar sections">
        <div className="flex flex-col gap-5">
          {groups.map((group, gi) => (
            <div key={gi} className="flex flex-col gap-1">
              {group.label && !collapsed && (
                <p
                  className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                  aria-hidden="true"
                >
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const active = isItemActive(item, pathname, hash);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                      item.sub && !collapsed && 'pl-5',
                      active
                        ? 'bg-brand-soft text-brand'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {!collapsed && item.badge && (
                      <span
                        className={cn(
                          'inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums',
                          active
                            ? 'bg-brand/10 text-brand'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      {/* Footer: collapse toggle + help + logout */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="flex flex-col gap-1">
          {footerHref && footerLabel && (
            <Link
              href={footerHref}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              )}
              title={collapsed ? footerLabel : undefined}
            >
              <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span>{footerLabel}</span>}
            </Link>
          )}
          <Link
            href="/"
            onClick={onNavigate}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={collapsed ? 'Help & docs' : undefined}
          >
            <HelpCircle className="size-4 shrink-0" aria-hidden="true" />
            {!collapsed && <span>Help &amp; docs</span>}
          </Link>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-danger-soft hover:text-danger"
              title={collapsed ? 'Log out' : undefined}
            >
              <LogOut className="size-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span>Log out</span>}
            </button>
          )}
          {onToggleCollapse && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onToggleCollapse}
              className="hidden items-center gap-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground lg:flex"
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <ChevronsLeft className={cn('size-4 transition-transform', collapsed && 'rotate-180')} aria-hidden="true" />
              {!collapsed && <span>Collapse</span>}
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
