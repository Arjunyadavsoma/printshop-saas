'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MapPin, QrCode, ReceiptText, User } from 'lucide-react';

/**
 * ConsumerTabBar — persistent bottom navigation for every consumer screen
 * (mobile only; desktop gets DesktopTopNav). Five tabs per the redesign:
 *
 *   Home · Near Me · Scan QR (raised centre action) · Orders · Profile
 *
 * Rendered by CustomerShell so shop landing, order tracking, orders,
 * scan, profile and the home page all share one navigation model. The
 * centre Scan tab is visually elevated (raised accent circle) per the
 * reference design.
 */

const TAB_BAR_HEIGHT = 64;

type TabKey = 'home' | 'near-me' | 'scan' | 'orders' | 'profile';

const TABS: Array<{ key: TabKey; label: string; href: string; icon: typeof Home }> = [
  { key: 'home', label: 'Home', href: '/', icon: Home },
  { key: 'near-me', label: 'Near Me', href: '/find-a-shop', icon: MapPin },
  { key: 'scan', label: 'Scan QR', href: '/scan', icon: QrCode },
  { key: 'orders', label: 'Orders', href: '/orders', icon: ReceiptText },
  { key: 'profile', label: 'Profile', href: '/profile', icon: User },
];

export function activeConsumerTab(pathname: string | null): TabKey {
  if (!pathname) return 'home';
  if (pathname === '/' || pathname.startsWith('/s/') || pathname.startsWith('/o/') || pathname.startsWith('/track')) return 'home';
  if (pathname.startsWith('/find-a-shop')) return 'near-me';
  if (pathname.startsWith('/scan')) return 'scan';
  if (pathname.startsWith('/orders')) return 'orders';
  if (pathname.startsWith('/profile')) return 'profile';
  return 'home';
}

/** Bottom offset (px) pages must add for sticky bars so they clear the tab bar. */
export const CONSUMER_TAB_BAR_OFFSET = TAB_BAR_HEIGHT;

export function ConsumerTabBar() {
  const pathname = usePathname();
  const active = activeConsumerTab(pathname);
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 lg:hidden frosted-bar border-t border-[var(--hairline)] safe-bottom"
      style={{ height: TAB_BAR_HEIGHT }}
      aria-label="Consumer navigation"
    >
      <ul className="mx-auto flex h-full max-w-[640px] items-stretch justify-around px-2">
        {TABS.map((tab) => {
          const isActive = active === tab.key;
          const Icon = tab.icon;
          if (tab.key === 'scan') {
            // Raised centre action per the reference design.
            return (
              <li key={tab.key} className="relative flex items-center justify-center">
                <Link
                  href={tab.href}
                  aria-label="Scan QR code"
                  className="flex size-12 -translate-y-3 flex-col items-center justify-center rounded-full bg-[var(--accent)] text-[var(--on-accent)] shadow-lg"
                >
                  <QrCode className="size-6" strokeWidth={1.75} aria-hidden="true" />
                </Link>
                <span className="pointer-events-none absolute bottom-1 text-[10px] font-medium text-[var(--label-2)]">
                  Scan QR
                </span>
              </li>
            );
          }
          return (
            <li key={tab.key} className="flex flex-1 items-stretch">
              <Link
                href={tab.href}
                className="flex w-full flex-col items-center justify-center gap-0.5"
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon
                  className={isActive ? 'size-5 text-[var(--accent)]' : 'size-5 text-[var(--label-2)]'}
                  strokeWidth={isActive ? 2 : 1.75}
                  aria-hidden="true"
                />
                <span
                  className={`text-[10px] font-medium ${isActive ? 'text-[var(--accent)]' : 'text-[var(--label-2)]'}`}
                >
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default ConsumerTabBar;
