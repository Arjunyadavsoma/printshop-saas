'use client';

/**
 * PaymentProviderSettings — Payment Provider Management section
 * rendered at the TOP of the "payment" tab on /shop/settings.
 *
 * Lets the shopkeeper:
 *   1. See provider cards (PhonePe Business + Paytm Business) with
 *      connection-status badges, auth-version + environment badges,
 *      masked identifiers, and an "Active" indicator.
 *   2. Enter credentials in conditional forms (PhonePe v1/v2 or Paytm
 *      standard). Secret fields are NEVER pre-filled — if creds exist
 *      we show "•••••• (saved)" placeholders and require the user to
 *      re-enter all fields to update.
 *   3. Test the connection (POST /test) → result + latency.
 *   4. Save & Activate (PUT → POST /activate).
 *   5. Disconnect (DELETE ?provider=…).
 *   6. View webhook URLs with copy-to-clipboard.
 *   7. Read security warnings.
 *
 * All API calls go through the shared useApiClient() hook (auto 401-refresh).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiClient } from '@/components/portal/use-api-client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  Loader2,
  Check,
  CheckCircle2,
  AlertCircle,
  Copy,
  Eye,
  EyeOff,
  PlugZap,
  Save,
  Trash2,
  ShieldCheck,
  ShieldAlert,
  Info,
  Zap,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Types mirroring the API contract ────────────────────────────────

type Provider = 'phonepe' | 'paytm';
type AuthVersion = 'v1' | 'v2' | 'standard';
type Env = 'sandbox' | 'prod';

interface ProviderStatus {
  connected: boolean;
  authVersion?: AuthVersion;
  env?: Env;
  merchantId?: string | null;
  clientId?: string | null;
  saltKey?: string | null;
  website?: string | null;
}

interface PaymentStatus {
  activeProvider: string;
  providers: {
    phonepe?: ProviderStatus;
    paytm?: ProviderStatus;
  };
  webhookUrls: {
    phonepe: string;
    paytm: string;
  };
}

interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
}

// ─── Provider form state ─────────────────────────────────────────────

interface PhonePeV2Form {
  clientId: string;
  clientSecret: string;
  clientVersion: string;
  merchantId: string;
  env: Env;
}
interface PhonePeV1Form {
  merchantId: string;
  saltKey: string;
  saltIndex: string;
  env: Env;
}
interface PaytmForm {
  merchantId: string;
  merchantKey: string;
  website: string;
  env: Env;
}

const emptyV2: PhonePeV2Form = {
  clientId: '',
  clientSecret: '',
  clientVersion: '1',
  merchantId: '',
  env: 'sandbox',
};
const emptyV1: PhonePeV1Form = {
  merchantId: '',
  saltKey: '',
  saltIndex: '1',
  env: 'sandbox',
};
const emptyPaytm: PaytmForm = {
  merchantId: '',
  merchantKey: '',
  website: 'WEBSTAGING',
  env: 'sandbox',
};

// ─── Component ───────────────────────────────────────────────────────

export function PaymentProviderSettings() {
  const api = useApiClient();

  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Which provider's form is expanded (null = all collapsed).
  const [expanded, setExpanded] = useState<Provider | null>(null);

  // PhonePe auth-version selector (only used when expanded === 'phonepe').
  const [phonepeVersion, setPhonepeVersion] = useState<'v1' | 'v2'>('v2');

  // Form drafts — kept separate so switching tabs doesn't lose data.
  const [v2Form, setV2Form] = useState<PhonePeV2Form>(emptyV2);
  const [v1Form, setV1Form] = useState<PhonePeV1Form>(emptyV1);
  const [paytmForm, setPaytmForm] = useState<PaytmForm>(emptyPaytm);

  // Show/hide secret fields.
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  // Async operation flags.
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [disconnectingProvider, setDisconnectingProvider] = useState<Provider | null>(null);

  // Last test result for display.
  const [testResult, setTestResult] = useState<{
    provider: Provider;
    ok: boolean;
    latencyMs?: number;
    error?: string;
  } | null>(null);

  // ── Load masked status on mount ──
  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const r = await api.request<ApiEnvelope<PaymentStatus>>(
        'GET',
        '/api/v1/shops/me/payment-credentials',
      );
      if (r.status === 200 && r.data?.data) {
        setStatus(r.data.data);
      } else if (r.status === 401) {
        setLoadError('Session expired. Please log in again.');
      } else {
        setLoadError(r.data?.error?.message ?? `Load failed (HTTP ${r.status}).`);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // ── Helpers ──
  const origin = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  }, []);

  const absoluteWebhookUrl = (rel: string): string => {
    if (!origin) return rel;
    return `${origin}${rel}`;
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`✓ ${label} copied`, { description: text });
    } catch {
      // Fallback for browsers without clipboard API.
      toast.error('Copy failed', { description: 'Please copy the URL manually.' });
    }
  };

  const toggleSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // ── Expand/collapse a provider's form ──
  const openProvider = (p: Provider) => {
    if (expanded === p) {
      setExpanded(null);
      return;
    }
    setExpanded(p);
    setTestResult(null);
    // Pre-select PhonePe version from existing saved state if connected.
    if (p === 'phonepe') {
      const cur = status?.providers.phonepe;
      if (cur?.connected && cur.authVersion === 'v1') {
        setPhonepeVersion('v1');
      } else {
        setPhonepeVersion('v2');
      }
    }
  };

  // ── Save credentials, optionally activate ──
  const saveCredentials = async (provider: Provider, activate: boolean) => {
    setSaving(true);
    setTestResult(null);
    try {
      let body: Record<string, unknown>;
      if (provider === 'phonepe') {
        if (phonepeVersion === 'v2') {
          if (!v2Form.clientId || !v2Form.clientSecret || !v2Form.merchantId) {
            toast.error('Missing fields', {
              description: 'Client ID, Client Secret, and Merchant ID are required.',
            });
            setSaving(false);
            return;
          }
          body = {
            provider: 'phonepe',
            authVersion: 'v2',
            clientId: v2Form.clientId.trim(),
            clientSecret: v2Form.clientSecret,
            clientVersion: v2Form.clientVersion || '1',
            merchantId: v2Form.merchantId.trim(),
            env: v2Form.env,
          };
        } else {
          if (!v1Form.merchantId || !v1Form.saltKey || !v1Form.saltIndex) {
            toast.error('Missing fields', {
              description: 'Merchant ID, Salt Key, and Salt Index are required.',
            });
            setSaving(false);
            return;
          }
          body = {
            provider: 'phonepe',
            authVersion: 'v1',
            merchantId: v1Form.merchantId.trim(),
            saltKey: v1Form.saltKey,
            saltIndex: v1Form.saltIndex.trim(),
            env: v1Form.env,
          };
        }
      } else {
        if (!paytmForm.merchantId || !paytmForm.merchantKey || !paytmForm.website) {
          toast.error('Missing fields', {
            description: 'Merchant ID, Merchant Key, and Website are required.',
          });
          setSaving(false);
          return;
        }
        body = {
          provider: 'paytm',
          authVersion: 'standard',
          merchantId: paytmForm.merchantId.trim(),
          merchantKey: paytmForm.merchantKey,
          website: paytmForm.website.trim(),
          env: paytmForm.env,
        };
      }

      // Save (PUT) → returns updated masked status.
      const r = await api.request<ApiEnvelope<PaymentStatus>>(
        'PUT',
        '/api/v1/shops/me/payment-credentials',
        { body },
      );
      if (r.status !== 200 || !r.data?.data) {
        toast.error('Save failed', {
          description: r.data?.error?.message ?? `HTTP ${r.status}`,
        });
        setSaving(false);
        return;
      }
      setStatus(r.data.data);

      if (activate) {
        setActivating(true);
        const a = await api.request<ApiEnvelope<{ ok: boolean; activeProvider: Provider }>>(
          'POST',
          '/api/v1/shops/me/payment-credentials/activate',
          { body: { provider } },
        );
        setActivating(false);
        if (a.status !== 200 || !a.data?.data) {
          toast.error('Saved but activation failed', {
            description: a.data?.error?.message ?? `HTTP ${a.status}. Credentials are saved — try activating separately.`,
          });
        } else {
          // Reload status to reflect the new activeProvider.
          await loadStatus();
          toast.success(`✓ ${labelFor(provider)} activated`, {
            description: 'New checkout payments will use this provider.',
          });
        }
      } else {
        toast.success(`✓ ${labelFor(provider)} credentials saved`, {
          description: 'Test the connection, then activate when ready.',
        });
      }
    } catch (err) {
      toast.error('Network error', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setSaving(false);
      setActivating(false);
    }
  };

  // ── Test connection ──
  const testConnection = async (provider: Provider) => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.request<ApiEnvelope<{ ok: boolean; latencyMs?: number; error?: string }>>(
        'POST',
        '/api/v1/shops/me/payment-credentials/test',
        { body: { provider } },
      );
      if (r.status !== 200 || !r.data?.data) {
        toast.error('Test request failed', {
          description: r.data?.error?.message ?? `HTTP ${r.status}`,
        });
        setTesting(false);
        return;
      }
      const result = r.data.data;
      setTestResult({ provider, ...result });
      if (result.ok) {
        toast.success(`✓ ${labelFor(provider)} connection OK`, {
          description: result.latencyMs != null ? `Latency: ${result.latencyMs}ms` : undefined,
        });
      } else {
        toast.error(`✗ ${labelFor(provider)} test failed`, {
          description: result.error ?? 'Could not verify credentials.',
        });
      }
    } catch (err) {
      toast.error('Network error', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setTesting(false);
    }
  };

  // ── Activate (no save) ──
  const activateProvider = async (provider: Provider) => {
    setActivating(true);
    try {
      const r = await api.request<ApiEnvelope<{ ok: boolean; activeProvider: Provider }>>(
        'POST',
        '/api/v1/shops/me/payment-credentials/activate',
        { body: { provider } },
      );
      if (r.status !== 200 || !r.data?.data) {
        toast.error('Activation failed', {
          description: r.data?.error?.message ?? `HTTP ${r.status}`,
        });
        return;
      }
      await loadStatus();
      toast.success(`✓ ${labelFor(provider)} activated`, {
        description: 'New checkout payments will use this provider.',
      });
    } catch (err) {
      toast.error('Network error', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setActivating(false);
    }
  };

  // ── Disconnect ──
  const confirmDisconnect = async () => {
    const provider = disconnectingProvider;
    if (!provider) return;
    setActivating(true);
    try {
      const r = await api.request<ApiEnvelope<PaymentStatus>>(
        'DELETE',
        `/api/v1/shops/me/payment-credentials?provider=${provider}`,
      );
      if (r.status !== 200 || !r.data?.data) {
        toast.error('Disconnect failed', {
          description: r.data?.error?.message ?? `HTTP ${r.status}`,
        });
        return;
      }
      setStatus(r.data.data);
      setExpanded(null);
      // Reset form drafts.
      if (provider === 'phonepe') {
        setV2Form(emptyV2);
        setV1Form(emptyV1);
      } else {
        setPaytmForm(emptyPaytm);
      }
      toast.success(`✓ ${labelFor(provider)} disconnected`, {
        description: 'Credentials removed. You can reconnect any time.',
      });
    } catch (err) {
      toast.error('Network error', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setActivating(false);
      setDisconnectingProvider(null);
    }
  };

  // ── Render ──
  if (loading) {
    return (
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PlugZap className="size-4 text-amber-600" /> Payment providers
          </CardTitle>
          <CardDescription className="text-xs">Loading payment provider status…</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="mb-6 border-rose-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-rose-700">
            <AlertCircle className="size-4" /> Could not load payment providers
          </CardTitle>
          <CardDescription className="text-xs">{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void loadStatus()} variant="outline" className="gap-1.5">
            <Loader2 className="size-4 animate-spin" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const phonepe = status?.providers.phonepe ?? { connected: false };
  const paytm = status?.providers.paytm ?? { connected: false };
  const activeProvider = status?.activeProvider ?? 'googlepay';

  return (
    <div className="mb-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PlugZap className="size-4 text-amber-600" /> Payment providers
          </CardTitle>
          <CardDescription className="text-xs">
            Connect a payment gateway (PhonePe Business or Paytm Business) to accept online card / UPI / wallet
            payments automatically. Activate one provider at a time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Provider card: PhonePe */}
          <ProviderCard
            provider="phonepe"
            title="PhonePe Business"
            description="Accept UPI, cards, wallets, and net-banking via PhonePe Payment Gateway. Supports both v2 (OAuth2) and v1 (Standard) APIs."
            connected={phonepe.connected}
            isActive={activeProvider === 'phonepe'}
            authVersion={phonepe.authVersion}
            env={phonepe.env}
            maskedFields={[
              { label: 'Merchant ID', value: phonepe.merchantId ?? null },
              ...(phonepe.authVersion === 'v2'
                ? [{ label: 'Client ID', value: phonepe.clientId ?? null }]
                : phonepe.authVersion === 'v1'
                  ? [{ label: 'Salt Key', value: phonepe.saltKey ?? null }]
                  : []),
            ]}
            expanded={expanded === 'phonepe'}
            onToggle={() => openProvider('phonepe')}
            onActivate={() => void activateProvider('phonepe')}
            onDisconnect={() => setDisconnectingProvider('phonepe')}
            busy={saving || testing || activating}
          />

          {/* PhonePe form (expandable) */}
          {expanded === 'phonepe' && (
            <PhonePeFormPanel
              version={phonepeVersion}
              onVersionChange={setPhonepeVersion}
              v2Form={v2Form}
              v1Form={v1Form}
              setV2Form={setV2Form}
              setV1Form={setV1Form}
              showSecrets={showSecrets}
              toggleSecret={toggleSecret}
              connected={phonepe.connected}
              onTest={() => void testConnection('phonepe')}
              onSave={(activate) => void saveCredentials('phonepe', activate)}
              onActivate={() => void activateProvider('phonepe')}
              onDisconnect={() => setDisconnectingProvider('phonepe')}
              saving={saving}
              testing={testing}
              activating={activating}
              testResult={
                testResult && testResult.provider === 'phonepe' ? testResult : null
              }
              hasActive={phonepe.connected}
            />
          )}

          <Separator />

          {/* Provider card: Paytm */}
          <ProviderCard
            provider="paytm"
            title="Paytm Business"
            description="Accept UPI, cards, wallets, and net-banking via Paytm Payment Gateway. Uses standard checksum-based authentication."
            connected={paytm.connected}
            isActive={activeProvider === 'paytm'}
            authVersion={paytm.authVersion ?? 'standard'}
            env={paytm.env}
            maskedFields={[
              { label: 'Merchant ID', value: paytm.merchantId ?? null },
              { label: 'Website', value: paytm.website ?? null },
            ]}
            expanded={expanded === 'paytm'}
            onToggle={() => openProvider('paytm')}
            onActivate={() => void activateProvider('paytm')}
            onDisconnect={() => setDisconnectingProvider('paytm')}
            busy={saving || testing || activating}
          />

          {/* Paytm form (expandable) */}
          {expanded === 'paytm' && (
            <PaytmFormPanel
              form={paytmForm}
              setForm={setPaytmForm}
              showSecrets={showSecrets}
              toggleSecret={toggleSecret}
              connected={paytm.connected}
              onTest={() => void testConnection('paytm')}
              onSave={(activate) => void saveCredentials('paytm', activate)}
              onActivate={() => void activateProvider('paytm')}
              onDisconnect={() => setDisconnectingProvider('paytm')}
              saving={saving}
              testing={testing}
              activating={activating}
              testResult={
                testResult && testResult.provider === 'paytm' ? testResult : null
              }
              hasActive={paytm.connected}
            />
          )}
        </CardContent>
      </Card>

      {/* Webhook URLs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="size-4 text-amber-600" /> Webhook configuration
          </CardTitle>
          <CardDescription className="text-xs">
            Configure these URLs in your payment provider&apos;s merchant dashboard under Webhook / Callback
            settings so PrintShop can receive payment-status updates.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <WebhookRow
            label="PhonePe webhook"
            description="PhonePe Business Dashboard → API Keys → Webhook URL"
            relativeUrl={status?.webhookUrls.phonepe ?? '/api/v1/payments/phonepe/webhook'}
            onCopy={(url) => void copyToClipboard(url, 'PhonePe webhook URL')}
          />
          <Separator />
          <WebhookRow
            label="Paytm callback"
            description="Paytm Merchant Dashboard → Developer Settings → Callback URL"
            relativeUrl={status?.webhookUrls.paytm ?? '/api/v1/payments/paytm/callback'}
            onCopy={(url) => void copyToClipboard(url, 'Paytm callback URL')}
          />
        </CardContent>
      </Card>

      {/* Security notice */}
      <Card className="border-amber-200 bg-amber-50/40 dark:bg-amber-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400">
            <ShieldCheck className="size-4" /> Security &amp; privacy
          </CardTitle>
          <CardDescription className="text-xs text-amber-700/80 dark:text-amber-400/80">
            How PrintShop protects your payment credentials.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>
              Your payment credentials are encrypted with{' '}
              <strong>AES-256-GCM</strong> before storage. They are only decrypted server-side, in-memory, at
              the moment PrintShop&apos;s secure backend communicates with your payment provider.
            </span>
          </p>
          <p className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>
              PrintShop will <strong>never</strong> ask for your UPI PIN, OTP, bank password, or payment-app
              login password. Anyone claiming to be from PrintShop and asking for these is a scammer — report
              them to <a className="underline" href="mailto:security@printshop.example">security@printshop.example</a>.
            </span>
          </p>
          <p className="flex items-start gap-2">
            <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>
              Secret fields on this page are never pre-filled from the server. The form is always blank — to
              update, re-enter all fields and click <em>Save &amp; Activate</em>.
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Disconnect confirmation */}
      <AlertDialog
        open={disconnectingProvider !== null}
        onOpenChange={(open) => {
          if (!open) setDisconnectingProvider(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {disconnectingProvider ? labelFor(disconnectingProvider) : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove your saved {disconnectingProvider} credentials from PrintShop.
              {status?.activeProvider === disconnectingProvider
                ? ' This provider is currently active — new checkouts will fall back to manual UPI payment until you activate another provider.'
                : ''}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={activating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDisconnect();
              }}
              disabled={activating}
              className="bg-rose-600 text-white hover:bg-rose-600/90"
            >
              {activating ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function labelFor(p: Provider): string {
  return p === 'phonepe' ? 'PhonePe Business' : 'Paytm Business';
}

function envLabel(env?: Env): string {
  if (env === 'prod') return 'Production';
  if (env === 'sandbox') return 'Sandbox';
  return '—';
}

function authVersionLabel(v?: AuthVersion): string {
  if (v === 'v2') return 'v2 · OAuth2';
  if (v === 'v1') return 'v1 · Standard';
  if (v === 'standard') return 'Standard';
  return '—';
}

interface ProviderCardProps {
  provider: Provider;
  title: string;
  description: string;
  connected: boolean;
  isActive: boolean;
  authVersion?: AuthVersion;
  env?: Env;
  maskedFields: { label: string; value: string | null }[];
  expanded: boolean;
  onToggle: () => void;
  onActivate: () => void;
  onDisconnect: () => void;
  busy: boolean;
}

function ProviderCard(props: ProviderCardProps) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        props.isActive ? 'border-amber-400 bg-amber-50/50 dark:bg-amber-950/20' : 'border-border'
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold">{props.title}</h4>
            {props.isActive && (
              <Badge className="bg-amber-600 text-white hover:bg-amber-600">
                <Check className="mr-1 size-3" /> Active
              </Badge>
            )}
            {props.connected ? (
              <Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/40 dark:text-emerald-300">
                <CheckCircle2 className="size-3" /> Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">Not connected</Badge>
            )}
            {props.connected && props.authVersion && (
              <Badge variant="outline" className="text-muted-foreground">
                {authVersionLabel(props.authVersion)}
              </Badge>
            )}
            {props.connected && props.env && (
              <Badge
                variant="outline"
                className={
                  props.env === 'prod'
                    ? 'border-rose-300 text-rose-700'
                    : 'text-muted-foreground'
                }
              >
                {envLabel(props.env)}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{props.description}</p>
          {props.connected && props.maskedFields.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {props.maskedFields.map((f) => (
                <span key={f.label} className="text-muted-foreground">
                  <span className="font-medium text-foreground/80">{f.label}:</span>{' '}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                    {f.value ?? '••••••••'}
                  </code>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {props.connected && !props.isActive && (
            <Button
              size="sm"
              variant="outline"
              onClick={props.onActivate}
              disabled={props.busy}
              className="gap-1.5"
            >
              <Check className="size-3.5" /> Activate
            </Button>
          )}
          <Button
            size="sm"
            variant={props.connected ? 'outline' : 'default'}
            onClick={props.onToggle}
            disabled={props.busy}
            className={
              props.connected
                ? 'gap-1.5'
                : 'gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90'
            }
          >
            {props.expanded ? <EyeOff className="size-3.5" /> : <PlugZap className="size-3.5" />}
            {props.connected ? (props.expanded ? 'Hide form' : 'Manage') : 'Connect'}
          </Button>
          {props.connected && (
            <Button
              size="sm"
              variant="ghost"
              onClick={props.onDisconnect}
              disabled={props.busy}
              className="gap-1.5 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30"
            >
              <Trash2 className="size-3.5" /> Disconnect
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PhonePe form panel ──────────────────────────────────────────────

interface PhonePeFormPanelProps {
  version: 'v1' | 'v2';
  onVersionChange: (v: 'v1' | 'v2') => void;
  v2Form: PhonePeV2Form;
  v1Form: PhonePeV1Form;
  setV2Form: (f: PhonePeV2Form) => void;
  setV1Form: (f: PhonePeV1Form) => void;
  showSecrets: Record<string, boolean>;
  toggleSecret: (key: string) => void;
  connected: boolean;
  onTest: () => void;
  onSave: (activate: boolean) => void;
  onActivate: () => void;
  onDisconnect: () => void;
  saving: boolean;
  testing: boolean;
  activating: boolean;
  testResult: { ok: boolean; latencyMs?: number; error?: string } | null;
  hasActive: boolean;
}

function PhonePeFormPanel(props: PhonePeFormPanelProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
      <div className="space-y-4">
        {/* Auth version selector */}
        <div className="space-y-1.5">
          <Label htmlFor="phonepe-version" className="text-xs font-medium">
            Authentication version
          </Label>
          <Select
            value={props.version}
            onValueChange={(v) => props.onVersionChange(v as 'v1' | 'v2')}
          >
            <SelectTrigger id="phonepe-version" className="h-10 sm:h-9">
              <SelectValue placeholder="Select version" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="v2">v2 — OAuth2 (recommended for new integrations)</SelectItem>
              <SelectItem value="v1">v1 — Standard (Salt Key + Salt Index)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            Find your version in the PhonePe Business dashboard under API Keys.
          </p>
        </div>

        {/* v2 fields */}
        {props.version === 'v2' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <SecretField
              id="pp-client-id"
              label="Client ID"
              placeholder="SU250xxx"
              value={props.v2Form.clientId}
              onChange={(v) => props.setV2Form({ ...props.v2Form, clientId: v })}
              show={props.showSecrets['pp-client-id'] ?? false}
              onToggle={() => props.toggleSecret('pp-client-id')}
              required
            />
            <SecretField
              id="pp-client-secret"
              label="Client Secret"
              placeholder="••••••••••••"
              value={props.v2Form.clientSecret}
              onChange={(v) => props.setV2Form({ ...props.v2Form, clientSecret: v })}
              show={props.showSecrets['pp-client-secret'] ?? false}
              onToggle={() => props.toggleSecret('pp-client-secret')}
              required
            />
            <div className="space-y-1.5">
              <Label htmlFor="pp-client-version" className="text-xs font-medium">
                Client Version
              </Label>
              <Input
                id="pp-client-version"
                value={props.v2Form.clientVersion}
                onChange={(e) => props.setV2Form({ ...props.v2Form, clientVersion: e.target.value })}
                placeholder="1"
                className="h-11 sm:h-9"
              />
              <p className="text-[10px] text-muted-foreground">Usually <code>1</code>.</p>
            </div>
            <SecretField
              id="pp-merchant-id-v2"
              label="Merchant ID"
              placeholder="MIDxxxxxxxx"
              value={props.v2Form.merchantId}
              onChange={(v) => props.setV2Form({ ...props.v2Form, merchantId: v })}
              show={props.showSecrets['pp-merchant-id-v2'] ?? false}
              onToggle={() => props.toggleSecret('pp-merchant-id-v2')}
              required
            />
            <EnvSelect
              id="pp-env-v2"
              value={props.v2Form.env}
              onChange={(v) => props.setV2Form({ ...props.v2Form, env: v })}
            />
          </div>
        )}

        {/* v1 fields */}
        {props.version === 'v1' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <SecretField
              id="pp-merchant-id-v1"
              label="Merchant ID"
              placeholder="MIDxxxxxxxx"
              value={props.v1Form.merchantId}
              onChange={(v) => props.setV1Form({ ...props.v1Form, merchantId: v })}
              show={props.showSecrets['pp-merchant-id-v1'] ?? false}
              onToggle={() => props.toggleSecret('pp-merchant-id-v1')}
              required
            />
            <SecretField
              id="pp-salt-key"
              label="Salt Key"
              placeholder="••••••••••••"
              value={props.v1Form.saltKey}
              onChange={(v) => props.setV1Form({ ...props.v1Form, saltKey: v })}
              show={props.showSecrets['pp-salt-key'] ?? false}
              onToggle={() => props.toggleSecret('pp-salt-key')}
              required
            />
            <div className="space-y-1.5">
              <Label htmlFor="pp-salt-index" className="text-xs font-medium">
                Salt Index
              </Label>
              <Input
                id="pp-salt-index"
                value={props.v1Form.saltIndex}
                onChange={(e) => props.setV1Form({ ...props.v1Form, saltIndex: e.target.value })}
                placeholder="1"
                className="h-11 sm:h-9"
              />
              <p className="text-[10px] text-muted-foreground">Usually <code>1</code>.</p>
            </div>
            <EnvSelect
              id="pp-env-v1"
              value={props.v1Form.env}
              onChange={(v) => props.setV1Form({ ...props.v1Form, env: v })}
            />
          </div>
        )}

        {/* Test result */}
        {props.testResult && (
          <TestResultBanner ok={props.testResult.ok} latencyMs={props.testResult.latencyMs} error={props.testResult.error} />
        )}

        {/* Action buttons */}
        <FormActions
          connected={props.connected}
          saving={props.saving}
          testing={props.testing}
          activating={props.activating}
          onTest={props.onTest}
          onSave={() => props.onSave(false)}
          onSaveAndActivate={() => props.onSave(true)}
        />

        {/* Onboarding guide */}
        <PhonePeOnboardingGuide />
      </div>
    </div>
  );
}

// ─── Paytm form panel ────────────────────────────────────────────────

interface PaytmFormPanelProps {
  form: PaytmForm;
  setForm: (f: PaytmForm) => void;
  showSecrets: Record<string, boolean>;
  toggleSecret: (key: string) => void;
  connected: boolean;
  onTest: () => void;
  onSave: (activate: boolean) => void;
  onActivate: () => void;
  onDisconnect: () => void;
  saving: boolean;
  testing: boolean;
  activating: boolean;
  testResult: { ok: boolean; latencyMs?: number; error?: string } | null;
  hasActive: boolean;
}

function PaytmFormPanel(props: PaytmFormPanelProps) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <SecretField
            id="paytm-mid"
            label="Merchant ID"
            placeholder="MerchantIdxxxx"
            value={props.form.merchantId}
            onChange={(v) => props.setForm({ ...props.form, merchantId: v })}
            show={props.showSecrets['paytm-mid'] ?? false}
            onToggle={() => props.toggleSecret('paytm-mid')}
            required
          />
          <SecretField
            id="paytm-merchant-key"
            label="Merchant Key"
            placeholder="••••••••••••"
            value={props.form.merchantKey}
            onChange={(v) => props.setForm({ ...props.form, merchantKey: v })}
            show={props.showSecrets['paytm-merchant-key'] ?? false}
            onToggle={() => props.toggleSecret('paytm-merchant-key')}
            required
          />
          <div className="space-y-1.5">
            <Label htmlFor="paytm-website" className="text-xs font-medium">
              Website
            </Label>
            <Input
              id="paytm-website"
              value={props.form.website}
              onChange={(e) => props.setForm({ ...props.form, website: e.target.value })}
              placeholder={props.form.env === 'prod' ? 'DEFAULT' : 'WEBSTAGING'}
              className="h-11 sm:h-9"
            />
            <p className="text-[10px] text-muted-foreground">
              Use <code>WEBSTAGING</code> for sandbox, <code>DEFAULT</code> for production.
            </p>
          </div>
          <EnvSelect
            id="paytm-env"
            value={props.form.env}
            onChange={(v) => {
              // Auto-suggest website value when env changes (only if user hasn't customized).
              const suggested = v === 'prod' ? 'DEFAULT' : 'WEBSTAGING';
              const current = props.form.website;
              const wasSandboxDefault = current === 'WEBSTAGING' || current === 'DEFAULT' || current === '';
              props.setForm({
                ...props.form,
                env: v,
                website: wasSandboxDefault ? suggested : current,
              });
            }}
          />
        </div>

        {props.testResult && (
          <TestResultBanner ok={props.testResult.ok} latencyMs={props.testResult.latencyMs} error={props.testResult.error} />
        )}

        <FormActions
          connected={props.connected}
          saving={props.saving}
          testing={props.testing}
          activating={props.activating}
          onTest={props.onTest}
          onSave={() => props.onSave(false)}
          onSaveAndActivate={() => props.onSave(true)}
        />

        <PaytmOnboardingGuide />
      </div>
    </div>
  );
}

// ─── Reusable form primitives ────────────────────────────────────────

interface SecretFieldProps {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  required?: boolean;
}

function SecretField(props: SecretFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id} className="text-xs font-medium">
        {props.label}
        {props.required && <span className="ml-1 text-rose-600">*</span>}
      </Label>
      <div className="relative">
        <Input
          id={props.id}
          type={props.show ? 'text' : 'password'}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          placeholder={props.placeholder}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-11 pr-10 sm:h-9"
        />
        <button
          type="button"
          onClick={props.onToggle}
          aria-label={props.show ? 'Hide' : 'Show'}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {props.show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

interface EnvSelectProps {
  id: string;
  value: Env;
  onChange: (v: Env) => void;
}

function EnvSelect(props: EnvSelectProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id} className="text-xs font-medium">
        Environment
      </Label>
      <Select value={props.value} onValueChange={(v) => props.onChange(v as Env)}>
        <SelectTrigger id={props.id} className="h-10 sm:h-9">
          <SelectValue placeholder="Select environment" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="sandbox">Sandbox (test)</SelectItem>
          <SelectItem value="prod">Production (live)</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground">
        Use Sandbox until your account is verified, then switch to Production.
      </p>
    </div>
  );
}

interface FormActionsProps {
  connected: boolean;
  saving: boolean;
  testing: boolean;
  activating: boolean;
  onTest: () => void;
  onSave: () => void;
  onSaveAndActivate: () => void;
}

function FormActions(props: FormActionsProps) {
  const busy = props.saving || props.testing || props.activating;
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={props.onTest}
        disabled={busy || !props.connected}
        className="gap-1.5"
        title={props.connected ? 'Test the saved credentials' : 'Save credentials first, then test'}
      >
        {props.testing ? <Loader2 className="size-3.5 animate-spin" /> : <Zap className="size-3.5" />}
        Test connection
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={props.onSave}
        disabled={busy}
        className="gap-1.5"
        variant="outline"
      >
        {props.saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save />}
        Save
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={props.onSaveAndActivate}
        disabled={busy}
        className="gap-1.5 bg-amber-600 text-white hover:bg-amber-600/90"
      >
        {props.saving || props.activating ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <CheckCircle2 className="size-3.5" />
        )}
        Save &amp; Activate
      </Button>
    </div>
  );
}

function TestResultBanner({
  ok,
  latencyMs,
  error,
}: {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}) {
  if (ok) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
        <CheckCircle2 className="size-4 shrink-0" />
        <span>
          <strong>Connection OK.</strong>{' '}
          {latencyMs != null ? `Latency ${latencyMs}ms.` : ''} Your credentials are valid.
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-300">
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div>
        <strong>Connection failed.</strong>{' '}
        {error ?? 'Could not verify credentials. Check the values and environment, then try again.'}
      </div>
    </div>
  );
}

// ─── Webhook row ─────────────────────────────────────────────────────

interface WebhookRowProps {
  label: string;
  description: string;
  relativeUrl: string;
  onCopy: (absoluteUrl: string) => void;
}

function WebhookRow(props: WebhookRowProps) {
  const [origin, setOrigin] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);
  const absolute = origin ? `${origin}${props.relativeUrl}` : props.relativeUrl;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{props.label}</p>
          <p className="text-[11px] text-muted-foreground">{props.description}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => props.onCopy(absolute)}
          className="gap-1.5"
        >
          <Copy className="size-3.5" /> Copy URL
        </Button>
      </div>
      <code className="block w-full overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-[11px]">
        {absolute}
      </code>
    </div>
  );
}

// ─── Onboarding guides (native <details>) ────────────────────────────

function PhonePeOnboardingGuide() {
  return (
    <details className="rounded-md border border-border bg-card/50 text-sm">
      <summary className="flex cursor-pointer items-center gap-1.5 p-3 font-medium text-amber-700 dark:text-amber-400">
        <ChevronDown className="size-4" /> How to get PhonePe Business credentials
      </summary>
      <div className="space-y-2 border-t border-border p-3 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">1.</strong> Sign up at{' '}
          <a
            href="https://business.phonepe.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-amber-700 underline dark:text-amber-400"
          >
            business.phonepe.com <ExternalLink className="size-3" />
          </a>{' '}
          and complete KYC.
        </p>
        <p>
          <strong className="text-foreground">2.</strong> Go to <em>Developers → API Keys</em>. Choose either
          v2 (OAuth2, recommended) or v1 (Standard, salt-based).
        </p>
        <p>
          <strong className="text-foreground">3.</strong> For <strong>v2</strong>: copy the <em>Client ID</em>,
          <em> Client Secret</em>, and <em>Merchant ID</em>. The Client Version is usually <code>1</code>.
        </p>
        <p>
          <strong className="text-foreground">4.</strong> For <strong>v1</strong>: copy the <em>Salt Key</em>{' '}
          (a long alphanumeric string) and note the <em>Salt Index</em> (usually <code>1</code>).
        </p>
        <p>
          <strong className="text-foreground">5.</strong> Choose <em>Sandbox</em> first. Test the connection,
          then switch to <em>Production</em> after PhonePe approves your account.
        </p>
        <p>
          <strong className="text-foreground">6.</strong> In the PhonePe dashboard, add the{' '}
          <em>Webhook URL</em> shown above (under <em>Developers → Webhooks</em>) so PrintShop receives
          payment-status callbacks.
        </p>
      </div>
    </details>
  );
}

function PaytmOnboardingGuide() {
  return (
    <details className="rounded-md border border-border bg-card/50 text-sm">
      <summary className="flex cursor-pointer items-center gap-1.5 p-3 font-medium text-amber-700 dark:text-amber-400">
        <ChevronDown className="size-4" /> How to get Paytm Business credentials
      </summary>
      <div className="space-y-2 border-t border-border p-3 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">1.</strong> Sign up at{' '}
          <a
            href="https://business.paytm.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-amber-700 underline dark:text-amber-400"
          >
            business.paytm.com <ExternalLink className="size-3" />
          </a>{' '}
          and complete merchant onboarding.
        </p>
        <p>
          <strong className="text-foreground">2.</strong> Go to <em>Developer Settings → API Keys</em>. You
          will find a <em>Test</em> (Sandbox) and a <em>Production</em> set of keys.
        </p>
        <p>
          <strong className="text-foreground">3.</strong> Copy the <em>Merchant ID</em> (MID) and{' '}
          <em>Merchant Key</em>.
        </p>
        <p>
          <strong className="text-foreground">4.</strong> The <em>Website</em> value is{' '}
          <code>WEBSTAGING</code> for sandbox and <code>DEFAULT</code> for production. PrintShop auto-fills
          this when you change the environment toggle.
        </p>
        <p>
          <strong className="text-foreground">5.</strong> Save the credentials, run <em>Test connection</em>,
          then <em>Save &amp; Activate</em> when the test passes.
        </p>
        <p>
          <strong className="text-foreground">6.</strong> In the Paytm dashboard, set the{' '}
          <em>Callback URL</em> shown above (under <em>Developer Settings → Callback URL</em>).
        </p>
      </div>
    </details>
  );
}
