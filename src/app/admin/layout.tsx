'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  BarChart3,
  Activity,
  ClipboardList,
  Store,
  ShieldCheck,
  LogOut,
} from 'lucide-react';
import { AppShell, type AppShellProps } from '@/components/layout/app-shell';
import type { NavGroup } from '@/components/layout/app-sidebar';
import { useApiClient } from '@/components/portal/use-api-client';

/**
 * Admin navigation groups.
 *
 * Declared at module scope so the array identity is stable across renders
 * (eslint react-hooks/static-components).
 */
const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    label: 'Platform',
    items: [
      { href: '/admin', label: 'Overview', icon: LayoutDashboard },
      { href: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
      { href: '/admin/monitoring', label: 'Monitoring', icon: Activity },
      { href: '/admin/orders', label: 'Orders', icon: ClipboardList },
      { href: '/admin/shops', label: 'Shops', icon: Store },
    ],
  },
];

/**
 * Shared layout for every /admin/* page.
 *
 * - Wraps every admin page in the Square UI `AppShell` (sidebar + topbar +
 *   footer) using admin-specific navigation.
 * - On mount, checks the persisted auth: no token or non-admin role → redirect
 *   to /admin/login (the login page itself bypasses the chrome via path check).
 * - On mobile the sidebar collapses into a Sheet drawer handled by AppShell.
 *
 * The auth gate logic is identical to the previous inline-chrome layout — only
 * the shell markup has changed.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const api = useApiClient();
  const router = useRouter();
  const pathname = usePathname();

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
    return <div className="min-h-screen bg-page">{children}</div>;
  }

  // While the auth state is hydrating, show a quiet placeholder instead of
  // flashing the chrome before the redirect fires.
  if (!api.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 animate-pulse" aria-hidden="true" />
          Verifying admin session…
        </div>
      </div>
    );
  }

  // If the auth check failed, render nothing (redirect is in-flight).
  if (!api.token || api.role !== 'admin') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page text-muted-foreground">
        <div className="flex items-center gap-2 text-sm">
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Redirecting to login…
        </div>
      </div>
    );
  }

  const shellProps: AppShellProps = {
    navGroups: ADMIN_NAV_GROUPS,
    brandName: 'PrintShop',
    brandSubtitle: 'Admin Console',
    brandHref: '/admin',
    roleBadge: 'admin',
    showThemeToggle: true,
    onLogout: handleLogout,
    footerHref: '/',
    footerLabel: 'View storefront',
    children,
  };

  return <AppShell {...shellProps} />;
}
