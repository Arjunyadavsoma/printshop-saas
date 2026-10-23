'use client';

import { useEffect, useState, useCallback } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CheckCircle2, Loader2, Printer as PrinterIcon, ExternalLink, Copy, Check,
  AlertCircle, RefreshCw, ChevronDown, Download, Terminal, Monitor, Link2,
  ClipboardCheck, TestTube, Settings2, Zap, Hand, PackagePlus, Trash2,
  Boxes,
} from 'lucide-react';
import {
  checkPrintLatchStatus, confirmPrintLatchPairing, disconnectPrintLatch,
  getPairingCommand, getInstallCommand, getDiagnoseCommand, getDashboardCommand,
  submitPrintLatchJob, getPrintLatchJobStatus,
  PRINTLATCH_DASHBOARD_URL,
  getPrefs, savePrefs, getNextAutoPrinter,
  type PrintLatchConnectionState, type PrintLatchHealth, type PrintLatchPrinter,
  type PrintLatchPrefs, type PrintMode,
} from '@/lib/printlatch/client';

export default function PrinterSetupPage() {
  const api = useApiClient();
  const [connState, setConnState] = useState<PrintLatchConnectionState>('not-configured');
  const [health, setHealth] = useState<PrintLatchHealth | null>(null);
  const [printers, setPrinters] = useState<PrintLatchPrinter[] | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [pairingCode, setPairingCode] = useState('');
  const [pairingConfirming, setPairingConfirming] = useState(false);
  const [pairingResult, setPairingResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<PrintLatchPrefs>({ mode: 'manual', autoPrinterIds: [], lastPrinterIndex: 0 });
  const [testPrintState, setTestPrintState] = useState<'idle' | 'submitting' | 'polling' | 'completed' | 'failed' | 'unknown'>('idle');
  const [testPrintError, setTestPrintError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    setStatusError(null);
    const { state, health, printers, error } = await checkPrintLatchStatus();
    setConnState(state);
    setHealth(health);
    setPrinters(printers);
    setStatusError(error);
    setChecking(false);
  }, []);

  useEffect(() => {
    setPrefs(getPrefs());
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

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const pairingCommand = getPairingCommand();
  const installCommand = getInstallCommand();
  const diagnoseCommand = getDiagnoseCommand();
  const dashboardCommand = getDashboardCommand();
  const isConnected = connState === 'connected';
  const isDisconnected = connState === 'disconnected';
  const needsPairing = connState === 'pairing-required';

  const updatePrefs = (newPrefs: Partial<PrintLatchPrefs>) => {
    const updated = { ...prefs, ...newPrefs };
    setPrefs(updated);
    savePrefs(updated);
  };

  const togglePrinterInAutoList = (printerId: string) => {
    const current = prefs.autoPrinterIds;
    const updated = current.includes(printerId)
      ? current.filter(id => id !== printerId)
      : [...current, printerId];
    updatePrefs({ autoPrinterIds: updated, lastPrinterIndex: 0 });
  };

  // ── Supply tracking (localStorage-only, manual estimates) ──
  // Data model: one row per (paperType × color). The consumption estimate is
  // read from `printshop_print_count` — a global counter incremented by the
  // batch print flow on the orders page (and by other print flows in future).
  // This is a MANUAL estimate, not auto-detected from printer hardware.

  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [restockId, setRestockId] = useState<string | null>(null);
  const [restockAmount, setRestockAmount] = useState('');
  const [newSupply, setNewSupply] = useState<NewSupplyForm>({
    paperType: 'a4',
    color: 'bw',
    startingStock: '',
    lowStockThreshold: '50',
  });
  const [printCount, setPrintCount] = useState(0);

  // Load supplies + print count on mount (and whenever the user navigates here
  // after running a batch print elsewhere).
  useEffect(() => {
    setSupplies(loadSupplies());
    setPrintCount(getPrintCount());
  }, []);

  // Persist supplies whenever they change.
  useEffect(() => {
    saveSupplies(supplies);
  }, [supplies]);

  // Re-read the print count every 5s — covers the case where a batch print is
  // running in another tab/window.
  useEffect(() => {
    const id = setInterval(() => setPrintCount(getPrintCount()), 5000);
    return () => clearInterval(id);
  }, []);

  const addSupply = () => {
    const start = parseInt(newSupply.startingStock, 10);
    const threshold = parseInt(newSupply.lowStockThreshold, 10);
    if (!Number.isFinite(start) || start < 0) return;
    if (!Number.isFinite(threshold) || threshold < 0) return;
    const id = `${newSupply.paperType}-${newSupply.color}`;
    // Replace if the same combination already exists (don't duplicate rows).
    setSupplies((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      return [
        ...filtered,
        { id, paperType: newSupply.paperType, color: newSupply.color, startingStock: start, lowStockThreshold: threshold },
      ];
    });
    setNewSupply({ ...newSupply, startingStock: '' });
  };

  const removeSupply = (id: string) => {
    setSupplies((prev) => prev.filter((s) => s.id !== id));
  };

  const handleRestock = (id: string) => {
    const add = parseInt(restockAmount, 10);
    if (!Number.isFinite(add) || add <= 0) return;
    setSupplies((prev) => prev.map((s) => s.id === id ? { ...s, startingStock: s.startingStock + add } : s));
    setRestockId(null);
    setRestockAmount('');
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Printer Setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your Windows printer to PrintShop using PrintLatch. Once connected, print customer orders directly from your browser.
        </p>
      </div>

      {/* Connection status card */}
      <Card className={isConnected ? 'border-emerald-300' : isDisconnected ? 'border-amber-300' : 'border-border'}>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <PrinterIcon className="size-5 text-amber-600" /> PrintLatch Agent
              </CardTitle>
              <CardDescription className="mt-1">The local agent that sends print jobs to your Windows printer.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {isConnected && (
                <Button variant="ghost" size="sm" onClick={() => { disconnectPrintLatch(); void checkStatus(); }} className="text-xs text-muted-foreground">
                  Disconnect
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => void checkStatus()} disabled={checking} className="gap-1.5 min-h-[44px] sm:self-start">
                {checking ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                {checking ? 'Checking…' : 'Refresh'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            {isConnected ? (
              <Badge className="gap-1.5 bg-emerald-100 text-emerald-700"><CheckCircle2 className="size-3.5" /> Connected</Badge>
            ) : isDisconnected ? (
              <Badge variant="outline" className="gap-1.5 border-amber-400 bg-amber-50 text-amber-700"><AlertCircle className="size-3.5" /> Not Connected</Badge>
            ) : needsPairing ? (
              <Badge variant="outline" className="gap-1.5 border-amber-400 bg-amber-50 text-amber-700"><Link2 className="size-3.5" /> Pairing Required</Badge>
            ) : (
              <Badge variant="outline" className="gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Checking…</Badge>
            )}
            {health?.version && <span className="text-xs text-muted-foreground">Agent v{health.version}</span>}
            {printers && printers.length > 0 && (
              <span className="text-xs text-muted-foreground break-words">{printers.length} printer(s): {printers.map(p => p.name).join(', ')}</span>
            )}
          </div>
          {statusError && <p className="mt-2 break-words text-sm text-destructive">{statusError}</p>}
          {isConnected && (
            <div className="mt-2 flex items-center justify-between">
              <p className="text-sm text-emerald-600">✓ Your printer is connected. Go to any order and click <strong>Print</strong>.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connected: Printer management + mode toggle */}
      {isConnected && printers && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Settings2 className="size-4 text-amber-600" /> Print Mode</CardTitle>
            <CardDescription className="text-xs">Choose how print jobs are routed to your printers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Mode toggle */}
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                {prefs.mode === 'manual' ? <Hand className="size-4 text-amber-600" /> : <Zap className="size-4 text-emerald-600" />}
                <div>
                  <p className="text-sm font-medium text-foreground">{prefs.mode === 'manual' ? 'Manual Mode' : 'Auto Mode'}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {prefs.mode === 'manual'
                      ? 'Choose the printer each time you print.'
                      : 'Files auto-route to selected printers (round-robin).'}
                  </p>
                </div>
              </div>
              <Switch
                checked={prefs.mode === 'auto'}
                onCheckedChange={(checked) => updatePrefs({ mode: checked ? 'auto' : 'manual' })}
              />
            </div>

            {/* Auto mode: select printers */}
            {prefs.mode === 'auto' && (
              <div className="rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">Select printers for auto-routing:</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Files will be sent to these printers one-by-one (round-robin). If a printer is busy, the next file goes to the next printer in the list.</p>
                <div className="mt-2 space-y-2">
                  {printers.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-md border border-border p-2">
                      <div className="flex items-center gap-2">
                        <PrinterIcon className="size-3.5 text-muted-foreground" />
                        <span className="text-sm text-foreground">{p.name}</span>
                        {p.kind === 'capture' && <Badge variant="outline" className="text-[9px]">preview</Badge>}
                      </div>
                      <Switch
                        checked={prefs.autoPrinterIds.includes(p.id)}
                        onCheckedChange={() => togglePrinterInAutoList(p.id)}
                      />
                    </div>
                  ))}
                </div>
                {prefs.autoPrinterIds.length === 0 && (
                  <p className="mt-2 text-[11px] text-amber-700">No printers selected — auto mode will use the default printer.</p>
                )}
              </div>
            )}

            {/* Test print */}
            <div className="rounded-lg border border-border bg-card p-3">
              <p className="text-sm font-medium text-foreground">Test your connection:</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Send a test PDF to PrintLatch's built-in capture (no paper wasted):</p>
              <Button
                size="sm" variant="outline" className="mt-2 gap-1.5 min-h-[44px]"
                disabled={testPrintState === 'submitting' || testPrintState === 'polling'}
                onClick={async () => {
                  setTestPrintState('submitting'); setTestPrintError(null);
                  try {
                    const testPdf = new Uint8Array([0x25,0x50,0x44,0x46,0x2d,0x31,0x2e,0x34,0x0a,0x31,0x20,0x30,0x20,0x6f,0x62,0x6a,0x3c,0x3c,0x2f,0x54,0x79,0x70,0x65,0x2f,0x43,0x61,0x74,0x61,0x6c,0x6f,0x67,0x2f,0x50,0x61,0x67,0x65,0x73,0x20,0x32,0x20,0x30,0x20,0x52,0x3e,0x3e,0x65,0x6e,0x64,0x6f,0x62,0x6a,0x0a,0x32,0x20,0x30,0x20,0x6f,0x62,0x6a,0x3c,0x3c,0x2f,0x54,0x79,0x70,0x65,0x2f,0x50,0x61,0x67,0x65,0x73,0x2f,0x4b,0x69,0x64,0x73,0x5b,0x33,0x20,0x30,0x20,0x52,0x5d,0x2f,0x43,0x6f,0x75,0x6e,0x74,0x20,0x31,0x3e,0x3e,0x65,0x6e,0x64,0x6f,0x62,0x6a,0x0a,0x33,0x20,0x30,0x20,0x6f,0x62,0x6a,0x3c,0x3c,0x2f,0x54,0x79,0x70,0x65,0x2f,0x50,0x61,0x67,0x65,0x2f,0x4d,0x65,0x64,0x69,0x61,0x42,0x6f,0x78,0x5b,0x30,0x20,0x30,0x20,0x36,0x31,0x32,0x20,0x37,0x39,0x32,0x5d,0x2f,0x50,0x61,0x72,0x65,0x6e,0x74,0x20,0x32,0x20,0x30,0x20,0x52,0x3e,0x3e,0x65,0x6e,0x64,0x6f,0x62,0x6a,0x0a,0x78,0x72,0x65,0x66,0x0a,0x30,0x20,0x34,0x0a,0x30,0x30,0x30,0x30,0x30,0x30,0x30,0x30,0x30,0x30,0x20,0x36,0x35,0x35,0x33,0x35,0x20,0x66,0x20,0x0a,0x74,0x72,0x61,0x69,0x6c,0x65,0x72,0x3c,0x3c,0x2f,0x53,0x69,0x7a,0x65,0x20,0x34,0x2f,0x52,0x6f,0x6f,0x74,0x20,0x31,0x20,0x30,0x20,0x52,0x3e,0x3e,0x0a,0x73,0x74,0x61,0x72,0x74,0x78,0x72,0x65,0x66,0x0a,0x31,0x39,0x30,0x0a,0x25,0x25,0x45,0x4f,0x46]);
                    const job = await submitPrintLatchJob({ pdf: testPdf, filename: 'printlatch-test.pdf', mode: 'preview' });
                    setTestPrintState('polling');
                    for (let i = 0; i < 5; i++) {
                      await new Promise(r => setTimeout(r, 2000));
                      const status = await getPrintLatchJobStatus(job.id);
                      if (status.status === 'completed') { setTestPrintState('completed'); return; }
                      if (status.status === 'failed') { setTestPrintState('failed'); setTestPrintError(status.error?.message ?? 'Test failed'); return; }
                      if (status.status === 'unknown') { setTestPrintState('unknown'); setTestPrintError(status.error?.message ?? 'Unknown'); return; }
                    }
                    setTestPrintState('unknown'); setTestPrintError('Timed out — check PrintLatch dashboard');
                  } catch (err) {
                    setTestPrintState('failed'); setTestPrintError(err instanceof Error ? err.message : 'Test failed');
                  }
                }}
              >
                {testPrintState === 'submitting' || testPrintState === 'polling' ? <Loader2 className="size-3.5 animate-spin" /> : <TestTube className="size-3.5" />}
                {testPrintState === 'submitting' ? 'Sending…' : testPrintState === 'polling' ? 'Waiting…' : 'Test Print'}
              </Button>
              {testPrintState === 'completed' && <span className="ml-2 text-xs text-emerald-600">✓ Test successful!</span>}
              {testPrintState === 'failed' && <span className="ml-2 text-xs text-destructive">✗ {testPrintError}</span>}
              {testPrintState === 'unknown' && <span className="ml-2 text-xs text-amber-700">⚠ {testPrintError}</span>}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Connected: Supply tracking card (manual estimates) */}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Boxes className="size-4 text-amber-600" /> Supply Tracking</CardTitle>
            <CardDescription className="text-xs">
              Manually entered estimates — not automatically detected from your printer hardware.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Existing supplies table */}
            {supplies.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                No supplies tracked yet. Add one below to start tracking paper stock.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paper</TableHead>
                    <TableHead>Color</TableHead>
                    <TableHead className="text-right">Starting</TableHead>
                    <TableHead className="text-right">Consumed (est.)</TableHead>
                    <TableHead className="text-right">Current</TableHead>
                    <TableHead className="text-right">Low threshold</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supplies.map((s) => {
                    const consumed = printCount;
                    const current = s.startingStock - consumed;
                    const status: SupplyStatus =
                      current <= 0 ? 'out' : current <= s.lowStockThreshold ? 'low' : 'in-stock';
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium uppercase">{s.paperType}</TableCell>
                        <TableCell>{s.color === 'bw' ? 'B&W' : 'Color'}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{s.startingStock}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">{consumed}</TableCell>
                        <TableCell className="text-right font-mono text-sm font-medium">{Math.max(0, current)}</TableCell>
                        <TableCell className="text-right font-mono text-sm text-muted-foreground">{s.lowStockThreshold}</TableCell>
                        <TableCell><SupplyStatusBadge status={status} /></TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {restockId === s.id ? (
                              <>
                                <Input
                                  type="number"
                                  min={1}
                                  value={restockAmount}
                                  onChange={(e) => setRestockAmount(e.target.value)}
                                  placeholder="+sheets"
                                  className="h-9 w-20"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleRestock(s.id);
                                    if (e.key === 'Escape') { setRestockId(null); setRestockAmount(''); }
                                  }}
                                />
                                <Button size="sm" variant="outline" onClick={() => handleRestock(s.id)} className="gap-1.5 min-h-[44px]">
                                  <Check className="size-3.5 text-emerald-600" /> Add
                                </Button>
                                <Button size="sm" variant="ghost" onClick={() => { setRestockId(null); setRestockAmount(''); }} className="min-h-[44px]">
                                  Cancel
                                </Button>
                              </>
                            ) : (
                              <>
                                <Button
                                  size="sm" variant="outline" onClick={() => { setRestockId(s.id); setRestockAmount(''); }}
                                  className="gap-1.5 min-h-[44px]"
                                  title="Add to the starting stock"
                                >
                                  <PackagePlus className="size-3.5" /> Restock
                                </Button>
                                <Button
                                  size="sm" variant="ghost" onClick={() => removeSupply(s.id)}
                                  className="min-h-[44px]" title="Remove this supply row"
                                >
                                  <Trash2 className="size-3.5 text-rose-600" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}

            {/* Add-supply form */}
            <div className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium text-foreground">Add a supply</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Choose a paper type and color, then enter how many sheets you have right now.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="supply-paper">Paper type</Label>
                  <Select value={newSupply.paperType} onValueChange={(v) => setNewSupply((p) => ({ ...p, paperType: v as PaperType }))}>
                    <SelectTrigger id="supply-paper" className="h-11 sm:h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="a4">A4</SelectItem>
                      <SelectItem value="a3">A3</SelectItem>
                      <SelectItem value="letter">Letter</SelectItem>
                      <SelectItem value="legal">Legal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="supply-color">Color</Label>
                  <Select value={newSupply.color} onValueChange={(v) => setNewSupply((p) => ({ ...p, color: v as SupplyColor }))}>
                    <SelectTrigger id="supply-color" className="h-11 sm:h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bw">B&W</SelectItem>
                      <SelectItem value="color">Color</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="supply-starting">Starting stock (sheets)</Label>
                  <Input
                    id="supply-starting" type="number" min={0}
                    value={newSupply.startingStock}
                    onChange={(e) => setNewSupply((p) => ({ ...p, startingStock: e.target.value }))}
                    placeholder="e.g. 500"
                    className="h-11 sm:h-9"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs" htmlFor="supply-threshold">Low threshold</Label>
                  <Input
                    id="supply-threshold" type="number" min={0}
                    value={newSupply.lowStockThreshold}
                    onChange={(e) => setNewSupply((p) => ({ ...p, lowStockThreshold: e.target.value }))}
                    placeholder="50"
                    className="h-11 sm:h-9"
                  />
                </div>
              </div>
              <Button
                size="sm" className="mt-3 gap-1.5 min-h-[44px] bg-amber-600 text-white hover:bg-amber-700"
                onClick={addSupply}
                disabled={!newSupply.startingStock || parseInt(newSupply.startingStock, 10) < 0}
              >
                <PackagePlus className="size-4" /> Add Supply
              </Button>
            </div>

            <p className="text-[11px] text-muted-foreground">
              The "Consumed (est.)" column reads a global print counter from <code className="rounded bg-muted px-1 py-0.5">printshop_print_count</code> in your browser. It is incremented each time a file is printed via the batch print flow on the orders page. Single-file prints and prints from other devices do not increment it — adjust the starting stock manually if needed.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Setup guide (shown when NOT connected) */}
      {!isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Setup Guide — 6 Steps</CardTitle>
            <CardDescription>Follow these steps ONCE. After setup, PrintLatch auto-starts on boot + connects automatically.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">

            {/* Step 1: Download + Install */}
            <Step number={1} icon={Download} title="Download + Install PrintLatch" done={isConnected || needsPairing}>
              <p className="text-sm text-muted-foreground">Download from the <a href="https://github.com/arturict/printlatch/releases/latest" target="_blank" rel="noopener noreferrer" className="text-amber-700 underline">GitHub releases page</a>. Extract the ZIP, then in PowerShell run:</p>
              <CodeBlock code={installCommand} id="install" copied={copied} onCopy={copyToClipboard} />
              <p className="mt-1 text-[11px] text-muted-foreground">This installs PrintLatch, registers an auto-start task (starts on Windows boot), and starts the agent in the background.</p>
            </Step>

            {/* Step 2: Verify the agent is running */}
            <Step number={2} icon={Monitor} title="Verify PrintLatch is running" done={isConnected || needsPairing}>
              <p className="text-sm text-muted-foreground">Open the PrintLatch dashboard — it should show <Badge variant="outline" className="gap-1">Agent connected</Badge>:</p>
              <a href={PRINTLATCH_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-amber-700 hover:underline">
                <ExternalLink className="size-3.5" /> {PRINTLATCH_DASHBOARD_URL}
              </a>
              <p className="mt-2 text-[11px] text-muted-foreground">If it doesn't open, start the agent manually:</p>
              <CodeBlock code={dashboardCommand} id="dashboard" copied={copied} onCopy={copyToClipboard} />
              <p className="mt-1 text-[11px] text-muted-foreground">If something's wrong, run the diagnostic:</p>
              <CodeBlock code={diagnoseCommand} id="diagnose" copied={copied} onCopy={copyToClipboard} />
            </Step>

            {/* Step 3: Pair with this website */}
            <Step number={3} icon={Link2} title="Pair this website with PrintLatch" done={isConnected}>
              <p className="text-sm text-muted-foreground">Open <strong>Windows PowerShell</strong> and run this EXACT command (it uses YOUR website address):</p>
              <CodeBlock code={pairingCommand} id="pair" copied={copied} onCopy={copyToClipboard} />
              <p className="mt-1 text-[11px] text-muted-foreground">You should see: <code className="rounded bg-muted px-1.5 py-0.5">Pairing code: PL-XXXX-XXXX-XXXX-XXXX</code></p>
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                <strong>Important:</strong> The <code>--origin</code> must match this website's address exactly. You are on: <code className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-900">{typeof window !== 'undefined' ? window.location.origin : ''}</code>
              </div>
            </Step>

            {/* Step 4: Enter the pairing code */}
            <Step number={4} icon={ClipboardCheck} title="Enter the pairing code" done={isConnected}>
              <p className="text-sm text-muted-foreground">Copy the pairing code from PowerShell + paste it here:</p>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <Input type="text" value={pairingCode} onChange={(e) => setPairingCode(e.target.value)} placeholder="PL-XXXX-XXXX-XXXX-XXXX" className="font-mono h-11 sm:h-9" disabled={pairingConfirming} />
                <Button onClick={() => void handleConfirmPairing()} disabled={pairingConfirming || !pairingCode.trim()} className="min-h-[44px] w-full gap-1.5 bg-amber-600 text-white hover:bg-amber-700 sm:w-auto">
                  {pairingConfirming ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  {pairingConfirming ? 'Confirming…' : 'Confirm'}
                </Button>
              </div>
              {pairingResult?.success && <p className="mt-2 text-sm text-emerald-600">✓ Pairing confirmed! You can now print.</p>}
              {pairingResult && !pairingResult.success && <p className="mt-2 break-words text-sm text-destructive">✗ {pairingResult.error}</p>}
            </Step>

            {/* Step 5: Select your printers */}
            <Step number={5} icon={PrinterIcon} title="Select your print mode + printers" done={isConnected}>
              <p className="text-sm text-muted-foreground">Once connected, you can choose:</p>
              <ul className="mt-1 list-disc pl-4 text-sm text-muted-foreground">
                <li><strong>Manual Mode</strong> (default): choose the printer each time you print.</li>
                <li><strong>Auto Mode</strong>: select multiple printers — files auto-route to them one-by-one (round-robin). If one is busy, the next file goes to the next printer.</li>
              </ul>
              <p className="mt-1 text-[11px] text-muted-foreground">The toggle + printer list appear in the <strong>Print Mode</strong> card above once you're connected.</p>
            </Step>

            {/* Step 6: Print */}
            <Step number={6} icon={CheckCircle2} title="You're ready to print!" done={isConnected}>
              <p className="text-sm text-muted-foreground">Open any order → click <strong>Print</strong> next to a file → review the settings → click <strong>Confirm Print</strong>. The document goes straight to your printer.</p>
            </Step>
          </CardContent>
        </Card>
      )}

      {/* Troubleshooting */}
      <Card>
        <CardHeader>
          <button onClick={() => { const el = document.getElementById('ts'); el?.classList.toggle('hidden'); }} className="flex w-full items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base"><AlertCircle className="size-4 text-muted-foreground" /> Troubleshooting</CardTitle>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        </CardHeader>
        <CardContent id="ts" className="hidden">
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li><strong className="text-foreground">Agent not reachable:</strong> Ensure PrintLatch is running — open <a href={PRINTLATCH_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className="text-amber-700 underline">{PRINTLATCH_DASHBOARD_URL}</a> to check.</li>
            <li><strong className="text-foreground">Origin mismatch:</strong> The <code className="rounded bg-muted px-1.5 py-0.5">--origin</code> must match this website. You are on <code className="rounded bg-muted px-1.5 py-0.5">{typeof window !== 'undefined' ? window.location.origin : ''}</code>.</li>
            <li><strong className="text-foreground">Pairing expired:</strong> Re-run the pairing command + enter the new code.</li>
            <li><strong className="text-foreground">PowerShell error:</strong> Use <code className="rounded bg-muted px-1.5 py-0.5">&amp;</code> + <code className="rounded bg-muted px-1.5 py-0.5">$env:</code> syntax (see the command above).</li>
            <li><strong className="text-foreground">Re-pairing:</strong> Run the pairing command with the new origin, enter the code, click Confirm.</li>
            <li><strong className="text-foreground">Agent stops after reboot:</strong> Re-run <code className="rounded bg-muted px-1.5 py-0.5">install.ps1</code> or create a Startup folder shortcut.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Supply tracking helpers ────────────────────────────────────────────

type PaperType = 'a4' | 'a3' | 'letter' | 'legal';
type SupplyColor = 'bw' | 'color';
type SupplyStatus = 'in-stock' | 'low' | 'out';

interface Supply {
  id: string; // `${paperType}-${color}`
  paperType: PaperType;
  color: SupplyColor;
  startingStock: number;
  lowStockThreshold: number;
}

interface NewSupplyForm {
  paperType: PaperType;
  color: SupplyColor;
  startingStock: string;
  lowStockThreshold: string;
}

const SUPPLIES_KEY = 'printshop_supplies';
const PRINT_COUNT_KEY = 'printshop_print_count';

function loadSupplies(): Supply[] {
  try {
    const raw = localStorage.getItem(SUPPLIES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is Supply =>
      s && typeof s.id === 'string' &&
      typeof s.paperType === 'string' &&
      typeof s.color === 'string' &&
      typeof s.startingStock === 'number' &&
      typeof s.lowStockThreshold === 'number'
    );
  } catch {
    return [];
  }
}

function saveSupplies(supplies: Supply[]): void {
  try {
    localStorage.setItem(SUPPLIES_KEY, JSON.stringify(supplies));
  } catch { /* ignore */ }
}

function getPrintCount(): number {
  try {
    return parseInt(localStorage.getItem(PRINT_COUNT_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function SupplyStatusBadge({ status }: { status: SupplyStatus }) {
  const cls =
    status === 'in-stock' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' :
    status === 'low' ? 'border-amber-300 bg-amber-50 text-amber-700' :
    'border-rose-300 bg-rose-50 text-rose-700';
  const label = status === 'in-stock' ? 'In Stock' : status === 'low' ? 'Low' : 'Out';
  return (
    <Badge variant="outline" className={`text-[11px] ${cls}`}>
      <span className="mr-1 inline-block size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </Badge>
  );
}

// ─── Helper components ───

function Step({ number, icon: Icon, title, done, children }: { number: number; icon: React.ComponentType<{ className?: string }>; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 sm:gap-4">
      <div className="flex flex-col items-center">
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-700'}`}>
          {done ? <CheckCircle2 className="size-5" /> : <Icon className="size-5" />}
        </div>
        {number < 6 && <div className="mt-1 h-full w-px flex-1 bg-border" />}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-muted-foreground">STEP {number}</span>
          {done && <Badge variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700"><Check className="size-3" /> Done</Badge>}
        </div>
        <h3 className="mt-1 text-base font-semibold text-foreground">{title}</h3>
        <div className="mt-2">{children}</div>
      </div>
    </div>
  );
}

function CodeBlock({ code, id, copied, onCopy }: { code: string; id: string; copied: string | null; onCopy: (text: string, id: string) => void }) {
  return (
    <div className="mt-2 flex items-start gap-2">
      <code className="block flex-1 break-all rounded-lg bg-zinc-900 p-2 text-[10px] text-zinc-100 sm:text-xs">{code}</code>
      <Button variant="outline" size="sm" onClick={() => onCopy(code, id)} className="min-h-[44px] shrink-0 gap-1.5">
        {copied === id ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}
