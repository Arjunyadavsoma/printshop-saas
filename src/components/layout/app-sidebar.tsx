'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard, FileText, Printer, CreditCard, BarChart3,
  Settings, Users, Package, Tag, HelpCircle,
} from 'lucide-react';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/shop/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/shop/orders', label: 'Orders', icon: FileText },
  { href: '/shop/printer', label: 'Printers', icon: Printer },
  { href: '/shop/reports', label: 'Reports', icon: BarChart3 },
  { href: '/shop/settings', label: 'Settings', icon: Settings },
];

export function AppSidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-surface transition-all duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
      aria-label="Main navigation"
    >
      <div className="flex h-14 items-center border-b border-border px-4">
        <Link href="/shop/dashboard" className="flex items-center gap-2" aria-label="PrintShop home">
          <div className="flex size-8 items-center justify-center rounded-lg bg-brand text-brand-foreground font-bold text-sm">
            P
          </div>
          {!collapsed && <span className="font-semibold text-foreground">PrintShop</span>}
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-brand text-brand-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-2">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          title={collapsed ? 'Help' : undefined}
        >
          <HelpCircle className="size-4 shrink-0" aria-hidden="true" />
          {!collapsed && <span>Help</span>}
        </Link>
      </div>
    </aside>
  );
}
