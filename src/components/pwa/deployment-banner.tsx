'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Globe, AlertTriangle, CheckCircle2, ExternalLink } from 'lucide-react';

/**
 * DeploymentOriginBanner — shows the shopkeeper the URL they're currently
 * on + warns if it's a Vercel PREVIEW URL (which changes on every commit)
 * rather than the stable PRODUCTION URL.
 *
 * WHY THIS MATTERS:
 *   - The Native Printer + PrintLatch browser tokens are stored in
 *     localStorage, which is per-origin. A token stored under the
 *     production URL is NOT available under a preview URL — the
 *     shopkeeper would have to re-pair on every preview.
 *   - The shop QR code encodes the current origin (we generate it
 *     dynamically). A QR generated on a preview URL points at that
 *     preview URL — which disappears when the branch is deleted.
 *   - The stable production URL (printshop-saas-three.vercel.app) does
 *     NOT change on every commit — Vercel redeploys main to the same URL.
 *
 * This banner helps the shopkeeper notice they're on a preview + switch
 * to the production URL (one click) before they waste time re-pairing.
 *
 * Detection: Vercel preview URLs contain `-git-` in the hostname (branch
 * previews) OR are a different `*.vercel.app` subdomain than the known
 * production URL. Custom domains are treated as production (stable).
 */

// The known stable production URL. If the shopkeeper is on a different
// *.vercel.app subdomain, they're on a preview deployment.
const PRODUCTION_HOST = 'printshop-saas-three.vercel.app';

interface BannerState {
  origin: string;
  host: string;
  isPreview: boolean;
  isProduction: boolean;
  isCustomDomain: boolean;
}

function detect(origin: string): BannerState | null {
  try {
    const url = new URL(origin);
    const host = url.host;
    const isVercelApp = host.endsWith('.vercel.app');
    const isProduction = host === PRODUCTION_HOST;
    // Preview = any *.vercel.app that ISN'T the production host. Branch
    // previews contain "-git-" in the subdomain; commit previews have a
    // hash suffix. Both are unstable.
    const isPreview = isVercelApp && !isProduction;
    // Custom domain = not a vercel.app subdomain (e.g. printshop.myshop.com).
    // Treated as stable (the shopkeeper controls it).
    const isCustomDomain = !isVercelApp;
    return { origin, host, isPreview, isProduction, isCustomDomain };
  } catch {
    return null;
  }
}

export function DeploymentOriginBanner() {
  const [state, setState] = useState<BannerState | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setState(detect(window.location.origin));
  }, []);

  if (!state) return null;

  // Don't show anything on the stable production URL (the common case —
  // no banner noise). Only surface when the shopkeeper is on a preview
  // OR a custom domain (where it's useful to confirm the URL is stable).
  if (state.isProduction) return null;

  if (state.isPreview) {
    return (
      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <AlertTriangle className="size-4" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                You&apos;re on a Vercel <strong>preview</strong> URL
              </p>
              <p className="text-[11px] text-muted-foreground break-all">
                <code className="rounded bg-amber-100 px-1 py-0.5 text-amber-900">{state.host}</code> changes on every commit. Your printer pairing + shop QR are tied to a specific URL — they may not work here.
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                For daily use, open the <strong>stable production URL</strong> instead (it never changes):
              </p>
            </div>
          </div>
          <a
            href={`https://${PRODUCTION_HOST}${typeof window !== 'undefined' ? window.location.pathname : ''}`}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
          >
            <ExternalLink className="size-4" />
            Open production site
          </a>
        </CardContent>
      </Card>
    );
  }

  // Custom domain — show a reassuring "stable URL" note + the host.
  if (state.isCustomDomain) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardContent className="flex items-center gap-3 p-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="size-4" />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Globe className="size-4 shrink-0 text-emerald-600" />
            <span className="truncate text-xs text-muted-foreground">
              Stable custom domain: <code className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-900">{state.host}</code>
            </span>
          </div>
          <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
            Stable URL
          </Badge>
        </CardContent>
      </Card>
    );
  }

  return null;
}
