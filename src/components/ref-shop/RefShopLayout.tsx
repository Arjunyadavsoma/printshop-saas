'use client';

/**
 * RefShopLayout — shared layout wrapper for the shopkeeper portal pages
 * that use the `.ref-*` CSS classes (Screens 09–12 of the reference design).
 *
 * Responsibilities:
 *  1. Auth gate — redirect to /shop/login when no token / wrong role.
 *  2. Fetch + cache the shop profile (name, slug, isActive) via
 *     GET /api/v1/shops/me.
 *  3. Provide the shop name + open-for-orders flag to children via React
 *     Context so each page doesn't re-fetch.
 *  4. Persist the "open for orders" toggle to localStorage (same key the
 *     legacy layout uses — `printshop:shop-open` — so toggling on the new
 *     dashboard still affects the customer-facing landing page's "closed"
 *     card).
 *
 * The wrapper does NOT render any chrome (top bar, sidebar, bottom tab bar).
 * Each page renders its own `.ref-screen m` or `.ref-screen d` container
 * with `.ref-top` / `.ref-tab` / `.ref-sb` so the markup 1:1 matches the
 * reference HTML.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useApiClient } from '@/components/portal/use-api-client';

export interface RefShopInfo {
  id: string;
  name: string;
  slug: string | null;
  isActive: boolean;
  upiId?: string | null;
}

interface RefShopContextValue {
  shop: RefShopInfo | null;
  loading: boolean;
  /** Toggle the "open for orders" switch. Persisted to localStorage. */
  open: boolean;
  setOpen: (next: boolean) => void;
  /** Force a re-fetch of the shop profile. */
  refresh: () => Promise<void>;
}

const RefShopContext = createContext<RefShopContextValue | null>(null);

const OPEN_KEY = 'printshop:shop-open';

export function RefShopProvider({ children }: { children: ReactNode }) {
  const api = useApiClient();
  const router = useRouter();
  const [shop, setShop] = useState<RefShopInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpenState] = useState(true);

  // Auth gate — if no token / wrong role once `ready` settles, bounce to /login.
  useEffect(() => {
    if (!api.ready) return;
    if (!api.token || api.role !== 'owner') {
      router.replace('/shop/login');
      return;
    }
  }, [api.ready, api.token, api.role, router]);

  // Restore the open flag from localStorage on mount (defaults to true if no
  // stored value — matches the legacy layout's behaviour).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(OPEN_KEY);
    if (stored !== null) setOpenState(stored === '1');
  }, []);

  const persistOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const fetchShop = useCallback(async () => {
    if (!api.token) return;
    setLoading(true);
    try {
      const r = await api.request<{ data?: RefShopInfo }>('GET', '/api/v1/shops/me');
      if (r.status === 200 && r.data?.data) {
        const s = r.data.data;
        setShop({
          id: s.id,
          name: s.name ?? 'Shop',
          slug: s.slug ?? null,
          isActive: s.isActive ?? true,
          upiId: s.upiId ?? null,
        });
        // Seed `open` from the server's isActive the first time only.
        if (typeof window !== 'undefined') {
          const stored = window.localStorage.getItem(OPEN_KEY);
          if (stored === null) setOpenState(s.isActive ?? true);
        }
      } else if (r.status === 401) {
        router.replace('/shop/login');
      }
    } catch {
      // Network / server error — keep the previous shop (or null). The page
      // will render with fallback demo data.
    } finally {
      setLoading(false);
    }
  }, [api, router]);

  useEffect(() => {
    if (!api.ready || !api.token || api.role !== 'owner') return;
    void fetchShop();
  }, [api.ready, api.token, api.role, fetchShop]);

  const value = useMemo<RefShopContextValue>(
    () => ({ shop, loading, open, setOpen: persistOpen, refresh: fetchShop }),
    [shop, loading, open, persistOpen, fetchShop],
  );

  return <RefShopContext.Provider value={value}>{children}</RefShopContext.Provider>;
}

/** Consume the RefShop context. Must be used inside <RefShopProvider>. */
export function useRefShop(): RefShopContextValue {
  const ctx = useContext(RefShopContext);
  if (!ctx) {
    throw new Error('useRefShop must be used inside <RefShopProvider>.');
  }
  return ctx;
}

/**
 * Page-level wrapper. Renders the auth-gate spinner while we wait for the
 * AuthContext to settle, then wraps children in <RefShopProvider> so the
 * page can call useRefShop() to read the shop name + open flag.
 */
export function RefShopLayout({ children }: { children: ReactNode }) {
  const api = useApiClient();
  if (!api.ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F2F3F7' }}>
        <div style={{ fontSize: '14px', color: '#5B5F66' }}>Loading shop portal…</div>
      </div>
    );
  }
  if (!api.token || api.role !== 'owner') {
    // The useEffect in RefShopProvider will fire the redirect; show a
    // neutral placeholder while the router navigates.
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F2F3F7' }}>
        <div style={{ fontSize: '14px', color: '#5B5F66' }}>Redirecting to sign in…</div>
      </div>
    );
  }
  return <RefShopProvider>{children}</RefShopProvider>;
}

export default RefShopLayout;
