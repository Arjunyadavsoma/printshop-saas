'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import { PageHeader } from '@/components/shared/page-header';
import { EmptyState } from '@/components/shared/empty-state';
import { CardSkeleton } from '@/components/shared/loading-skeleton';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { cn, timeAgo } from '@/lib/utils';
import {
  Plus,
  RefreshCw,
  Monitor,
  Wifi,
  WifiOff,
  Copy,
  Check,
  ChevronDown,
  Pencil,
  Trash2,
  Send,
  Power,
  AlertTriangle,
  Loader2,
  Clock,
  Printer,
  Cpu,
  TerminalSquare,
  History,
} from 'lucide-react';

/**
 * Shopkeeper device management page.
 *
 * Lists the PrintEXE companion devices (Windows PCs that connect to the cloud
 * and execute print jobs) registered for the current shop, plus the pairing
 * flow that mints a single-use ticket a companion exchanges for a long-lived
 * device token.
 *
 * The shopkeeper can: pair a new PC, rename a device, pause/resume a device
 * (the isEnabled flag), send remote commands (refresh_printers, pause,
 * resume, test_print, diagnostics), and revoke a lost/stolen device.
 *
 * The device list auto-polls every 15 seconds while the tab is visible so the
 * online/offline indicators stay fresh without manual refresh.
 */

/** A companion device row as returned by GET /api/v1/shops/me/devices. */
interface Device {
  id: string;
  name: string;
  isOnline: boolean;
  isEnabled: boolean;
  lastSeenAt: string | null;
  printerName: string | null;
  version: string | null;
  os: string | null;
  createdAt: string;
}

/** Pairing ticket returned by POST /api/v1/companion/pairing/begin. */
interface PairingTicket {
  ticket: string;
  pairingUrl: string;
  expiresAt: string;
  shopId: string;
}

/** A command the shopkeeper can send to a companion. */
interface CommandOption {
  type: string;
  label: string;
  description: string;
  /** Lucide icon node rendered before the label. */
  icon: React.ReactNode;
}

const COMMAND_OPTIONS: CommandOption[] = [
  {
    type: 'refresh_printers',
    label: 'Refresh printers',
    description: 'Ask the companion to re-scan the local printer list.',
    icon: <RefreshCw className="size-4" aria-hidden="true" />,
  },
  {
    type: 'pause',
    label: 'Pause',
    description: 'Stop accepting new print jobs until resumed.',
    icon: <Power className="size-4" aria-hidden="true" />,
  },
  {
    type: 'resume',
    label: 'Resume',
    description: 'Lift a previously-issued pause and resume printing.',
    icon: <Power className="size-4" aria-hidden="true" />,
  },
  {
    type: 'test_print',
    label: 'Test print',
    description: 'Send a one-page test print to the default printer.',
    icon: <Printer className="size-4" aria-hidden="true" />,
  },
  {
    type: 'diagnostics',
    label: 'Run diagnostics',
    description: 'Collect health info from the companion (printer, spooler, OS).',
    icon: <TerminalSquare className="size-4" aria-hidden="true" />,
  },
];

/** Pairing ticket lifetime is 5 minutes server-side; mirror it client-side. */
const PAIRING_TTL_MS = 5 * 60 * 1000;
/** Auto-refresh the device list every 15 seconds while the tab is visible. */
const POLL_INTERVAL_MS = 15_000;

export default function ShopDevicesPage() {
  const api = useApiClient();

  // ── Device list state ────────────────────────────────────────────────
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Pairing dialog state ─────────────────────────────────────────────
  const [pairingOpen, setPairingOpen] = useState(false);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingTicket, setPairingTicket] = useState<PairingTicket | null>(null);
  const [pairingCopied, setPairingCopied] = useState<'url' | 'ticket' | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(Math.floor(PAIRING_TTL_MS / 1000));

  // ── Per-device action state ──────────────────────────────────────────
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Device | null>(null);
  const [revoking, setRevoking] = useState(false);
  /** Tracks the device currently being toggled enabled/disabled. */
  const [togglingId, setTogglingId] = useState<string | null>(null);
  /** Tracks the device + commandType currently being dispatched. */
  const [sendingCommand, setSendingCommand] = useState<string | null>(null);

  // Document title — kept in sync so browser tabs reflect the page.
  useEffect(() => {
    document.title = 'Devices & Printers · Printelyx';
  }, []);

  // ── Load device list ─────────────────────────────────────────────────
  const load = useCallback(
    async (silent = false) => {
      if (!api.ready) return;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const r = await api.request<{
          data?: { devices?: Device[] };
          error?: { message?: string };
        }>('GET', '/api/v1/shops/me/devices');
        if (r.status === 200 && r.data?.data) {
          setDevices(r.data.data.devices ?? []);
        } else if (r.status === 401) {
          setError('Session expired. Please log in again.');
        } else {
          setError(r.data?.error?.message ?? 'Could not load devices.');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error.');
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [api],
  );

  // Initial load + reset whenever the auth context (api) changes.
  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh the list every 15s — only while the tab is visible so we
  // don't burn cycles in the background. Re-arms on focus to surface the
  // latest state the moment the shopkeeper returns.
  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void load(true);
      }
    };
    const id = setInterval(tick, POLL_INTERVAL_MS);
    const onFocus = () => void load(true);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  // ── Pairing: mint a ticket + run a countdown ─────────────────────────
  const beginPairing = useCallback(async () => {
    setPairingLoading(true);
    setPairingTicket(null);
    setPairingCopied(null);
    setSecondsLeft(Math.floor(PAIRING_TTL_MS / 1000));
    try {
      const r = await api.request<{
        data?: PairingTicket;
        error?: { message?: string };
      }>('POST', '/api/v1/companion/pairing/begin');
      if (r.status === 200 && r.data?.data) {
        setPairingTicket(r.data.data);
        // Rebase the countdown to the server's expiry so we're accurate even
        // if the network was slow.
        const msLeft = new Date(r.data.data.expiresAt).getTime() - Date.now();
        setSecondsLeft(Math.max(0, Math.floor(msLeft / 1000)));
      } else if (r.status === 401) {
        toast.error('Session expired', { description: 'Please log in again.' });
      } else {
        toast.error('Could not generate pairing link', {
          description: r.data?.error?.message ?? 'Unexpected error.',
        });
      }
    } catch (err) {
      toast.error('Could not generate pairing link', {
        description: err instanceof Error ? err.message : 'Network error.',
      });
    } finally {
      setPairingLoading(false);
    }
  }, [api]);

  // Whenever the pairing dialog opens, mint a fresh ticket. Each ticket is
  // single-use and 5-minute-lived, so re-opening always issues a new one.
  useEffect(() => {
    if (pairingOpen && api.ready) {
      void beginPairing();
    }
    if (!pairingOpen) {
      // Reset state on close so a re-open starts clean.
      setPairingTicket(null);
      setPairingCopied(null);
      setSecondsLeft(Math.floor(PAIRING_TTL_MS / 1000));
    }
  }, [pairingOpen, api.ready, beginPairing]);

  // Countdown timer — runs only while a ticket is shown.
  useEffect(() => {
    if (!pairingOpen || !pairingTicket) return;
    if (secondsLeft <= 0) return;
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [pairingOpen, pairingTicket, secondsLeft]);

  const copyToClipboard = useCallback(
    async (which: 'url' | 'ticket'): Promise<void> => {
      if (!pairingTicket) return;
      const text = which === 'url' ? pairingTicket.pairingUrl : pairingTicket.ticket;
      try {
        await navigator.clipboard.writeText(text);
        setPairingCopied(which);
        toast.success(which === 'url' ? 'Pairing link copied' : 'Ticket code copied', {
          description: 'Paste it into PrintEXE on your Windows PC.',
        });
        setTimeout(() => setPairingCopied(null), 2000);
      } catch {
        // Clipboard may be unavailable (insecure context / iframe) — fall
        // back to a prompt so the shopkeeper can still copy manually.
        window.prompt(
          which === 'url' ? 'Copy this pairing link:' : 'Copy this ticket code:',
          text,
        );
      }
    },
    [pairingTicket],
  );

  // ── Per-device actions ───────────────────────────────────────────────
  const sendCommand = useCallback(
    async (device: Device, commandType: string) => {
      setSendingCommand(commandType + ':' + device.id);
      try {
        const r = await api.request<{
          data?: { commandId?: string; status?: string; idempotentReplay?: boolean };
          error?: { message?: string };
        }>(
          'POST',
          `/api/v1/shops/me/devices/${device.id}/commands`,
          { body: { commandType } },
        );
        if (r.status >= 200 && r.status < 300 && r.data?.data) {
          const replayed = r.data.data.idempotentReplay;
          toast.success('Command queued', {
            description: replayed
              ? `"${commandType}" was already queued — no duplicate sent.`
              : `"${commandType}" sent to ${device.name}. The companion will pick it up on its next poll.`,
          });
        } else if (r.status === 401) {
          toast.error('Session expired', { description: 'Please log in again.' });
        } else {
          toast.error('Could not send command', {
            description: r.data?.error?.message ?? 'Unexpected error.',
          });
        }
      } catch (err) {
        toast.error('Could not send command', {
          description: err instanceof Error ? err.message : 'Network error.',
        });
      } finally {
        setSendingCommand(null);
      }
    },
    [api],
  );

  const toggleEnabled = useCallback(
    async (device: Device) => {
      setTogglingId(device.id);
      const next = !device.isEnabled;
      try {
        const r = await api.request<{
          data?: { id?: string; isEnabled?: boolean };
          error?: { message?: string };
        }>('PATCH', `/api/v1/shops/me/devices/${device.id}`, {
          body: { isEnabled: next },
        });
        if (r.status >= 200 && r.status < 300) {
          toast.success(next ? 'Device enabled' : 'Device paused', {
            description: `${device.name} is now ${next ? 'enabled' : 'disabled'}.`,
          });
          // Optimistic refresh so the badge flips immediately.
          setDevices((prev) =>
            prev.map((d) => (d.id === device.id ? { ...d, isEnabled: next } : d)),
          );
        } else if (r.status === 401) {
          toast.error('Session expired', { description: 'Please log in again.' });
        } else {
          toast.error('Could not update device', {
            description: r.data?.error?.message ?? 'Unexpected error.',
          });
        }
      } catch (err) {
        toast.error('Could not update device', {
          description: err instanceof Error ? err.message : 'Network error.',
        });
      } finally {
        setTogglingId(null);
      }
    },
    [api],
  );

  const saveRename = useCallback(
    async (device: Device, nextName: string): Promise<boolean> => {
      const trimmed = nextName.trim();
      if (!trimmed) {
        toast.error('Name cannot be empty');
        return false;
      }
      if (trimmed === device.name) {
        // Nothing to save — just close the editor.
        return true;
      }
      try {
        const r = await api.request<{
          data?: { id?: string; name?: string };
          error?: { message?: string };
        }>('PATCH', `/api/v1/shops/me/devices/${device.id}`, {
          body: { name: trimmed },
        });
        if (r.status >= 200 && r.status < 300) {
          toast.success('Device renamed', {
            description: `Now listed as "${trimmed}".`,
          });
          setDevices((prev) =>
            prev.map((d) => (d.id === device.id ? { ...d, name: trimmed } : d)),
          );
          return true;
        }
        toast.error('Could not rename device', {
          description: r.data?.error?.message ?? 'Unexpected error.',
        });
        return false;
      } catch (err) {
        toast.error('Could not rename device', {
          description: err instanceof Error ? err.message : 'Network error.',
        });
        return false;
      }
    },
    [api],
  );

  const confirmRevoke = useCallback(async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const r = await api.request<{
        data?: { cancelledJobs?: number; message?: string };
        error?: { message?: string };
      }>('DELETE', `/api/v1/shops/me/devices/${revokeTarget.id}`);
      if (r.status >= 200 && r.status < 300) {
        const cancelled = r.data?.data?.cancelledJobs ?? 0;
        toast.success('Device revoked', {
          description:
            cancelled > 0
              ? `${revokeTarget.name} revoked. ${cancelled} queued job(s) returned to the queue.`
              : `${revokeTarget.name} revoked. Its token is no longer valid.`,
        });
        setDevices((prev) => prev.filter((d) => d.id !== revokeTarget.id));
        setRevokeTarget(null);
      } else if (r.status === 401) {
        toast.error('Session expired', { description: 'Please log in again.' });
      } else {
        toast.error('Could not revoke device', {
          description: r.data?.error?.message ?? 'Unexpected error.',
        });
      }
    } catch (err) {
      toast.error('Could not revoke device', {
        description: err instanceof Error ? err.message : 'Network error.',
      });
    } finally {
      setRevoking(false);
    }
  }, [api, revokeTarget]);

  // ── Derived display values ───────────────────────────────────────────
  const onlineCount = useMemo(
    () => devices.filter((d) => d.isOnline && d.isEnabled).length,
    [devices],
  );
  const offlineCount = devices.length - onlineCount;
  const enabledCount = devices.filter((d) => d.isEnabled).length;
  const disabledCount = devices.length - enabledCount;

  // ── Render: initial loading ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Devices & Printers"
          description="Manage connected PrintEXE companion PCs"
        />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    );
  }

  // ── Render: hard error (no devices loaded) ───────────────────────────
  if (error && devices.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Devices & Printers"
          description="Manage connected PrintEXE companion PCs"
        />
        <Card className="border-danger/30 bg-danger-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-danger">
              <AlertTriangle className="size-4" aria-hidden="true" />
              Couldn&apos;t load devices
            </CardTitle>
            <CardDescription className="text-danger">{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => void load()}
              variant="outline"
              size="sm"
              className="min-h-[44px] gap-1.5"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Devices & Printers"
        description="Manage connected PrintEXE companion PCs"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="min-h-[44px] gap-1.5"
              aria-label="Refresh device list"
            >
              {refreshing ? (
                <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button
              size="sm"
              onClick={() => setPairingOpen(true)}
              className="min-h-[44px] gap-1.5"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add Computer
            </Button>
          </>
        }
      />

      {/* Soft error banner — list still shows if we have stale devices. */}
      {error && devices.length > 0 && (
        <Card className="border-warning/30 bg-warning-soft">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-warning-foreground">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="min-h-[44px] gap-1.5"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Summary row — only when there's at least one device. */}
      {devices.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile
            label="Total devices"
            value={devices.length}
            icon={<Monitor className="size-4" aria-hidden="true" />}
          />
          <StatTile
            label="Online"
            value={onlineCount}
            tone="success"
            icon={<Wifi className="size-4" aria-hidden="true" />}
          />
          <StatTile
            label="Offline"
            value={offlineCount}
            tone="muted"
            icon={<WifiOff className="size-4" aria-hidden="true" />}
          />
          <StatTile
            label="Paused"
            value={disabledCount}
            tone="warning"
            icon={<Power className="size-4" aria-hidden="true" />}
          />
        </div>
      )}

      {/* Empty state — no devices paired yet. */}
      {devices.length === 0 ? (
        <Card className="bg-surface">
          <CardContent className="p-0">
            <EmptyState
              className="px-4 py-12"
              icon={<Monitor className="size-6" aria-hidden="true" />}
              title="No devices connected"
              description="Click 'Add Computer' to pair your first PrintEXE PC. Once paired, it will appear here and start receiving print jobs."
              action={
                <Button
                  size="sm"
                  onClick={() => setPairingOpen(true)}
                  className="min-h-[44px] gap-1.5"
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add Computer
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              api={api}
              renameOpen={renameTargetId === device.id}
              onRenameStart={() => setRenameTargetId(device.id)}
              onRenameCancel={() => setRenameTargetId(null)}
              onRenameSave={(nextName) =>
                void saveRename(device, nextName).then((ok) => {
                  if (ok) setRenameTargetId(null);
                })
              }
              onToggleEnabled={() => void toggleEnabled(device)}
              onSendCommand={(commandType) => void sendCommand(device, commandType)}
              onRevoke={() => setRevokeTarget(device)}
              isToggling={togglingId === device.id}
              sendingCommandKey={sendingCommand}
            />
          ))}
        </div>
      )}

      {/* Pairing dialog */}
      <PairingDialog
        open={pairingOpen}
        onOpenChange={setPairingOpen}
        loading={pairingLoading}
        ticket={pairingTicket}
        secondsLeft={secondsLeft}
        copiedField={pairingCopied}
        onCopy={(which) => void copyToClipboard(which)}
        onRegenerate={() => void beginPairing()}
      />

      {/* Revoke confirmation */}
      <AlertDialog
        open={!!revokeTarget}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke {revokeTarget ? `"${revokeTarget.name}"` : 'this device'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the device and invalidates its token.
              It will lose access to all print jobs immediately. Any queued
              jobs assigned to it are returned to the queue so another device
              can claim them. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]" disabled={revoking}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px] bg-danger text-danger-foreground hover:bg-danger/90"
              onClick={(e) => {
                e.preventDefault();
                void confirmRevoke();
              }}
              disabled={revoking}
            >
              {revoking ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Revoke device
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ── Stat tile (top of page) ───────────────────────────────────────────── */

function StatTile({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'muted';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning-foreground'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : 'text-foreground';
  return (
    <Card className="bg-surface">
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground',
            tone === 'success' && 'bg-success-soft text-success',
            tone === 'warning' && 'bg-warning-soft text-warning-foreground',
          )}
          aria-hidden="true"
        >
          {icon}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className={cn('text-xl font-semibold tabular-nums', toneClass)}>
            {value}
          </span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Device card ───────────────────────────────────────────────────────── */

interface DeviceCardProps {
  device: Device;
  api: ReturnType<typeof useApiClient>;
  renameOpen: boolean;
  onRenameStart: () => void;
  onRenameCancel: () => void;
  onRenameSave: (nextName: string) => void;
  onToggleEnabled: () => void;
  onSendCommand: (commandType: string) => void;
  onRevoke: () => void;
  isToggling: boolean;
  /** Format: `${commandType}:${deviceId}` — used to show a spinner on the
   *  dropdown trigger while a specific command is being dispatched. */
  sendingCommandKey: string | null;
}

/* ── Command history panel (plan M1 / gap G1) ────────────────────────────
 * The shopkeeper sends a command but could never see whether it executed.
 * The backend already persists the lifecycle (requested → delivered →
 * executing → succeeded/failed/expired) with a JSON result on
 * GET /shops/me/devices/{id}; this panel surfaces it: status pills, human
 * result messages, and a 10 s refresh while expanded (visibility-guarded,
 * same pattern as the device list poll). */

interface DeviceCommandView {
  id: string;
  commandType: string;
  status: string;
  payload: unknown;
  result: unknown;
  initiatedBy: string;
  createdAt: string;
  deliveredAt: string | null;
  executedAt: string | null;
}

const COMMAND_STATUS_META: Record<string, { label: string; cls: string }> = {
  requested: { label: 'Requested', cls: 'bg-muted text-muted-foreground border-border' },
  delivered: { label: 'Delivered', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
  accepted: { label: 'Accepted', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
  executing: { label: 'Executing', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  succeeded: { label: 'Succeeded', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  failed: { label: 'Failed', cls: 'bg-rose-100 text-rose-800 border-rose-300' },
  expired: { label: 'Expired', cls: 'bg-zinc-100 text-zinc-600 border-zinc-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-zinc-100 text-zinc-600 border-zinc-300' },
};

function CommandStatusBadge({ status }: { status: string }) {
  const v = COMMAND_STATUS_META[status] ?? { label: status, cls: 'bg-zinc-100 text-zinc-700 border-zinc-300' };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${v.cls}`}>
      {v.label}
    </span>
  );
}

/** Human message out of the agent's JSON result: prefer explicit message
 *  fields, else compact JSON, else the raw string. */
function commandResultText(result: unknown): string | null {
  if (result == null) return null;
  if (typeof result === 'string') {
    try {
      const parsed: unknown = JSON.parse(result);
      if (parsed && typeof parsed === 'object') return commandResultText(parsed);
      return (result as string).trim() || null;
    } catch {
      return (result as string).trim() || null;
    }
  }
  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    for (const key of ['message', 'reason', 'error', 'detail', 'status']) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    try {
      const json = JSON.stringify(obj);
      return json.length > 140 ? json.slice(0, 137) + '…' : json;
    } catch {
      return null;
    }
  }
  return String(result);
}

const COMMAND_TYPE_LABELS: Record<string, string> = {
  refresh_printers: 'Refresh printers',
  pause: 'Pause queue',
  resume: 'Resume queue',
  cancel_job: 'Cancel job',
  retry_job: 'Reprint job',
  test_print: 'Test print',
  diagnostics: 'Diagnostics',
};

function CommandsPanel({ api, deviceId }: { api: ReturnType<typeof useApiClient>; deviceId: string }) {
  const [commands, setCommands] = useState<DeviceCommandView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCommands = useCallback(async () => {
    try {
      const r = await api.request<{
        data?: { commands?: DeviceCommandView[] };
        error?: { message?: string };
      }>('GET', `/api/v1/shops/me/devices/${deviceId}`);
      if (r.status === 200 && r.data?.data) {
        setCommands(r.data.data.commands ?? []);
        setError(null);
      } else {
        setError(r.data?.error?.message ?? 'Could not load command history.');
      }
    } catch {
      setError('Could not load command history.');
    }
  }, [api, deviceId]);

  // Load on mount + refresh every 10 s while the tab is visible.
  useEffect(() => {
    void loadCommands();
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void loadCommands();
      }
    }, 10_000);
    return () => clearInterval(id);
  }, [loadCommands]);

  if (error && commands === null) {
    return <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{error}</p>;
  }
  if (commands === null) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">Loading command history…</p>;
  }
  if (commands.length === 0) {
    return (
      <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        No commands sent to this device yet. Use the Command button above — every
        command&apos;s outcome will appear here.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5" aria-label="Recent commands">
      {commands.map((c) => {
        const resultText = commandResultText(c.result);
        return (
          <li key={c.id} className="rounded-md border bg-background px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className="text-xs font-medium text-foreground">
                {COMMAND_TYPE_LABELS[c.commandType] ?? c.commandType}
              </span>
              <CommandStatusBadge status={c.status} />
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              issued {timeAgo(c.createdAt)}
              {c.executedAt ? ` · executed ${timeAgo(c.executedAt)}` : ''}
            </div>
            {resultText && (
              <p
                className={`mt-1 text-[11px] ${
                  c.status === 'failed' ? 'text-rose-700' : c.status === 'succeeded' ? 'text-emerald-700' : 'text-muted-foreground'
                }`}
              >
                {resultText}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DeviceCard({
  device,
  api,
  renameOpen,
  onRenameStart,
  onRenameCancel,
  onRenameSave,
  onToggleEnabled,
  onSendCommand,
  onRevoke,
  isToggling,
  sendingCommandKey,
}: DeviceCardProps) {
  // Local draft for the inline rename input. Initialised from the device
  // name when the editor opens; reset when it closes.
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [draftName, setDraftName] = useState(device.name);
  useEffect(() => {
    if (renameOpen) {
      setDraftName(device.name);
      // Focus + select on the next tick so the input is mounted.
      const id = window.setTimeout(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [renameOpen, device.name]);

  const lastSeen = device.lastSeenAt ? timeAgo(device.lastSeenAt) : 'Never';
  const isBusy = isToggling;
  const activeCommandKey = sendingCommandKey;
  const commandDropdownBusy =
    activeCommandKey != null && activeCommandKey.endsWith(':' + device.id);

  // Recent-commands panel visibility (plan M1).
  const [showCommands, setShowCommands] = useState(false);

  return (
    <Card
      className={cn(
        'flex flex-col bg-surface',
        device.isOnline ? 'border-success/30' : 'border-border',
        !device.isEnabled && 'opacity-80',
      )}
    >
      <CardHeader className="gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-1">
            {/* Online indicator dot + name */}
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'inline-block size-2.5 shrink-0 rounded-full',
                  device.isOnline
                    ? 'bg-success'
                    : 'bg-muted-foreground/40',
                )}
                role="img"
                aria-label={device.isOnline ? 'Online' : 'Offline'}
              />
              {renameOpen ? (
                <Input
                  ref={renameInputRef}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onRenameSave(draftName);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      onRenameCancel();
                    }
                  }}
                  className="h-9 min-h-[44px] flex-1"
                  aria-label="Device name"
                  maxLength={120}
                />
              ) : (
                <CardTitle className="truncate text-base font-semibold text-foreground">
                  {device.name}
                </CardTitle>
              )}
            </div>
            {/* Status badges row */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant="outline"
                className={cn(
                  'gap-1.5',
                  device.isOnline
                    ? 'border-success/30 bg-success-soft text-success'
                    : 'border-border bg-muted text-muted-foreground',
                )}
              >
                <Wifi className="size-3" aria-hidden="true" />
                {device.isOnline ? 'Online' : 'Offline'}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'gap-1.5',
                  device.isEnabled
                    ? 'border-success/30 bg-success-soft text-success'
                    : 'border-warning/30 bg-warning-soft text-warning-foreground',
                )}
              >
                <Power className="size-3" aria-hidden="true" />
                {device.isEnabled ? 'Enabled' : 'Paused'}
              </Badge>
            </div>
          </div>

          {/* Online status glyph (top-right) */}
          <div
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-md',
              device.isOnline
                ? 'bg-success-soft text-success'
                : 'bg-muted text-muted-foreground',
            )}
            aria-hidden="true"
          >
            {device.isOnline ? (
              <Wifi className="size-4" />
            ) : (
              <WifiOff className="size-4" />
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-0">
        {/* Device metadata grid */}
        <dl className="grid grid-cols-1 gap-2 text-xs">
          <MetaRow icon={<Clock className="size-3.5" aria-hidden="true" />} label="Last seen">
            {lastSeen}
          </MetaRow>
          <MetaRow icon={<Printer className="size-3.5" aria-hidden="true" />} label="Printer">
            {device.printerName ?? 'Not reported'}
          </MetaRow>
          <MetaRow icon={<Cpu className="size-3.5" aria-hidden="true" />} label="Version">
            {device.version ?? '—'}
          </MetaRow>
          <MetaRow icon={<Monitor className="size-3.5" aria-hidden="true" />} label="OS">
            {device.os ?? '—'}
          </MetaRow>
        </dl>

        <Separator />

        {/* Action row — touches all min-h-[44px] */}
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {renameOpen ? (
            <>
              <Button
                size="sm"
                onClick={() => onRenameSave(draftName)}
                disabled={isBusy || draftName.trim().length === 0}
                className="min-h-[44px] gap-1.5"
              >
                <Check className="size-4" aria-hidden="true" />
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onRenameCancel}
                disabled={isBusy}
                className="min-h-[44px] gap-1.5"
              >
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onRenameStart}
                disabled={isBusy}
                className="min-h-[44px] gap-1.5"
                aria-label={`Rename ${device.name}`}
              >
                <Pencil className="size-4" aria-hidden="true" />
                Rename
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={onToggleEnabled}
                disabled={isBusy}
                className="min-h-[44px] gap-1.5"
                aria-label={
                  device.isEnabled ? `Pause ${device.name}` : `Enable ${device.name}`
                }
              >
                {isToggling ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Power className="size-4" aria-hidden="true" />
                )}
                {device.isEnabled ? 'Pause' : 'Enable'}
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!device.isEnabled || commandDropdownBusy}
                    className="min-h-[44px] gap-1.5"
                    aria-label={`Send command to ${device.name}`}
                  >
                    {commandDropdownBusy ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="size-4" aria-hidden="true" />
                    )}
                    <span>Command</span>
                    <ChevronDown className="size-3.5" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Send remote command
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {COMMAND_OPTIONS.map((opt) => (
                    <DropdownMenuItem
                      key={opt.type}
                      onSelect={() => onSendCommand(opt.type)}
                      className="min-h-[44px] flex-col items-start gap-0.5 py-2"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        {opt.icon}
                        {opt.label}
                      </span>
                      <span className="pl-6 text-xs text-muted-foreground">
                        {opt.description}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                size="sm"
                variant="ghost"
                onClick={onRevoke}
                disabled={isBusy}
                className="min-h-[44px] gap-1.5 text-danger hover:bg-danger/10 hover:text-danger"
                aria-label={`Revoke ${device.name}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Revoke
              </Button>
            </>
          )}
        </div>

        {!device.isEnabled && (
          <p className="text-xs text-warning-foreground">
            This device is paused — it will not accept new commands or print jobs
            until re-enabled.
          </p>
        )}

        {/* Recent commands (plan M1): expandable panel showing the command
            lifecycle and results, so remote actions have visible feedback. */}
        <Separator />
        <div>
          <button
            type="button"
            onClick={() => setShowCommands((v) => !v)}
            aria-expanded={showCommands}
            className="flex min-h-[44px] w-full items-center justify-between rounded-md px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <span className="flex items-center gap-1.5">
              <History className="size-3.5" aria-hidden="true" />
              Recent commands
            </span>
            <ChevronDown
              className={`size-3.5 transition-transform ${showCommands ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
          {showCommands && (
            <div className="mt-2">
              <CommandsPanel api={api} deviceId={device.id} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Metadata row (label: value) ───────────────────────────────────────── */

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
        aria-hidden="true"
      >
        {icon}
      </span>
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 truncate font-medium text-foreground">
        {children}
      </dd>
    </div>
  );
}

/* ── Pairing dialog ────────────────────────────────────────────────────── */

interface PairingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  ticket: PairingTicket | null;
  secondsLeft: number;
  copiedField: 'url' | 'ticket' | null;
  onCopy: (which: 'url' | 'ticket') => void;
  onRegenerate: () => void;
}

function PairingDialog({
  open,
  onOpenChange,
  loading,
  ticket,
  secondsLeft,
  copiedField,
  onCopy,
  onRegenerate,
}: PairingDialogProps) {
  const expired = secondsLeft <= 0;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const countdownLabel = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="size-5 text-brand" aria-hidden="true" />
            Pair a PrintEXE PC
          </DialogTitle>
          <DialogDescription>
            Install PrintEXE on your Windows PC, then open this link or enter the
            ticket code. The link and code expire in 5 minutes.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Generating a pairing ticket…
            </p>
          </div>
        ) : !ticket ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <AlertTriangle className="size-6 text-warning-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              No pairing ticket available.
            </p>
            <Button
              size="sm"
              onClick={onRegenerate}
              className="min-h-[44px] gap-1.5"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Generate
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Countdown banner */}
            <div
              className={cn(
                'flex items-center gap-2 rounded-md border px-3 py-2 text-xs',
                expired
                  ? 'border-danger/30 bg-danger-soft text-danger'
                  : 'border-brand/30 bg-brand-soft text-brand',
              )}
              role="status"
              aria-live="polite"
            >
              <Clock className="size-4" aria-hidden="true" />
              {expired ? (
                <span>This pairing link has expired. Generate a new one.</span>
              ) : (
                <span>
                  Link expires in{' '}
                  <strong className="tabular-nums">{countdownLabel}</strong>
                </span>
              )}
            </div>

            {/* Pairing URL */}
            <div className="space-y-2">
              <Label htmlFor="pairing-url" className="text-xs font-medium">
                Pairing link
              </Label>
              <div className="flex gap-2">
                <Input
                  id="pairing-url"
                  readOnly
                  value={ticket.pairingUrl}
                  className="min-h-[44px] flex-1 font-mono text-xs"
                  aria-describedby="pairing-url-help"
                  onClick={(e) =>
                    (e.currentTarget as HTMLInputElement).select()
                  }
                />
                <Button
                  variant="outline"
                  onClick={() => onCopy('url')}
                  className="min-h-[44px] shrink-0 gap-1.5"
                  aria-label="Copy pairing link"
                >
                  {copiedField === 'url' ? (
                    <Check className="size-4 text-success" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">
                    {copiedField === 'url' ? 'Copied' : 'Copy'}
                  </span>
                </Button>
              </div>
              <p id="pairing-url-help" className="text-xs text-muted-foreground">
                Open this URL on the PC you want to pair, or click Copy and paste
                it into PrintEXE.
              </p>
            </div>

            {/* Ticket code */}
            <div className="space-y-2">
              <Label htmlFor="pairing-ticket" className="text-xs font-medium">
                Ticket code
              </Label>
              <div className="flex gap-2">
                <Input
                  id="pairing-ticket"
                  readOnly
                  value={ticket.ticket}
                  className="min-h-[44px] flex-1 font-mono text-xs"
                  aria-describedby="pairing-ticket-help"
                  onClick={(e) =>
                    (e.currentTarget as HTMLInputElement).select()
                  }
                />
                <Button
                  variant="outline"
                  onClick={() => onCopy('ticket')}
                  className="min-h-[44px] shrink-0 gap-1.5"
                  aria-label="Copy ticket code"
                >
                  {copiedField === 'ticket' ? (
                    <Check className="size-4 text-success" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                  <span className="hidden sm:inline">
                    {copiedField === 'ticket' ? 'Copied' : 'Copy'}
                  </span>
                </Button>
              </div>
              <p id="pairing-ticket-help" className="text-xs text-muted-foreground">
                If the link does not auto-open PrintEXE, paste this code into the
                companion&apos;s pairing screen.
              </p>
            </div>

            {/* Instructions */}
            <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Setup steps</p>
              <ol className="mt-1 list-decimal space-y-1 pl-4">
                <li>Install PrintEXE on your Windows PC (if you haven&apos;t).</li>
                <li>
                  Open the pairing link above, or launch PrintEXE and paste the
                  ticket code.
                </li>
                <li>Approve the pairing prompt on the PC.</li>
                <li>
                  The PC appears here within a few seconds and starts receiving
                  print jobs.
                </li>
              </ol>
            </div>

            {expired && (
              <Button
                variant="outline"
                onClick={onRegenerate}
                className="min-h-[44px] w-full gap-1.5"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Generate a new link
              </Button>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="min-h-[44px] gap-1.5"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
