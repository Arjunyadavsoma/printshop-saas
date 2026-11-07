'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  Store,
  ShoppingBag,
  BarChart3,
  Activity,
  LogOut,
  Menu,
  Printer,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useApiClient } from '@/components/portal/use-api-client';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/shops', label: 'Shops', icon: Store },
  { href: '/admin/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/admin/monitoring', label: 'Monitoring', icon: Activity },
];

/**
 * Module-level sidebar nav. Declared outside AdminLayout so the component
 * identity is stable across renders (eslint react-hooks/static-components).
 */
function SidebarLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-3 py-4" aria-label="Admin navigation">
      {NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== '/admin' && pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            className={`group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-brand/15 text-brand ring-1 ring-inset ring-brand/30'
                : 'text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Shared layout for every /admin/* page.
 *
 * - Wraps every admin page in a dark sidebar + top bar.
 * - On mount, checks the persisted auth: no token or non-admin role → redirect
 *   to /admin/login (the login page itself bypasses the chrome via path check).
 * - On mobile the sidebar collapses into a Sheet drawer triggered by a
 *   hamburger button in the top bar.
 *
 * Distinct from the shopkeeper portal — uses a bg-primary dark sidebar with a
 * bg-brand amber accent (unified with the rest of the portals).
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const api = useApiClient();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isLoginRoute = pathname === '/admin/login';

  // Auth gate — runs once the localStorage read has settled.
  useEffect(() => {
    if (!api.ready) return;
    if (isLoginRoute) return; // login page renders without auth
    if (!api.token || api.role !== 'admin') {
      router.replace('/admin/login');
    }
  }, [api.ready, api.token, api.role, isLoginRoute, router]);

  function handleLogout() {
    api.clearAuth();
    router.replace('/admin/login');
  }

  // Login page renders bare — no sidebar, no top bar.
  if (isLoginRoute) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  // While the auth state is hydrating, show a quiet placeholder instead of
  // flashing the chrome before the redirect fires.
  if (!api.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 animate-pulse" />
          Verifying admin session…
        </div>
      </div>
    );
  }

  // If the auth check failed, render nothing (redirect is in-flight).
  if (!api.token || api.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <LogOut className="h-4 w-4" />
          Redirecting to login…
        </div>
      </div>
    );
  }

  const SidebarLinksEl = (
    <SidebarLinks pathname={pathname} />
  );
  const SidebarLinksMobile = (
    <SidebarLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside
        className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-primary-foreground/10 bg-primary lg:flex"
        aria-label="Admin sidebar"
      >
        <div className="flex h-16 items-center gap-2 border-b border-primary-foreground/10 px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-brand-foreground">
            <Printer className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold text-primary-foreground">PrintShop</span>
            <span className="text-xs text-brand">Admin Portal</span>
          </div>
        </div>
        {SidebarLinksEl}
        <div className="mt-auto border-t border-primary-foreground/10 p-3">
          <div className="px-3 py-2 text-xs text-primary-foreground/70">
            Signed in as
            <div className="mt-0.5 truncate font-mono text-primary-foreground" title={api.email ?? ''}>
              {api.email ?? '—'}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="mt-1 w-full justify-start gap-2 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile sidebar (Sheet) */}
      <div className="lg:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="fixed left-3 top-3 z-40 h-11 w-11 bg-primary text-primary-foreground hover:bg-primary-foreground/10"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 border-r border-primary-foreground/10 bg-primary p-0">
            <SheetTitle className="flex h-16 items-center gap-2 border-b border-primary-foreground/10 px-5 text-primary-foreground">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-brand-foreground">
                <Printer className="h-4 w-4" />
              </div>
              <span className="text-sm font-bold">PrintShop Admin</span>
            </SheetTitle>
            {SidebarLinksMobile}
            <div className="mt-auto border-t border-primary-foreground/10 p-3">
              <div className="px-3 py-2 text-xs text-primary-foreground/70">
                Signed in as
                <div className="mt-0.5 truncate font-mono text-primary-foreground" title={api.email ?? ''}>
                  {api.email ?? '—'}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="mt-1 w-full justify-start gap-2 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/95 px-4 pl-16 backdrop-blur lg:pl-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-brand" />
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            PrintShop Admin
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline" aria-hidden>
            {api.email ?? ''}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>

      {/* Page content */}
      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
