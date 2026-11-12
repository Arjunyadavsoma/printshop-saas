'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiClient } from '@/components/portal/use-api-client';
import { cn, timeAgo } from '@/lib/utils';
import { Monitor, Wifi, WifiOff, Printer, AlertCircle, CheckCircle2 } from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  printerName: string | null;
}

interface AgentsResponse {
  data?: { agents: Agent[] };
  error?: { message?: string };
}

/**
 * PrintEXEOverview — compact dashboard widget showing device status.
 *
 * Displays:
 * - Total registered devices
 * - Online vs offline count
 * - Device names + last heartbeat
 * - "No devices" empty state with link to printer setup
 */
export function PrintEXEOverview() {
  const api = useApiClient();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!api.ready) return;
    const r = await api.request<AgentsResponse>('GET', '/api/v1/shops/me/agents');
    if (r.status >= 400 || !r.data?.data) {
      setError(true);
    } else {
      setAgents(r.data.data.agents ?? []);
      setError(false);
    }
    setLoading(false);
  }, [api]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const online = agents.filter(a => a.isOnline);
  const offline = agents.filter(a => !a.isOnline);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Monitor className="size-4 text-brand" aria-hidden="true" />
          PrintEXE Devices
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="size-4 text-danger" aria-hidden="true" />
            Could not load device status
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <Monitor className="size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No devices registered</p>
            <a href="/shop/printer" className="text-xs text-brand hover:underline">
              Set up a device →
            </a>
          </div>
        ) : (
          <>
            {/* Summary row */}
            <div className="flex items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5 text-success">
                <Wifi className="size-3.5" aria-hidden="true" />
                {online.length} online
              </span>
              {offline.length > 0 && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <WifiOff className="size-3.5" aria-hidden="true" />
                  {offline.length} offline
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {agents.length} total
              </span>
            </div>

            {/* Device list (compact) */}
            <div className="space-y-1.5">
              {agents.slice(0, 4).map(agent => (
                <div key={agent.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                  <div className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded',
                    agent.isOnline ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
                  )}>
                    {agent.isOnline ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">{agent.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {agent.lastSeenAt ? timeAgo(agent.lastSeenAt) : 'Never connected'}
                    </p>
                  </div>
                  {agent.printerName && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      <Printer className="mr-1 size-2.5" aria-hidden="true" />
                      {agent.printerName.length > 12 ? agent.printerName.slice(0, 12) + '…' : agent.printerName}
                    </Badge>
                  )}
                </div>
              ))}
              {agents.length > 4 && (
                <p className="text-center text-xs text-muted-foreground">
                  +{agents.length - 4} more device{agents.length - 4 !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            <a href="/shop/printer" className="block text-center text-xs text-brand hover:underline">
              Manage devices →
            </a>
          </>
        )}
      </CardContent>
    </Card>
  );
}
