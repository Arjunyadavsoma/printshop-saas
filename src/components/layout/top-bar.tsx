'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Menu, Bell, Search } from 'lucide-react';

const ROUTE_LABELS: Record<string, string> = {
  '/shop/dashboard': 'Dashboard',
  '/shop/orders': 'Orders',
  '/shop/printer': 'Printers',
  '/shop/reports': 'Reports',
  '/shop/settings': 'Settings',
};

export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const pathname = usePathname();
  const label = ROUTE_LABELS[pathname] ?? ROUTE_LABELS[Object.keys(ROUTE_LABELS).find(k => pathname.startsWith(k)) ?? ''] ?? 'PrintShop';

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          aria-label="Toggle menu"
        >
          <Menu className="size-5" />
        </button>
        <h1 className="text-base font-semibold text-foreground">{label}</h1>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Search"
        >
          <Search className="size-5" />
        </button>
        <button
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="size-5" />
        </button>
      </div>
    </header>
  );
}
