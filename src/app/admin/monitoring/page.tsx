'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  RefreshCw,
  AlertCircle,
  Database,
  HardDrive,
  Cpu,
  Radio,
  Wifi,
  WifiOff,
  History,
  ShieldCheck,
} from 'lucide-react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  unwrap,
  type AdminAnalyticsResponse,
  type AdminAuditResponse,
  type AdminAuditEntry,
  type AdminOrderListResponse,
  type ReadyResponse,
} from '@/components/portal/admin-types';
import { truncate } from '@/lib/utils';
import { StatusIndicator } from '@/components/shared/status-indicator';
import { EmptyState } from '@/components/shared/empty-state';
import { PageHeader } from '@/components/shared/page-header';
import { CardSkeleton, TableSkeleton } from '@/components/shared/loading-skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

interface HealthState {
  status: 'healthy' | 'unhealthy' | 'not_configured' | 'not_verified';
  detail: string;
  latencyMs?: number;
}

/**
 * /admin/monitoring — operational monitoring.
 *
 * Combines four signals:
 *   - /api/v1/ready → database / storage / cache / realtime health
 *   - /api/v1/admin/analytics → print-agent online/offline counts
 *   - /api/v1/admin/audit?limit=20 → recent audit log
 *   - /api/v1/admin/orders?status=cancelled&limit=50 → failed/disputed orders
 *     requiring review
 *
 * Honest status reporting:
 *   - "healthy" (success) only when a probe confirms it
 *   - "not_configured" (neutral) when the dependency is using an in-memory dev
 *     stub (i.e. not surfaced by /ready on purpose)
 *   - "not_verified" (neutral) when /ready doesn't include the check but the
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
    <div className="space-y-6">
      <PageHeader
        title="System Monitoring"
        description="Service health, print-agent connectivity, failed jobs requiring review, and the recent audit log."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="min-h-[44px] gap-2"
          >
            <RefreshCw
              className={`size-4 ${loading ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            Refresh
          </Button>
        }
      />

      {error && (
        <Card className="border-danger-border bg-danger-soft">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
            <div className="text-sm text-danger">
              <p className="font-semibold">Failed to load monitoring data</p>
              <p className="mt-1 font-mono text-xs">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overall readiness banner */}
      <Card
        className={
          ready?.ready
            ? 'border-success-border bg-success-soft'
            : 'border-warning-border bg-warning-soft'
        }
      >
        <CardContent className="flex items-center gap-3 p-4">
          {ready?.ready ? (
            <ShieldCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <AlertCircle className="size-5 shrink-0 text-warning-foreground" aria-hidden="true" />
          )}
          <div className="text-sm">
            <span className="font-semibold text-foreground">
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

      {/* Health status cards: API health, Database, Cron jobs, Webhooks */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
        ) : (
          <>
            <HealthCard
              icon={ShieldCheck}
              label="API health"
              health={{
                status: ready?.ready ? 'healthy' : 'unhealthy',
                detail: ready ? (ready.ready ? 'All checks pass' : 'One or more checks fail') : 'No probe data',
              }}
            />
            <HealthCard icon={Database} label="Database" health={healths.database} />
            <HealthCard
              icon={History}
              label="Cron jobs"
              health={{
                status: 'not_verified',
                detail: 'Cron runner not probed by /ready',
              }}
            />
            <HealthCard
              icon={Radio}
              label="Webhooks"
              health={{
                status: 'not_verified',
                detail: 'Webhook delivery not probed by /ready',
              }}
            />
          </>
        )}
      </div>

      {/* Service health (full grid) */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Service health</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            From GET /api/v1/ready + GET /api/v1/admin/analytics health section. Honest status —
            never a fake green.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
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
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">Print-agent connectivity</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            From GET /api/v1/admin/analytics health section
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading || !analytics ? (
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-3 rounded-lg border border-success-border bg-success-soft p-4">
                <Wifi className="size-6 text-success" aria-hidden="true" />
                <div>
                  <p className="text-xs text-muted-foreground">Online</p>
                  <p className="text-2xl font-semibold tabular-nums text-success">
                    {analytics.health.agentsOnline}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted p-4">
                <WifiOff className="size-6 text-muted-foreground" aria-hidden="true" />
                <div>
                  <p className="text-xs text-muted-foreground">Offline</p>
                  <p className="text-2xl font-semibold tabular-nums text-muted-foreground">
                    {analytics.health.agentsOffline}
                  </p>
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
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Failed jobs requiring review</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                Orders in <code className="font-mono text-xs">cancelled</code> state
              </CardDescription>
            </div>
            <Link href="/admin/orders?status=cancelled">
              <Button variant="ghost" size="sm" className="text-brand">
                View all
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={4} cols={6} />
            </div>
          ) : !cancelled || cancelled.orders.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck className="size-6 text-success" aria-hidden="true" />}
              title="No cancelled orders"
              description="All clear — no failed jobs require review right now."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Shop</TableHead>
                  <TableHead className="hidden md:table-cell">Customer token</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="hidden lg:table-cell">Txn ID</TableHead>
                  <TableHead className="hidden md:table-cell">Cancelled at</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cancelled.orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="font-mono text-xs text-brand hover:underline"
                      >
                        {truncate(o.id, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{o.shopName}</TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">
                      {truncate(o.customerToken, 10)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(o.totalAmountPaise / 100).toFixed(2)}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                      {o.paymentTxnId ? truncate(o.paymentTxnId, 12) : '—'}
                    </TableCell>
                    <TableCell className="hidden text-xs tabular-nums md:table-cell">
                      {formatDateTime(o.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card className="bg-surface">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Recent audit log</CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                From GET /api/v1/admin/audit?limit=20. Sensitive fields (raw
                webhook bodies, credentials, UTRs) are NOT stored here.
              </CardDescription>
            </div>
            <History className="size-4 text-muted-foreground" aria-hidden="true" />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={6} cols={6} />
            </div>
          ) : audit.length === 0 ? (
            <EmptyState
              icon={<History className="size-6" aria-hidden="true" />}
              title="No audit entries"
              description="Audit log entries will appear here as admins perform actions."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="hidden md:table-cell">Entity</TableHead>
                    <TableHead className="hidden lg:table-cell">Shop ID</TableHead>
                    <TableHead className="hidden lg:table-cell">User ID</TableHead>
                    <TableHead className="hidden md:table-cell">IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs tabular-nums">
                        {formatDateTime(e.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {e.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-xs md:table-cell">
                        <span className="font-mono">{e.entityType}</span>
                        <span className="ml-1 text-muted-foreground">#{truncate(e.entityId, 8)}</span>
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                        {e.shopId ? truncate(e.shopId, 8) : '—'}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">
                        {e.userId ? truncate(e.userId, 8) : '—'}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                        {e.ip ?? '—'}
                      </TableCell>
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

function HealthCard({
  icon: Icon,
  label,
  health,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  health: HealthState;
}) {
  const variant =
    health.status === 'healthy'
      ? 'success'
      : health.status === 'unhealthy'
        ? 'danger'
        : 'neutral';
  const detailLabel =
    health.status === 'healthy'
      ? 'Healthy'
      : health.status === 'unhealthy'
        ? 'Unhealthy'
        : health.status === 'not_configured'
          ? 'Not configured'
          : 'Not verified';
  return (
    <Card className="bg-surface">
      <CardContent className="flex items-start gap-3 p-5">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          aria-hidden="true"
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <div className="mt-1.5">
            <StatusIndicator variant={variant} label={`${label}: ${detailLabel}`} />
          </div>
          <p
            className="mt-1.5 truncate font-mono text-xs text-muted-foreground"
            title={health.detail}
          >
            {health.detail}
          </p>
          {typeof health.latencyMs === 'number' && (
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              latency: {health.latencyMs}ms
            </p>
          )}
        </div>
      </CardContent>
    </Card>
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
  const variant =
    health.status === 'healthy'
      ? 'success'
      : health.status === 'unhealthy'
        ? 'danger'
        : 'neutral';
  const detailLabel =
    health.status === 'healthy'
      ? 'Healthy'
      : health.status === 'unhealthy'
        ? 'Unhealthy'
        : health.status === 'not_configured'
          ? 'Not configured'
          : 'Not verified';
  const tileBorder =
    health.status === 'healthy'
      ? 'border-success-border'
      : health.status === 'unhealthy'
        ? 'border-danger-border'
        : 'border-border';
  const tileBg =
    health.status === 'healthy'
      ? 'bg-success-soft'
      : health.status === 'unhealthy'
        ? 'bg-danger-soft'
        : 'bg-muted';
  return (
    <div className={`flex items-start gap-3 rounded-lg border ${tileBorder} ${tileBg} p-4`}>
      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <StatusIndicator variant={variant} label={`${label}: ${detailLabel}`} />
        </div>
        <p
          className="mt-1 truncate font-mono text-xs text-muted-foreground"
          title={health.detail}
        >
          {health.detail}
        </p>
        {typeof health.latencyMs === 'number' && (
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            latency: {health.latencyMs}ms
          </p>
        )}
      </div>
    </div>
  );
}
