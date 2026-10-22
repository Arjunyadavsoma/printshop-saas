'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApiClient } from '@/components/portal/use-api-client';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import {
  LayoutDashboard,
  ClipboardList,
  Printer as PrinterIcon,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  Store,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/shop/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/shop/orders', label: 'Orders', icon: ClipboardList },
  { href: '/shop/printer', label: 'Printer Setup', icon: PrinterIcon },
  { href: '/shop/settings', label: 'Settings', icon: SettingsIcon },
];

function SidebarNav({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3 py-4" aria-label="Shop portal navigation">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/');
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-amber-100 text-amber-900'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Icon className="size-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Shared layout for every page under /shop/*. The login page is rendered
 * without the chrome (no sidebar, no auth check) — every other page expects
 * an authenticated owner.
 */
export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const api = useApiClient();
  const pathname = usePathname();
  const router = useRouter();
  const [shopName, setShopName] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const isLoginPage = pathname === '/shop/login';

  // Auth gate: redirect to login unless we're already on it.
  useEffect(() => {
    if (!api.ready) return;
    if (isLoginPage) return;
    if (!api.token || api.role !== 'owner') {
      router.replace('/shop/login');
      return;
    }
    // Lazy-load the shop name for the top bar. Best-effort: if it fails the
    // sidebar still renders, just without the shop name.
    void (async () => {
      const r = await api.request<{
        data?: { name?: string; slug?: string };
      }>('GET', '/api/v1/shops/me');
      if (r.status === 200 && r.data?.data?.name) setShopName(r.data.data.name);
    })();
  }, [api.ready, api.token, api.role, isLoginPage, router, api]);

  // Login page renders bare — no sidebar, no auth check.
  if (isLoginPage) {
    return <div className="min-h-screen bg-background">{children}</div>;
  }

  // While we wait for the auth state to settle, show a minimal spinner — this
  // avoids a one-frame flash of the dashboard before the redirect fires.
  if (!api.ready || !api.token || api.role !== 'owner') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <div className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span className="text-sm">Loading shop portal…</span>
        </div>
      </div>
    );
  }

  const logout = () => {
    api.clearAuth();
    router.replace('/shop/login');
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top bar — sticky, shows shop name + logout + mobile hamburger */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 sm:px-6">
        <div className="flex items-center gap-2">
          {/* Mobile hamburger */}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Shop navigation</SheetTitle>
              <div className="flex h-14 items-center gap-2 border-b px-4">
                <Store className="size-5 text-amber-600" />
                <span className="truncate font-semibold">{shopName ?? 'Shop'}</span>
              </div>
              <SidebarNav pathname={pathname} onNavigate={() => setSheetOpen(false)} />
            </SheetContent>
          </Sheet>
          <Store className="size-5 text-amber-600" />
          <div className="flex flex-col leading-tight">
            <span className="truncate text-sm font-semibold sm:text-base">
              {shopName ?? 'Shop Portal'}
            </span>
            <span className="text-[10px] text-muted-foreground">Shopkeeper Portal</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="hidden bg-emerald-50 text-emerald-700 sm:inline-flex">
            owner
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={logout}
            className="gap-1.5"
            aria-label="Log out"
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </header>

      {/* Body: fixed sidebar on desktop, content area on the right */}
      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-r border-border bg-card md:block">
          <SidebarNav pathname={pathname} />
        </aside>
        <main className="flex-1 overflow-x-hidden bg-background">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
