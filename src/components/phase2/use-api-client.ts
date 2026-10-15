'use client';

import { useCallback, useMemo, useState } from 'react';

export interface LogEntry {
  method: string;
  path: string;
  status: number;
  bodyPreview: string;
  ts: number;
}

export interface ApiState {
  token: string | null;
  log: LogEntry[];
}

/** Minimal typed fetch wrapper that records every call into a log. */
export function useApiClient() {
  const [token, setToken] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const request = useCallback(
    async <T = unknown>(
      method: string,
      path: string,
      opts?: { body?: unknown; raw?: 'bytes' | 'json' | 'text'; tokenOverride?: string },
    ): Promise<{ status: number; data: T | null; raw?: Blob | string | null }> => {
      const tok = opts?.tokenOverride ?? token;
      const res = await fetch(path, {
        method,
        headers: {
          ...(opts?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });

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

      setLog((l) =>
        [
          {
            method,
            path,
            status: res.status,
            bodyPreview: data ? JSON.stringify(data).slice(0, 240) : '',
            ts: Date.now(),
          },
          ...l,
        ].slice(0, 40),
      );
      return { status: res.status, data, raw };
    },
    [token],
  );

  const resetLog = useCallback(() => setLog([]), []);

  // Memoise the returned object so consumers' useEffect deps ([api, ...]) are
  // stable across renders (only changing when token does). Without this, the
  // object is new every render → effect cleanups cancel in-flight fetches.
  return useMemo(() => ({ token, setToken, log, request, resetLog }), [token, log, request, resetLog]);
}
