'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/**
 * AuthContext — a SHARED auth state across the entire client app.
 *
 * ROOT CAUSE FIX (sign-in redirect loop):
 * The previous `useApiClient` hook created a SEPARATE state instance per
 * component that called it. The layout (mounted on /shop/login) and the
 * login page each had their own instance. When the login page called
 * `setAuth(token, role, email)`, it updated ITS OWN state + localStorage,
 * but the layout's instance still had `token=null` from its initial mount.
 * After `router.replace('/shop/dashboard')`, the layout's stale instance
 * (token=null) redirected back to /shop/login. The login page's instance
 * (token=set) redirected back to /shop/dashboard. → infinite loop.
 *
 * FIX: convert to a React Context. All components consume the SAME state.
 * When the login page calls `setAuth`, the layout's `useApiClient()` sees
 * the new token immediately (same state object) → no stale state → no loop.
 *
 * ALSO ADDED: automatic token refresh on 401. The login API returns a
 * `refreshToken` but the old `setAuth` only stored the access token — after
 * 15 minutes the access token expired and the user got 401s with no way to
 * refresh. Now `setAuth` stores BOTH tokens, and `request()` auto-refreshes
 * on 401 (one retry; if refresh fails, clearAuth + the caller handles it).
 */

const TOKEN_KEY = 'printshop_token';
const REFRESH_TOKEN_KEY = 'printshop_refresh_token';
const ROLE_KEY = 'printshop_role';
const EMAIL_KEY = 'printshop_email';

export interface AuthState {
  token: string | null;
  refreshToken: string | null;
  role: string | null;
  email: string | null;
}

export interface ApiResponse<T = unknown> {
  status: number;
  data: T | null;
  raw?: Blob | string | null;
  error?: string;
}

interface AuthContextValue extends AuthState {
  ready: boolean;
  setAuth: (token: string, refreshToken: string, role: string, email: string) => void;
  clearAuth: () => void;
  request: <T = unknown>(
    method: string,
    path: string,
    opts?: { body?: unknown; raw?: 'bytes' | 'json' | 'text' },
  ) => Promise<ApiResponse<T>>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Read persisted auth from localStorage on mount.
  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      const rt = localStorage.getItem(REFRESH_TOKEN_KEY);
      const r = localStorage.getItem(ROLE_KEY);
      const e = localStorage.getItem(EMAIL_KEY);
      if (t) setTokenState(t);
      if (rt) setRefreshToken(rt);
      if (r) setRole(r);
      if (e) setEmail(e);
    } catch {
      /* SSR — ignore */
    }
    setReady(true);
  }, []);

  const setAuth = useCallback((t: string, rt: string, r: string, e: string) => {
    setTokenState(t);
    setRefreshToken(rt);
    setRole(r);
    setEmail(e);
    try {
      localStorage.setItem(TOKEN_KEY, t);
      localStorage.setItem(REFRESH_TOKEN_KEY, rt);
      localStorage.setItem(ROLE_KEY, r);
      localStorage.setItem(EMAIL_KEY, e);
    } catch {
      /* ignore */
    }
  }, []);

  const clearAuth = useCallback(() => {
    setTokenState(null);
    setRefreshToken(null);
    setRole(null);
    setEmail(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      localStorage.removeItem(ROLE_KEY);
      localStorage.removeItem(EMAIL_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // ── Auto-refresh on 401 ────────────────────────────────────────────
  // When a request returns 401, try to refresh the access token using the
  // stored refresh token. If refresh succeeds, retry the original request
  // ONCE with the new token. If refresh fails (or no refresh token), return
  // the 401 to the caller (the caller decides whether to clearAuth/redirect).
  const refreshTokens = useCallback(async (): Promise<string | null> => {
    if (!refreshToken) return null;
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        success?: boolean;
        data?: { accessToken?: string; refreshToken?: string };
      };
      const newAccess = json.data?.accessToken;
      const newRefresh = json.data?.refreshToken;
      if (!newAccess || !newRefresh) return null;
      // Persist the refreshed tokens.
      setTokenState(newAccess);
      setRefreshToken(newRefresh);
      try {
        localStorage.setItem(TOKEN_KEY, newAccess);
        localStorage.setItem(REFRESH_TOKEN_KEY, newRefresh);
      } catch {
        /* ignore */
      }
      return newAccess;
    } catch {
      return null;
    }
  }, [refreshToken]);

  const request = useCallback(
    async <T = unknown,>(
      method: string,
      path: string,
      opts?: { body?: unknown; raw?: 'bytes' | 'json' | 'text' },
    ): Promise<ApiResponse<T>> => {
      const doFetch = async (authToken: string | null): Promise<Response> => {
        return fetch(path, {
          method,
          headers: {
            ...(opts?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
        });
      };

      let res = await doFetch(token);

      // ── Auto-refresh on 401 (single retry) ──
      if (res.status === 401 && refreshToken) {
        const newToken = await refreshTokens();
        if (newToken) {
          // Retry the original request with the new token.
          res = await doFetch(newToken);
        }
      }

      let data: T | null = null;
      let raw: Blob | string | null = null;
      const ct = res.headers.get('content-type') ?? '';
      if (opts?.raw === 'bytes' || ct.includes('application/pdf')) {
        raw = await res.blob();
      } else if (ct.includes('application/json')) {
        try {
          data = (await res.json()) as T;
        } catch {
          data = null;
        }
      } else {
        raw = await res.text();
      }

      return { status: res.status, data, raw };
    },
    [token, refreshToken, refreshTokens],
  );

  // Memoize so consumers' useEffect deps are stable across renders (unless
  // the actual state values change).
  const value = useMemo<AuthContextValue>(
    () => ({ token, refreshToken, role, email, ready, setAuth, clearAuth, request }),
    [token, refreshToken, role, email, ready, setAuth, clearAuth, request],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * useApiClient — consume the shared AuthContext. Must be used inside an
 * `<AuthProvider>`. Throws if used outside (dev-time assertion).
 *
 * Backward-compatible with the previous hook's API:
 *   { token, role, email, ready, setAuth, clearAuth, request }
 *
 * NOTE: `setAuth` now takes 4 args (token, refreshToken, role, email) instead
 * of 3. Callers that pass 3 args need to be updated. The login + register
 * pages are the only callers — both are updated in this change.
 */
export function useApiClient(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      'useApiClient must be used inside an <AuthProvider>. Wrap the app (or the /shop/* route group) in <AuthProvider>.',
    );
  }
  return ctx;
}
