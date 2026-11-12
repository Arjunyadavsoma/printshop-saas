'use client';

import { useState, type ReactNode } from 'react';
import { AppSidebar, type NavGroup } from './app-sidebar';
import { TopBar, type Crumb } from './top-bar';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { ShieldCheck, Github } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AppShellProps {
  /** Sidebar navigation groups. */
  navGroups: NavGroup[];
  /** Brand label (shop name / "PrintShop"). */
  brandName: string;
  brandSubtitle?: string;
  brandHref?: string;
  /** Top bar configuration. */
  title?: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  roleBadge?: string;
  showThemeToggle?: boolean;
  onLogout?: () => void;
  /** Footer link (e.g. "View storefront"). */
  footerHref?: string;
  footerLabel?: string;
  children: ReactNode;
}

/**
 * Square UI application shell.
 *
 * Layout:
 * - Desktop (lg+): fixed sidebar (collapsible 256px ↔ 64px), content shifted
 *   via padding-left. Top bar sticky. Footer sticky to bottom (mt-auto).
 * - Mobile (<lg): sidebar hidden, replaced by a Sheet drawer triggered from
 *   the top bar menu button.
 *
 * The footer sticks to the viewport bottom on short pages and is pushed down
 * naturally on long pages (flex column + mt-auto).
 */
export function AppShell({
  navGroups,
  brandName,
  brandSubtitle,
  brandHref,
  title,
  breadcrumbs,
  actions,
  roleBadge,
  showThemeToggle,
  onLogout,
  footerHref,
  footerLabel,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-page">
      {/* Desktop sidebar (fixed) */}
      <div className="hidden lg:block">
        <AppSidebar
          groups={navGroups}
          brandName={brandName}
          brandSubtitle={brandSubtitle}
          brandHref={brandHref}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onLogout={onLogout}
          footerHref={footerHref}
          footerLabel={footerLabel}
        />
      </div>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">{brandName} navigation</SheetTitle>
          <SheetDescription className="sr-only">Primary navigation menu</SheetDescription>
          <AppSidebar
            groups={navGroups}
            brandName={brandName}
            brandSubtitle={brandSubtitle}
            brandHref={brandHref}
            collapsed={false}
            onNavigate={() => setMobileOpen(false)}
            onLogout={onLogout}
            footerHref={footerHref}
            footerLabel={footerLabel}
          />
        </SheetContent>
      </Sheet>

      {/* Main column — shifted by sidebar width on desktop */}
      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-200 ease-in-out',
          collapsed ? 'lg:pl-16' : 'lg:pl-60',
        )}
      >
        <TopBar
          title={title}
          breadcrumbs={breadcrumbs}
          onMenuClick={() => setMobileOpen(true)}
          actions={actions}
          roleBadge={roleBadge}
          showThemeToggle={showThemeToggle}
        />
        <main className="flex-1">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
        <AppShellFooter />
      </div>
    </div>
  );
}

function AppShellFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-surface">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded bg-brand text-xs font-bold text-brand-foreground">
            P
          </div>
          <span>PrintShop SaaS &middot; 0% commission &middot; money to shopkeeper&rsquo;s UPI</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
            MIT licensed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Github className="size-3.5" aria-hidden="true" />
            see README.md
          </span>
        </div>
      </div>
    </footer>
  );
}
