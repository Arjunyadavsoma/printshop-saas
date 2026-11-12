'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Menu, Slash } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import type { ReactNode } from 'react';

export interface Crumb {
  label: string;
  href?: string;
}

export interface TopBarProps {
  /** Page title shown in the bar (derived from route if omitted). */
  title?: string;
  /** Optional breadcrumb trail. */
  breadcrumbs?: Crumb[];
  /** Mobile drawer trigger. */
  onMenuClick?: () => void;
  /** Right-aligned action slot (buttons, badges). */
  actions?: ReactNode;
  /** Optional role badge shown next to the title (e.g. "owner"). */
  roleBadge?: string;
  /** Whether to render the theme toggle. Defaults to true. */
  showThemeToggle?: boolean;
}

const DEFAULT_ROUTE_LABELS: Record<string, string> = {
  '/shop/dashboard': 'Dashboard',
  '/shop/orders': 'Orders',
  '/shop/printer': 'Printers',
  '/shop/reports': 'Reports',
  '/shop/settings': 'Settings',
  '/admin': 'Overview',
  '/admin/analytics': 'Analytics',
  '/admin/monitoring': 'Monitoring',
  '/admin/orders': 'Orders',
  '/admin/shops': 'Shops',
};

function deriveTitle(pathname: string): string {
  if (DEFAULT_ROUTE_LABELS[pathname]) return DEFAULT_ROUTE_LABELS[pathname];
  // Try prefix match (e.g. /shop/orders/123 → Orders)
  const sorted = Object.keys(DEFAULT_ROUTE_LABELS).sort((a, b) => b.length - a.length);
  for (const k of sorted) {
    if (pathname.startsWith(k + '/')) return DEFAULT_ROUTE_LABELS[k];
  }
  return 'PrintShop';
}

export function TopBar({
  title,
  breadcrumbs,
  onMenuClick,
  actions,
  roleBadge,
  showThemeToggle = true,
}: TopBarProps) {
  const pathname = usePathname();
  const resolvedTitle = title ?? deriveTitle(pathname);

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-surface/80 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {onMenuClick && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="size-9 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-5" aria-hidden="true" />
          </Button>
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          {breadcrumbs && breadcrumbs.length > 0 ? (
            <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
              {breadcrumbs.map((c, i) => (
                <span key={i} className="flex min-w-0 items-center gap-1">
                  {i > 0 && <Slash className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />}
                  {c.href ? (
                    <Link href={c.href} className="truncate hover:text-foreground">
                      {c.label}
                    </Link>
                  ) : (
                    <span className="truncate">{c.label}</span>
                  )}
                </span>
              ))}
            </nav>
          ) : null}
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">{resolvedTitle}</h1>
            {roleBadge && (
              <Badge variant="outline" className="hidden bg-success-soft text-success sm:inline-flex">
                {roleBadge}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {actions}
        {showThemeToggle && <ThemeToggle />}
      </div>
    </header>
  );
}
