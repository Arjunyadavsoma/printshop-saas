'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useApiClient } from '@/components/portal/use-api-client';
import { cn, timeAgo } from '@/lib/utils';
import {
  Plus, Copy, Check, Trash2, Monitor, Wifi, WifiOff, RefreshCw, AlertTriangle, Loader2,
} from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  printerName: string | null;
  version: string | null;
  os: string | null;
  createdAt: string;
}

interface RegisterResponse {
  agentId: string;
  deviceToken: string;
  shopId: string;
  shopName: string;
  warning: string;
}

/**
 * DeviceManager — manages PrintEXE devices for a shop.
 *
 * Features:
 * - Register new device (POST /api/v1/agents/register)
 * - One-time device token display with copy-to-clipboard
 * - Device list with online/offline status + last heartbeat
 * - Revoke device (DELETE /api/v1/agents/{id}) with confirmation dialog
 * - Auto-refresh device list every 30s + on window focus
 */
export function DeviceManager() {
  const api = useApiClient();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Registration modal state
  const [regOpen, setRegOpen] = useState(false);
  const [regName, setRegName] = useState('');
  const [regPrinter, setRegPrinter] = useState('');
  const [registering, setRegistering] = useState(false);
  const [tokenData, setTokenData] = useState<RegisterResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Revocation state
  const [revokeAgent, setRevokeAgent] = useState<Agent | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadAgents = useCallback(async () => {
    if (!api.ready) return;
    const r = await api.request<{ data?: { agents: Agent[] }; error?: { message?: string } }>(
      'GET', '/api/v1/shops/me/agents',
    );
    if (r.status >= 400 || !r.data?.data) {
      setError(r.data?.error?.message ?? 'Failed to load devices');
    } else {
      setAgents(r.data.data.agents ?? []);
      setError(null);
    }
    setLoading(false);
  }, [api]);

  useEffect(() => {
    void loadAgents();
  }, [api.ready, loadAgents]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => void loadAgents(), 30_000);
    return () => clearInterval(id);
  }, [loadAgents]);

  const handleRegister = async () => {
    if (!regName.trim()) return;
    setRegistering(true);
    const r = await api.request<{ data?: RegisterResponse; error?: { message?: string } }>(
      'POST', '/api/v1/agents/register',
      { body: JSON.stringify({ name: regName.trim(), os: 'win32', printerName: regPrinter.trim() || undefined }) },
    );
    setRegistering(false);
    if (r.status >= 400 || !r.data?.data) {
      setError(r.data?.error?.message ?? 'Failed to register device');
    } else {
      setTokenData(r.data.data);
      setRegName('');
      setRegPrinter('');
      void loadAgents(); // refresh list
    }
  };

  const handleCopyToken = async () => {
    if (!tokenData) return;
    try {
      await navigator.clipboard.writeText(tokenData.deviceToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select + prompt
      window.prompt('Copy this token:', tokenData.deviceToken);
    }
  };

  const handleRevoke = async () => {
    if (!revokeAgent) return;
    setRevoking(true);
    await api.request('DELETE', `/api/v1/agents/${revokeAgent.id}`);
    setRevoking(false);
    setRevokeAgent(null);
    void loadAgents();
  };

  const onlineCount = agents.filter(a => a.isOnline).length;
  const offlineCount = agents.length - onlineCount;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">PrintEXE Devices</h3>
          <p className="text-sm text-muted-foreground">
            {agents.length} device{agents.length !== 1 ? 's' : ''} registered ·{' '}
            <span className="text-success font-medium">{onlineCount} online</span>
            {offlineCount > 0 && (
              <span className="text-muted-foreground"> · {offlineCount} offline</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-11" onClick={() => void loadAgents()} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} aria-hidden="true" />
            Refresh
          </Button>
          <Button size="sm" className="h-11 bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => setRegOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add Device
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <Card className="border-danger/40 bg-danger-soft/40">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-danger">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {error}
          </CardContent>
        </Card>
      )}

      {/* Device list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <Card key={i}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className="size-10 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-48 animate-pulse rounded bg-muted" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <Monitor className="size-8 text-muted-foreground" aria-hidden="true" />
            <div>
              <p className="font-medium text-foreground">No devices registered</p>
              <p className="text-sm text-muted-foreground">
                Register a PrintEXE device to start receiving print jobs automatically.
              </p>
            </div>
            <Button size="sm" className="h-11 bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => setRegOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              Register your first device
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {agents.map(agent => (
            <DeviceCard
              key={agent.id}
              agent={agent}
              onRevoke={() => setRevokeAgent(agent)}
            />
          ))}
        </div>
      )}

      {/* Registration Modal */}
      <Dialog open={regOpen} onOpenChange={(open) => { setRegOpen(open); if (!open) setTokenData(null); }}>
        <DialogContent className="max-w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Register PrintEXE Device</DialogTitle>
            <DialogDescription>
              Enter a name for this device. After registration, you'll receive a one-time token to paste into PrintEXE.
            </DialogDescription>
          </DialogHeader>

          {tokenData ? (
            // One-time token display
            <div className="space-y-4">
              <div className="rounded-lg border border-warning/30 bg-warning-soft p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-semibold text-warning-foreground">
                      Save this token — it's shown only once!
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Copy this token and paste it into PrintEXE's setup screen. You won't be able to see it again.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="device-token">Device Token</Label>
                <div className="flex gap-2">
                  <Input
                    id="device-token"
                    readOnly
                    value={tokenData.deviceToken}
                    className="font-mono text-xs"
                    aria-describedby="token-help"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    onClick={handleCopyToken}
                    aria-label="Copy token to clipboard"
                  >
                    {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
                  </Button>
                </div>
                <p id="token-help" className="text-xs text-muted-foreground">
                  {copied ? '✓ Copied to clipboard!' : 'Click the copy button or select the text to copy.'}
                </p>
              </div>

              <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Setup instructions:</p>
                <ol className="mt-1 list-decimal space-y-1 pl-4">
                  <li>Open PrintEXE on your Windows PC</li>
                  <li>Go to Settings → Paste Device Token</li>
                  <li>Paste the token above</li>
                  <li>Click "Connect"</li>
                </ol>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  className="h-11"
                  onClick={() => { setRegOpen(false); setTokenData(null); }}
                >
                  I've saved the token — Close
                </Button>
              </DialogFooter>
            </div>
          ) : (
            // Registration form
            <>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="device-name">Device Name *</Label>
                  <Input
                    id="device-name"
                    placeholder="e.g. Front Desk PC"
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    className="h-11"
                    aria-describedby="name-help"
                  />
                  <p id="name-help" className="text-xs text-muted-foreground">
                    A label to identify this device in the dashboard.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="printer-name">Printer Name (optional)</Label>
                  <Input
                    id="printer-name"
                    placeholder="e.g. HP LaserJet Pro M404"
                    value={regPrinter}
                    onChange={(e) => setRegPrinter(e.target.value)}
                    className="h-11"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" className="h-11" onClick={() => setRegOpen(false)}>Cancel</Button>
                <Button
                  className="h-11 bg-brand text-brand-foreground hover:bg-brand/90"
                  onClick={handleRegister}
                  disabled={!regName.trim() || registering}
                >
                  {registering ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Register Device
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Revocation Confirmation */}
      <AlertDialog open={!!revokeAgent} onOpenChange={(open) => !open && setRevokeAgent(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke device "{revokeAgent?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately invalidate the device token. The device will lose access to all
              print jobs. Any queued jobs will be returned to the queue for other devices.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-danger text-danger-foreground hover:bg-danger/90"
              onClick={handleRevoke}
              disabled={revoking}
            >
              {revoking ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Revoke Device
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DeviceCard({ agent, onRevoke }: { agent: Agent; onRevoke: () => void }) {
  const agentIdShort = agent.id.slice(0, 8);
  const lastSeen = agent.lastSeenAt ? timeAgo(agent.lastSeenAt) : 'Never';

  return (
    <Card className={cn('transition-colors', agent.isOnline ? 'border-success/30' : 'border-border')}>
      <CardContent className="flex items-start gap-4 p-4">
        {/* Status icon */}
        <div className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          agent.isOnline ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground',
        )}>
          {agent.isOnline ? <Wifi className="size-5" /> : <WifiOff className="size-5" />}
        </div>

        {/* Device info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate font-medium text-foreground">{agent.name}</h4>
            <Badge variant="outline" className={cn(
              'shrink-0',
              agent.isOnline
                ? 'border-success/30 bg-success-soft text-success'
                : 'border-border bg-muted text-muted-foreground',
            )}>
              {agent.isOnline ? 'Online' : 'Offline'}
            </Badge>
          </div>

          <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <dt className="inline">ID:</dt>
            <dd className="inline font-mono">{agentIdShort}</dd>

            {agent.printerName && (
              <>
                <dt className="inline">Printer:</dt>
                <dd className="inline truncate">{agent.printerName}</dd>
              </>
            )}

            {agent.version && (
              <>
                <dt className="inline">Version:</dt>
                <dd className="inline">{agent.version}</dd>
              </>
            )}

            {agent.os && (
              <>
                <dt className="inline">OS:</dt>
                <dd className="inline">{agent.os}</dd>
              </>
            )}

            <dt className="inline">Last seen:</dt>
            <dd className="inline">{lastSeen}</dd>
          </dl>
        </div>

        {/* Revoke button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-danger"
          onClick={onRevoke}
          aria-label={`Revoke device ${agent.name}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
