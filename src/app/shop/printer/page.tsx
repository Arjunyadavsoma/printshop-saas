'use client';

import { useEffect, useState, useCallback } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CheckCircle2,
  Loader2,
  Printer as PrinterIcon,
  ExternalLink,
  Copy,
  Check,
  AlertCircle,
  RefreshCw,
  FileText,
  Monitor,
  Link2,
  ClipboardCheck,
  TestTube,
  ChevronDown,
} from 'lucide-react';
import {
  checkPrintLatchStatus,
  confirmPrintLatchPairing,
  getPairingCommand,
  PRINTLATCH_DASHBOARD_URL,
  PRINTLATCH_EXE_PATH,
  type PrintLatchConnectionState,
  type PrintLatchStatus,
} from '@/lib/printlatch/client';

export default function PrinterSetupPage() {
  const api = useApiClient();
  const [connState, setConnState] = useState<PrintLatchConnectionState>('not-configured');
  const [agentStatus, setAgentStatus] = useState<PrintLatchStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Pairing state
  const [pairingCode, setPairingCode] = useState('');
  const [pairingConfirming, setPairingConfirming] = useState(false);
  const [pairingResult, setPairingResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Test print state
  const [testPrintState, setTestPrintState] = useState<'idle' | 'submitting' | 'polling' | 'completed' | 'failed' | 'unknown'>('idle');
  const [testPrintError, setTestPrintError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    setStatusError(null);
    const { state, status, error } = await checkPrintLatchStatus();
    setConnState(state);
    setAgentStatus(status);
    setStatusError(error);
    setChecking(false);
  }, []);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const handleConfirmPairing = async () => {
    if (!pairingCode.trim()) return;
    setPairingConfirming(true);
    setPairingResult(null);
    const result = await confirmPrintLatchPairing(pairingCode.trim());
    setPairingResult(result);
    setPairingConfirming(false);
    if (result.success) {
      setPairingCode('');
      await checkStatus();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const pairingCommand = getPairingCommand();
  const isConnected = connState === 'connected';
  const isDisconnected = connState === 'disconnected';
  const needsPairing = connState === 'pairing-required';

  return (
    <div className="space-y-6">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Printer Setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your Windows printer to PrintShop using PrintLatch. Once connected, you can print customer orders directly from your browser.
        </p>
      </div>

      {/* ── Connection status card ── */}
      <Card className={isConnected ? 'border-emerald-300' : isDisconnected ? 'border-amber-300' : 'border-border'}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <PrinterIcon className="size-5 text-amber-600" />
                PrintLatch Agent
              </CardTitle>
              <CardDescription className="mt-1">
                The local agent that sends print jobs to your Windows printer.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => void checkStatus()} disabled={checking} className="gap-1.5">
              {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {checking ? 'Checking…' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            {isConnected ? (
              <Badge className="gap-1.5 bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="size-3.5" /> Connected
              </Badge>
            ) : isDisconnected ? (
              <Badge variant="outline" className="gap-1.5 border-amber-400 bg-amber-50 text-amber-700">
                <AlertCircle className="size-3.5" /> Not Connected
              </Badge>
            ) : needsPairing ? (
              <Badge variant="outline" className="gap-1.5 border-amber-400 bg-amber-50 text-amber-700">
                <Link2 className="size-3.5" /> Pairing Required
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1.5">
                <Loader2 className="size-3.5 animate-spin" /> Checking…
              </Badge>
            )}
            {agentStatus?.version && (
              <span className="text-xs text-muted-foreground">Agent v{agentStatus.version}</span>
            )}
            {agentStatus?.printers && agentStatus.printers.length > 0 && (
              <span className="text-xs text-muted-foreground">
                {agentStatus.printers.length} printer(s): {agentStatus.printers.join(', ')}
              </span>
            )}
          </div>
          {statusError && (
            <p className="mt-2 text-sm text-destructive">{statusError}</p>
          )}
          {isConnected && (
            <p className="mt-2 text-sm text-emerald-600">
              ✓ Your printer is connected. You can print customer orders from the order detail page.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Step-by-step setup guide (shown when NOT connected) ── */}
      {!isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Setup Guide — 4 Steps</CardTitle>
            <CardDescription>Follow these steps to connect your printer. This only needs to be done once.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Step 1 */}
            <SetupStep
              number={1}
              icon={Monitor}
              title="Start PrintLatch on your computer"
              done={isConnected || needsPairing}
            >
              <p className="text-sm text-muted-foreground">
                Open the PrintLatch dashboard in your browser and confirm it shows{' '}
                <Badge variant="outline" className="gap-1">Agent connected</Badge>:
              </p>
              <a
                href={PRINTLATCH_DASHBOARD_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-amber-700 hover:underline"
              >
                <ExternalLink className="size-3.5" />
                {PRINTLATCH_DASHBOARD_URL}
              </a>
              <p className="mt-2 text-xs text-muted-foreground">
                If PrintLatch isn&apos;t installed, download it from the official source. The agent runs as a local process on your Windows 11 computer — it does NOT need admin privileges or network configuration.
              </p>
            </SetupStep>

            {/* Step 2 */}
            <SetupStep
              number={2}
              icon={Link2}
              title="Run the pairing command"
              done={isConnected}
            >
              <p className="text-sm text-muted-foreground">
                Open <strong>Windows PowerShell</strong> (Start menu → type &quot;PowerShell&quot; → Enter) and run this exact command. It pairs THIS website with your local PrintLatch agent:
              </p>
              <div className="mt-2 flex items-start gap-2">
                <code className="flex-1 block break-all rounded-lg bg-zinc-900 p-3 text-xs text-zinc-100">
                  {pairingCommand}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(pairingCommand)}
                  className="shrink-0 gap-1.5"
                >
                  {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                You should see: <code className="rounded bg-muted px-1.5 py-0.5">Pairing code: PL-XXXX-XXXX-XXXX-XXXX</code>
              </p>
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                <strong>Important:</strong> The <code>--origin</code> URL must match this website&apos;s address exactly. You are currently on:{' '}
                <code className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">
                  {typeof window !== 'undefined' ? window.location.origin : ''}
                </code>
              </div>
            </SetupStep>

            {/* Step 3 */}
            <SetupStep
              number={3}
              icon={ClipboardCheck}
              title="Enter the pairing code"
              done={isConnected}
            >
              <p className="text-sm text-muted-foreground">
                Copy the pairing code from PowerShell (it looks like <code className="rounded bg-muted px-1.5 py-0.5">PL-...</code>) and paste it here:
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  type="text"
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value)}
                  placeholder="PL-XXXX-XXXX-XXXX-XXXX"
                  className="font-mono"
                  disabled={pairingConfirming}
                />
                <Button
                  onClick={() => void handleConfirmPairing()}
                  disabled={pairingConfirming || !pairingCode.trim()}
                  className="gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
                >
                  {pairingConfirming ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {pairingConfirming ? 'Confirming…' : 'Confirm'}
                </Button>
              </div>
              {pairingResult?.success && (
                <p className="mt-2 text-sm text-emerald-600">✓ Pairing confirmed! You can now print.</p>
              )}
              {pairingResult && !pairingResult.success && (
                <p className="mt-2 text-sm text-destructive">✗ {pairingResult.error}</p>
              )}
            </SetupStep>

            {/* Step 4 */}
            <SetupStep
              number={4}
              icon={CheckCircle2}
              title="You're ready to print!"
              done={isConnected}
            >
              <p className="text-sm text-muted-foreground">
                Once the agent shows <Badge variant="outline" className="gap-1"><CheckCircle2 className="size-3" /> Connected</Badge> above, go to any order and click the <strong>Print</strong> button next to a file. The document will be sent directly to your printer.
              </p>
            </SetupStep>
          </CardContent>
        </Card>
      )}

      {/* ── Troubleshooting (collapsible) ── */}
      <Card>
        <CardHeader>
          <button
            onClick={() => {
              const el = document.getElementById('troubleshooting-content');
              el?.classList.toggle('hidden');
            }}
            className="flex w-full items-center justify-between"
          >
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertCircle className="size-4 text-muted-foreground" />
              Troubleshooting
            </CardTitle>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        </CardHeader>
        <CardContent id="troubleshooting-content" className="hidden">
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Agent not reachable:</strong> Ensure PrintLatch is running. Open{' '}
              <a href={PRINTLATCH_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="text-amber-700 underline">{PRINTLATCH_DASHBOARD_URL}</a>{' '}
              and check it shows &quot;Agent connected&quot;.
            </li>
            <li>
              <strong className="text-foreground">Origin mismatch:</strong> The <code className="rounded bg-muted px-1.5 py-0.5">--origin</code> in the pairing command must match this website&apos;s address. You are on{' '}
              <code className="rounded bg-muted px-1.5 py-0.5">{typeof window !== 'undefined' ? window.location.origin : ''}</code>.
            </li>
            <li>
              <strong className="text-foreground">Pairing code expired:</strong> The code expires after a few minutes. Re-run the pairing command and enter the new code.
            </li>
            <li>
              <strong className="text-foreground">PowerShell &quot;command not found&quot;:</strong> Use the full path:{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 break-all">
                &quot;{PRINTLATCH_EXE_PATH}&quot; pair --origin {typeof window !== 'undefined' ? window.location.origin : ''}
              </code>
            </li>
            <li>
              <strong className="text-foreground">Re-pairing after changing domains:</strong> Run the pairing command with the new origin, enter the new code, and click Confirm.
            </li>
            <li>
              <strong className="text-foreground">Agent stops after reboot:</strong> PrintLatch may not auto-start. Open the dashboard to restart it, or add a shortcut to your Startup folder.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* ── Old print-agent system (legacy, kept for reference) ── */}
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
            <Monitor className="size-4" />
            Legacy Print Agent (optional)
          </CardTitle>
          <CardDescription className="text-xs">
            The old socket.io-based print agent daemon. Only needed if you&apos;re running the legacy Node.js agent. For most shops, PrintLatch above is the recommended path.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            If you previously set up a print-agent daemon, you can manage it from the{' '}
            <a href="/shop/settings" className="text-amber-700 underline">Settings</a> page. The PrintLatch integration above is the recommended method for direct browser-to-printer printing.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Helper component for the step-by-step guide ───

function SetupStep({
  number,
  icon: Icon,
  title,
  done,
  children,
}: {
  number: number;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      {/* Step number / icon */}
      <div className="flex flex-col items-center">
        <div
          className={`flex size-10 shrink-0 items-center justify-center rounded-full ${
            done
              ? 'bg-emerald-100 text-emerald-600'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {done ? <CheckCircle2 className="size-5" /> : <Icon className="size-5" />}
        </div>
        {number < 4 && <div className="mt-1 h-full w-px flex-1 bg-border" />}
      </div>
      {/* Step content */}
      <div className="flex-1 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground">STEP {number}</span>
          {done && (
            <Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700">
              <Check className="size-3" /> Done
            </Badge>
          )}
        </div>
        <h3 className="mt-1 text-base font-semibold text-foreground">{title}</h3>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}
