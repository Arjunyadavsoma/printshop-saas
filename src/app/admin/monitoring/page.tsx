'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Activity,
  RefreshCw,
  AlertCircle,
  Database,
  HardDrive,
  Cpu,
  Radio,
  Wifi,
  WifiOff,
  Printer,
  ShieldCheck,
  History,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminAnalyticsResponse,
  type AdminAuditResponse,
  type AdminAuditEntry,
  type AdminOrderListResponse,
  type ReadyResponse,
  type OrderStatus,
} from '@/components/portal/admin-types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleString('en-IN', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return s;
  }
}

function truncate(s: string, n = 8): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

interface HealthState {
  status: 'healthy' | 'unhealthy' | 'not_configured' | 'not_verified';
  detail: string;
  latencyMs?: number;
}

/**
 * /admin/monitoring — operational monitoring.
 *
 * Combines three signals:
 *   - /api/v1/ready → database / storage / cache / realtime health
 *   - /api/v1/admin/analytics → print-agent online/offline counts
 *   - /api/v1/admin/audit?limit=20 → recent audit log
 *   - /api/v1/admin/orders?status=cancelled&limit=50 → failed/disputed orders
 *     requiring review
 *
 * Honest status reporting:
 *   - "healthy" (green) only when a probe confirms it
 *   - "not_configured" (gray) when the dependency is using an in-memory dev
 *     stub (i.e. not surfaced by /ready on purpose)
 *   - "not_verified" (gray) when /ready doesn't include the check but the
 *     container names a provider
 *
 * No fake green status.
 */
export default function AdminMonitoringPage() {
  const api = useApiClient();
  const [ready, setReady] = useState<ReadyResponse | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalyticsResponse | null>(null);
  const [audit, setAudit] = useState<AdminAuditEntry[]>([]);
  const [cancelled, setCancelled] = useState<AdminOrderListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rRes, aRes, auRes, cRes] = await Promise.all([
        api.request<unknown>('GET', '/api/v1/ready'),
        api.request<unknown>('GET', '/api/v1/admin/analytics'),
        api.request<unknown>('GET', '/api/v1/admin/audit?limit=20'),
        api.request<unknown>('GET', '/api/v1/admin/orders?status=cancelled&limit=50'),
      ]);
      // /ready can return 503 when unhealthy — the envelope still has data.
      // Read the inner data field via unwrap (which throws only on success=false;
      // 503 response from /ready still returns success=true with ready=false).
      try {
        setReady(unwrap<ReadyResponse>(rRes));
      } catch {
        setReady(null);
      }
      setAnalytics(unwrap<AdminAnalyticsResponse>(aRes));
      setAudit(unwrap<AdminAuditResponse>(auRes).entries ?? []);
      setCancelled(unwrap<AdminOrderListResponse>(cRes));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monitoring data');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (!api.ready || !api.token || api.role !== 'admin') return;
    void load();
  }, [api.ready, api.token, api.role, load]);

  // Build per-service health states.
  function deriveHealth(name: 'database' | 'storage' | 'cache' | 'realtime'): HealthState {
    if (!ready) return { status: 'not_verified', detail: 'No probe data' };
    const check = ready.checks.find((c) => c.name === name);
    if (check) {
      return {
        status: check.healthy ? 'healthy' : 'unhealthy',
        detail: check.provider,
        latencyMs: check.latencyMs,
      };
    }
    // Not in /ready checks — usually means the dependency is using an
    // in-memory dev stub (the ready probe deliberately skips memory stubs).
    const providerName =
      name === 'storage' ? analytics?.health.storage :
      name === 'cache' ? analytics?.health.cache :
      name === 'realtime' ? analytics?.health.realtime :
      'unknown';
    if (!providerName || providerName === 'unknown') {
      return { status: 'not_configured', detail: 'Not configured' };
    }
    if (providerName === 'memory') {
      return { status: 'not_configured', detail: 'In-memory dev stub (not probed)' };
    }
    // External provider named but not in the /ready response — treat as not
    // verified (we can't claim it's healthy without a probe).
    return { status: 'not_verified', detail: `${providerName} (not probed)` };
  }

  const healths = {
    database: deriveHealth('database'),
    storage: deriveHealth('storage'),
    cache: deriveHealth('cache'),
    realtime: deriveHealth('realtime'),
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-600" />
            <h2 className="text-xl font-bold tracking-tight sm:text-2xl">Monitoring</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Service health, print-agent connectivity, failed jobs requiring review, and the recent audit log.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="text-sm text-red-800 dark:text-red-200">
              <p className="font-semibold">Failed to load monitoring data</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overall readiness banner */}
      <Card className={ready?.ready ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40' : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'}>
        <CardContent className="flex items-center gap-3 p-4">
          {ready?.ready ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
          )}
          <div className="text-sm">
            <span className="font-semibold">
              {ready ? (ready.ready ? 'Platform ready' : 'Platform NOT ready') : 'Readiness unknown'}
            </span>
            <span className="ml-2 text-muted-foreground">
              {ready?.ready
                ? 'All probed dependencies are healthy.'
                : 'One or more probed dependencies are unhealthy — see the table below.'}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Service health grid */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Service health</CardTitle>
          <CardDescription>
            From GET /api/v1/ready + GET /api/v1/admin/analytics health section.
            Honest status — never a fake green.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <HealthTile icon={Database} label="Database" health={healths.database} />
              <HealthTile icon={HardDrive} label="Storage" health={healths.storage} />
              <HealthTile icon={Cpu} label="Cache" health={healths.cache} />
              <HealthTile icon={Radio} label="Realtime" health={healths.realtime} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Print-agent connectivity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Print-agent connectivity</CardTitle>
          <CardDescription>From GET /api/v1/admin/analytics health section</CardDescription>
        </CardHeader>
        <CardContent>
          {loading || !analytics ? (
            <Skeleton className="h-20" />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
                <Wifi className="h-6 w-6 text-emerald-600" />
                <div>
                  <div className="text-xs text-muted-foreground">Online</div>
                  <div className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                    {analytics.health.agentsOnline}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/40">
                <WifiOff className="h-6 w-6 text-zinc-500" />
                <div>
                  <div className="text-xs text-muted-foreground">Offline</div>
                  <div className="text-2xl font-bold tabular-nums text-zinc-700 dark:text-zinc-300">
                    {analytics.health.agentsOffline}
                  </div>
                </div>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Agent presence is heartbeated every 15s — an agent is offline if no
            heartbeat arrives within ~30s.
          </p>
        </CardContent>
      </Card>

      {/* Failed jobs requiring review */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Failed jobs requiring review</CardTitle>
              <CardDescription>Orders in <code className="font-mono">cancelled</code> state</CardDescription>
            </div>
            <Link href="/admin/orders?status=cancelled">
              <Button variant="ghost" size="sm" className="text-emerald-700 dark:text-emerald-400">
                View all
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : !cancelled || cancelled.orders.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-emerald-600" />
              No cancelled orders. All good.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Shop</TableHead>
                  <TableHead>Customer token</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Txn ID</TableHead>
                  <TableHead>Cancelled at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cancelled.orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs text-emerald-700 hover:underline dark:text-emerald-400">
                        {truncate(o.id, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{o.shopName}</TableCell>
                    <TableCell className="font-mono text-xs">{truncate(o.customerToken, 10)}</TableCell>
                    <TableCell className="text-right tabular-nums">{(o.totalAmountPaise / 100).toFixed(2)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {o.paymentTxnId ? truncate(o.paymentTxnId, 12) : '—'}
                    </TableCell>
                    <TableCell className="text-xs">{formatDateTime(o.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent audit log</CardTitle>
              <CardDescription>
                From GET /api/v1/admin/audit?limit=20. Sensitive fields (raw
                webhook bodies, credentials, UTRs) are NOT stored here.
              </CardDescription>
            </div>
            <History className="h-4 w-4 text-muted-foreground" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : audit.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No audit entries.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Shop ID</TableHead>
                    <TableHead>User ID</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{formatDateTime(e.createdAt)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {e.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-mono">{e.entityType}</span>
                        <span className="ml-1 text-muted-foreground">#{truncate(e.entityId, 8)}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {e.shopId ? truncate(e.shopId, 8) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {e.userId ? truncate(e.userId, 8) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{e.ip ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HealthTile({
  icon: Icon,
  label,
  health,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  health: HealthState;
}) {
  const config = {
    healthy: {
      ring: 'border-emerald-200 dark:border-emerald-900',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
      label: 'Healthy',
      labelCls: 'text-emerald-700 dark:text-emerald-300',
    },
    unhealthy: {
      ring: 'border-red-200 dark:border-red-900',
      bg: 'bg-red-50 dark:bg-red-950/40',
      icon: <XCircle className="h-5 w-5 text-red-600" />,
      label: 'Unhealthy',
      labelCls: 'text-red-700 dark:text-red-300',
    },
    not_configured: {
      ring: 'border-zinc-200 dark:border-zinc-700',
      bg: 'bg-zinc-50 dark:bg-zinc-800/40',
      icon: <HelpCircle className="h-5 w-5 text-zinc-500" />,
      label: 'Not configured',
      labelCls: 'text-zinc-600 dark:text-zinc-400',
    },
    not_verified: {
      ring: 'border-zinc-200 dark:border-zinc-700',
      bg: 'bg-zinc-50 dark:bg-zinc-800/40',
      icon: <HelpCircle className="h-5 w-5 text-zinc-500" />,
      label: 'Not verified',
      labelCls: 'text-zinc-600 dark:text-zinc-400',
    },
  }[health.status];

  return (
    <div className={`flex items-start gap-3 rounded-md border ${config.ring} ${config.bg} p-4`}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{label}</span>
          <span className={`text-xs font-medium ${config.labelCls}`}>{config.label}</span>
        </div>
        <div className="mt-1 truncate font-mono text-xs text-muted-foreground" title={health.detail}>
          {health.detail}
        </div>
        {typeof health.latencyMs === 'number' && (
          <div className="mt-0.5 text-xs text-muted-foreground">
            latency: {health.latencyMs}ms
          </div>
        )}
      </div>
    </div>
  );
}
