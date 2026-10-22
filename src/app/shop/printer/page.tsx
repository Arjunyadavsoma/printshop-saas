'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Printer as PrinterIcon,
  Wifi,
  WifiOff,
  RefreshCw,
  Loader2,
  Copy,
  Check,
  PlusCircle,
  AlertTriangle,
  Terminal,
  Cpu,
  Monitor,
} from 'lucide-react';

interface AgentRow {
  id: string;
  name: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  printerName: string | null;
  version: string | null;
  os: string | null;
}

interface RegisterResponse {
  agentId: string;
  deviceToken: string;
  shopId: string;
  shopName: string;
  warning: string;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const delta = Date.now() - then;
  if (delta < 0) return 'just now';
  if (delta < 1000) return `${delta}ms ago`;
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return new Date(then).toLocaleString();
}

function isStale(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return true;
  const then = new Date(lastSeenAt).getTime();
  if (Number.isNaN(then)) return true;
  return Date.now() - then > 30_000; // 30s heartbeat cutoff
}

const INSTALL_COMMANDS = (token: string) => `cd mini-services/print-agent
bun install
PRINT_AGENT_DEMO=1 PRINT_AGENT_DEVICE_TOKEN=${token} PRINT_AGENT_API_URL=http://localhost:3000 bun src/index.ts start`;

export default function ShopPrinterPage() {
  const api = useApiClient();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-agent registration
  const [name, setName] = useState('');
  const [registering, setRegistering] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const r = await api.request<{ data?: AgentRow[] }>('GET', '/api/v1/shops/me/agents');
      if (r.status === 200 && r.data?.data) {
        setAgents(r.data.data);
      } else if (r.status === 401) {
        setError('Session expired. Please log in again.');
      } else {
        setError('Could not load agents.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(true), 15_000); // match the 15s heartbeat
    return () => clearInterval(id);
  }, []);

  const registerAgent = async () => {
    setRegistering(true);
    setRegisterError(null);
    setNewToken(null);
    try {
      const r = await api.request<RegisterResponse>('POST', '/api/v1/agents/register', {
        body: { name: name.trim() || 'shop-agent', os: undefined, version: undefined, printerName: undefined },
      });
      if (r.status === 200 && r.data?.deviceToken) {
        setNewToken(r.data.deviceToken);
        setName('');
        await load(true);
      } else {
        const err = r.data as unknown as { error?: { message?: string } };
        setRegisterError(err?.error?.message ?? `Registration failed (HTTP ${r.status}).`);
      }
    } catch (err) {
      setRegisterError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setRegistering(false);
    }
  };

  const copyToken = async () => {
    if (!newToken) return;
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const copyInstall = async (token: string) => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMANDS(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const anyOnline = agents.some((a) => a.isOnline);

  const summary = useMemo(() => {
    return {
      total: agents.length,
      online: agents.filter((a) => a.isOnline).length,
      offline: agents.filter((a) => !a.isOnline).length,
      stale: agents.filter((a) => isStale(a.lastSeenAt)).length,
    };
  }, [agents]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-9 w-64 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PrinterIcon className="size-5 text-amber-600" />
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Printer setup</h1>
            <p className="text-xs text-muted-foreground">
              Connect a print agent so orders print automatically. You can still download files
              manually below.
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="gap-1.5"
        >
          {refreshing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-rose-200 bg-rose-50">
          <CardContent className="p-4 text-sm text-rose-700">{error}</CardContent>
        </Card>
      )}

      {/* Connection banner */}
      <Card
        className={`border-l-4 ${
          anyOnline
            ? 'border-l-emerald-400 bg-emerald-50/50'
            : 'border-l-amber-400 bg-amber-50/50'
        }`}
      >
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            {anyOnline ? (
              <Wifi className="size-5 text-emerald-600" />
            ) : (
              <WifiOff className="size-5 text-amber-600" />
            )}
            <div>
              <p className="text-sm font-medium">
                {anyOnline ? 'Print agent online' : 'No print agent connected'}
              </p>
              <p className="text-xs text-muted-foreground">
                {anyOnline
                  ? `Heartbeating within the last 30s · ${summary.online} of ${summary.total} agent(s) online`
                  : 'You can still download print-ready files manually from each order. The agent is recommended for hands-off operation.'}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="gap-1">
            {summary.online} online · {summary.offline} offline · {summary.total} total
          </Badge>
        </CardContent>
      </Card>

      {/* Agents list */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-base">Registered agents</CardTitle>
          <CardDescription className="text-xs">
            Each agent is identified by a name and a device token (only the SHA-256 hash is stored
            on the server). Heartbeats every 15s; an agent is “offline” after 30s of silence.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <PrinterIcon className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">No agents registered yet</p>
              <p className="max-w-md text-xs text-muted-foreground">
                Register one below, then run the install commands on the shop’s PC. The agent talks
                outbound only — no inbound ports, works behind any NAT.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>Printer</TableHead>
                  <TableHead>OS / version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map((a) => {
                  const stale = isStale(a.lastSeenAt);
                  const online = a.isOnline && !stale;
                  return (
                    <TableRow key={a.id}>
                      <TableCell className="pl-4">
                        <div className="flex flex-col">
                          <span className="font-medium">{a.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">{a.id}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            online
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-amber-200 bg-amber-50 text-amber-700'
                          }
                        >
                          {online ? 'online' : 'offline'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {timeAgo(a.lastSeenAt)}
                      </TableCell>
                      <TableCell className="text-sm">{a.printerName ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.os ?? '—'} · v{a.version ?? '?'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Register new agent */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PlusCircle className="size-4 text-amber-600" />
            Register a new agent
          </CardTitle>
          <CardDescription className="text-xs">
            Mints a one-time device token. Save it immediately — the plaintext token is shown only
            once (only the SHA-256 hash is stored).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Agent name (optional)</Label>
            <Input
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. counter-pc, back-office-printer"
            />
          </div>
          {registerError && (
            <p className="text-sm text-rose-700">⚠ {registerError}</p>
          )}
          {newToken && (
            <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-3">
              <p className="text-sm font-medium text-emerald-800">
                ✓ Agent registered. Copy this device token — it will not be shown again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-white px-2 py-1.5 font-mono text-xs text-emerald-900">
                  {newToken}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copyToken()}
                  className="gap-1.5"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90" disabled={registering}>
                {registering ? <Loader2 className="size-4 animate-spin" /> : <PlusCircle className="size-4" />}
                Register agent
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Register a new agent?</AlertDialogTitle>
                <AlertDialogDescription>
                  This mints a one-time device token for the agent to authenticate. The token is
                  shown ONCE on the next screen — copy it before leaving this page.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-amber-600 text-white hover:bg-amber-600/90"
                  onClick={(e) => {
                    e.preventDefault();
                    void registerAgent();
                  }}
                >
                  Yes, mint device token
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>

      {/* Installation instructions */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Terminal className="size-4 text-amber-600" />
            Installation commands
          </CardTitle>
          <CardDescription className="text-xs">
            The print agent is <strong>source-based</strong> (no installer): run the commands
            below in a terminal on the shop’s PC. The agent daemon connects out to the PrintShop
            API + realtime mini-service over socket.io; no inbound ports required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {newToken ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Run these on the shop’s PC:
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void copyInstall(newToken)}
                  className="gap-1.5"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-md border border-border bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-100">
                <code>{INSTALL_COMMANDS(newToken)}</code>
              </pre>
              <p className="text-xs text-muted-foreground">
                The agent will start, register its name, and begin heartbeating every 15s. Once it
                shows “online” above, it will pick up new paid orders automatically.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-amber-300 bg-amber-50/50 p-4 text-sm text-amber-800">
              <AlertTriangle className="mb-2 size-4" />
              Register an agent above first — the install command needs its one-time device token.
              <pre className="mt-3 overflow-x-auto rounded border border-border bg-zinc-950 p-3 text-xs text-zinc-100">
                <code>{`cd mini-services/print-agent
bun install
PRINT_AGENT_DEMO=1 \\
  PRINT_AGENT_DEVICE_TOKEN=<paste-token-here> \\
  PRINT_AGENT_API_URL=http://localhost:3000 \\
  bun src/index.ts start`}</code>
              </pre>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <span className="flex items-center gap-1">
            <Cpu className="size-3.5" /> Heartbeats every 15s · 30s offline cutoff
          </span>
          <span className="flex items-center gap-1">
            <Monitor className="size-3.5" /> Agent version 0.1.0 · source-only
          </span>
        </CardFooter>
      </Card>

      {/* Manual download note */}
      <Card className="border-l-4 border-l-sky-400 bg-sky-50/50">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 size-4 text-sky-700" />
          <div>
            <p className="text-sm font-medium text-sky-900">Manual download always works</p>
            <p className="mt-1 text-xs text-sky-800">
              Even without an agent, every paid order in <a className="font-medium underline" href="/shop/orders">Orders</a>{' '}
              has a Download button on the file list. Use this when the agent is offline, when you
              want to print from a different machine, or to inspect a file before sending it to the
              agent.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
