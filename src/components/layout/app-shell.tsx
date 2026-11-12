'use client';

import { useState, type ReactNode } from 'react';
import { AppSidebar } from './app-sidebar';
import { TopBar } from './top-bar';
import { cn } from '@/lib/utils';

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-page">
      <AppSidebar collapsed={collapsed} />

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <div className={cn('flex min-h-screen flex-col transition-all duration-200', collapsed ? 'lg:pl-16' : 'lg:pl-60')}>
        <TopBar onMenuClick={() => setMobileOpen(!mobileOpen)} />
        <main className="flex-1 p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
