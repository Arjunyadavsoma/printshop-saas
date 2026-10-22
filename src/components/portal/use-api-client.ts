'use client';

import { useCallback, useEffect, useState } from 'react';

const TOKEN_KEY = 'printshop_token';
const ROLE_KEY = 'printshop_role';
const EMAIL_KEY = 'printshop_email';

export interface AuthState {
  token: string | null;
  role: string | null;
  email: string | null;
}

export interface ApiResponse<T = unknown> {
  status: number;
  data: T | null;
  raw?: Blob | string | null;
  error?: string;
}

/**
 * Shared API client with localStorage token persistence.
 * Used by all three portals (customer, shopkeeper, admin).
 */
export function useApiClient() {
  const [token, setTokenState] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      const r = localStorage.getItem(ROLE_KEY);
      const e = localStorage.getItem(EMAIL_KEY);
      if (t) setTokenState(t);
      if (r) setRole(r);
      if (e) setEmail(e);
    } catch { /* SSR */ }
    setReady(true);
  }, []);

  const setAuth = useCallback((t: string, r: string, e: string) => {
    setTokenState(t);
    setRole(r);
    setEmail(e);
    try {
      localStorage.setItem(TOKEN_KEY, t);
      localStorage.setItem(ROLE_KEY, r);
      localStorage.setItem(EMAIL_KEY, e);
    } catch { /* ignore */ }
  }, []);

  const clearAuth = useCallback(() => {
    setTokenState(null);
    setRole(null);
    setEmail(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(ROLE_KEY);
      localStorage.removeItem(EMAIL_KEY);
    } catch { /* ignore */ }
  }, []);

  const request = useCallback(
    async <T = unknown>(
      method: string,
      path: string,
      opts?: { body?: unknown; raw?: 'bytes' | 'json' | 'text' },
    ): Promise<ApiResponse<T>> => {
      const res = await fetch(path, {
        method,
        headers: {
          ...(opts?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

      let data: T | null = null;
      let raw: Blob | string | null = null;
      const ct = res.headers.get('content-type') ?? '';
      if (opts?.raw === 'bytes' || ct.includes('application/pdf')) {
        raw = await res.blob();
      } else if (ct.includes('application/json')) {
        try { data = (await res.json()) as T; } catch { data = null; }
      } else {
        raw = await res.text();
      }

      return { status: res.status, data, raw };
    },
    [token],
  );

  return { token, role, email, ready, setAuth, clearAuth, request };
}
