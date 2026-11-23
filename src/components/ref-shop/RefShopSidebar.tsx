'use client';

/**
 * RefShopSidebar — the desktop left sidebar that appears on Screen 12
 * (Desktop Kanban). Matches the `.ref-sb` / `.ref-nv` CSS classes 1:1.
 *
 * The sidebar shows the shop name, an "open for orders" switch, and the
 * nav items: Home, Orders, Payments (with chip), Printers, Pricing,
 * Reports, Settings.
 *
 * Only rendered on desktop viewports (>= 1024px) — the parent page hides
 * it on smaller screens via the `.ref-screen.d` wrapper using CSS media
 * queries (the parent renders the mobile and desktop layouts side by side,
 * and the wrapper's `m` / `d` modifier controls visibility).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRefShop } from './RefShopLayout';

interface NavItem {
  label: string;
  href: string;
  /** Optional chip number to show on the right side of the nav row. */
  chip?: number;
  chipTone?: 'a' | 'ok' | 'rd' | undefined;
}

function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  // Avoid false-positive where /shop/orders matches /shop/orders/abc by
  // treating sub-routes as active too — that's the desired behaviour here.
  return pathname.startsWith(href + '/');
}

export interface RefShopSidebarProps {
  /** Pending-payments count to surface as a chip on the Payments nav row. */
  pendingPayments?: number;
}

export function RefShopSidebar({ pendingPayments = 0 }: RefShopSidebarProps) {
  const pathname = usePathname() ?? '';
  const { shop, open, setOpen } = useRefShop();

  const navItems: NavItem[] = [
    { label: 'Home', href: '/shop/dashboard' },
    { label: 'Orders', href: '/shop/orders' },
    { label: 'Payments', href: '/shop/payments', chip: pendingPayments || undefined, chipTone: 'a' },
    { label: 'Printers', href: '/shop/printer' },
    { label: 'Pricing', href: '/shop/services' },
    { label: 'Reports', href: '/shop/reports' },
    { label: 'Settings', href: '/shop/settings' },
  ];

  return (
    <div className="ref-sb">
      <b style={{ padding: '4px 12px 16px', fontSize: '17px' }}>{shop?.name ?? 'Shop Portal'}</b>
      <div className="ref-nv">
        <span>Open for orders</span>
        <i
          className={`ref-sw${open ? '' : ' off'}`}
          style={{ transform: 'scale(.8)' }}
          role="switch"
          aria-checked={open}
          aria-label="Open for orders"
          onClick={() => setOpen(!open)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpen(!open);
            }
          }}
          tabIndex={0}
        />
      </div>
      {navItems.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`ref-nv${active ? ' on' : ''}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
            aria-current={active ? 'page' : undefined}
          >
            <span>{item.label}</span>
            {item.chip != null ? (
              <span className={`ref-chip${item.chipTone ? ' ' + item.chipTone : ''}`}>{item.chip}</span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

export default RefShopSidebar;
