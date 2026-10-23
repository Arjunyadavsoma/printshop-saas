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
  LogOut,
  Menu,
  Store,
  Clock,
  CreditCard,
  QrCode,
  ShieldCheck,
  Github,
  FileBarChart,
} from 'lucide-react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /**
   * Sub-items are rendered slightly inset + smaller, grouped under a
   * "Settings" label. Visually communicates hierarchy without
   * changing routing semantics.
   */
  sub?: boolean;
}

interface NavGroup {
  /** Optional group label (e.g. "Settings"). Omitted for the main group. */
  label?: string;
  items: NavItem[];
}

/**
 * Two nav groups: a main group (Overview, Orders, Printer Setup) and a
 * "Settings" group with deep-link sub-items for each tab on the settings
 * page. The settings page reads the hash on mount and opens the matching
 * tab (see settings/page.tsx). Hash-deep-links avoid query-string
 * Suspense-boundary concerns and keep the URL readable.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: '/shop/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/shop/orders', label: 'Orders', icon: ClipboardList },
      { href: '/shop/printer', label: 'Printer Setup', icon: PrinterIcon },
      { href: '/shop/reports', label: 'Daily Report', icon: FileBarChart },
    ],
  },
  {
    label: 'Settings',
    items: [
      { href: '/shop/settings#profile', label: 'Shop Profile', icon: Store, sub: true },
      { href: '/shop/settings#hours', label: 'Business Hours', icon: Clock, sub: true },
      { href: '/shop/settings#payment', label: 'Payments & UPI', icon: CreditCard, sub: true },
      { href: '/shop/settings#qr', label: 'Shop QR Code', icon: QrCode, sub: true },
    ],
  },
];

/**
 * Compute the active state for a nav item from the current pathname +
 * URL hash. Hash-based items (Settings sub-items) are active on an exact
 * pathname + hash match. Path-based items (Overview, Orders, Printer
 * Setup) follow the existing "exact OR starts-with(href + '/')" rule so
 * /shop/orders/123 still highlights the Orders link.
 */
function isItemActive(item: NavItem, pathname: string, hash: string): boolean {
  if (item.href.includes('#')) {
    const [path, hashPart] = item.href.split('#');
    return pathname === path && hash === '#' + hashPart;
  }
  return pathname === item.href || pathname.startsWith(item.href + '/');
}

/**
 * Subscribe to URL hash changes (client-only). Returns '' on the server
 * and during the first client render to avoid hydration mismatch.
 */
function useHashPath(): string {
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

function SidebarNav({
  pathname,
  hash,
  onNavigate,
}: {
  pathname: string;
  hash: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-4 px-3 py-4" aria-label="Shop portal navigation">
      {NAV_GROUPS.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-1">
          {group.label && (
            <p
              className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
              aria-hidden
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
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  item.sub ? 'pl-5' : ''
                } ${
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
        </div>
      ))}
    </nav>
  );
}

/**
 * Sticky footer — per the project's UI rules, the root wrapper uses
 * `min-h-screen flex flex-col` and the footer uses `mt-auto` so it stays
 * pinned to the bottom on short pages (e.g. an empty Orders list) and
 * flows naturally below the content on long pages.
 */
function PortalFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-amber-600 text-[10px] font-bold text-white">
            P
          </div>
          <span>
            PrintShop SaaS · Shopkeeper Portal · 0% commission · money to shopkeeper&rsquo;s UPI
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-emerald-600" />
            MIT licensed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Github className="size-3.5" />
            see README.md
          </span>
        </div>
      </div>
    </footer>
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
  const hash = useHashPath();
  const [shopName, setShopName] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Login + register pages render bare (no sidebar, no auth gate).
  const isLoginPage = pathname === '/shop/login' || pathname === '/shop/register';

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
    // Hard navigation — avoids any RSC transition race. The auth state is
    // cleared in the shared context + localStorage; a full page load
    // guarantees the login page mounts fresh with no stale token.
    window.location.href = '/shop/login';
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
              <SidebarNav pathname={pathname} hash={hash} onNavigate={() => setSheetOpen(false)} />
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
          <SidebarNav pathname={pathname} hash={hash} />
        </aside>
        <main className="flex-1 overflow-x-hidden bg-background">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</div>
        </main>
      </div>

      <PortalFooter />
    </div>
  );
}
