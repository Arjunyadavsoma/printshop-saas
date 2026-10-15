import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Database, HardDrive, CreditCard, Radio, Gauge, ListChecks, Mail, MessageSquare, ScrollText, KeyRound } from 'lucide-react';

interface AdapterDef {
  name: string;
  icon: typeof Database;
  interface: string;
  freeTier: string;
  swapTo: string;
  envVar: string;
}

const ADAPTERS: AdapterDef[] = [
  { name: 'Database', icon: Database, interface: 'findOne · findMany · insert · update · delete · transaction', freeTier: 'Supabase Postgres (500MB)', swapTo: 'Self-hosted Postgres / Neon', envVar: 'DATABASE_PROVIDER' },
  { name: 'Storage', icon: HardDrive, interface: 'getPresignedUploadUrl · getPresignedDownloadUrl · delete · head', freeTier: 'Cloudflare R2 (10GB, 0 egress)', swapTo: 'AWS S3 / MinIO', envVar: 'STORAGE_PROVIDER' },
  { name: 'Payment', icon: CreditCard, interface: 'createPaymentIntent · verifyPayment · handleWebhook · refund', freeTier: 'PhonePe + UPI deep-link', swapTo: 'Paytm / Razorpay / Cashfree', envVar: 'PAYMENT_PROVIDER' },
  { name: 'Realtime', icon: Radio, interface: 'publish · subscribe · unsubscribe', freeTier: 'Supabase Realtime (200 conc.)', swapTo: 'Socket.IO / Pusher / Ably', envVar: 'REALTIME_PROVIDER' },
  { name: 'Cache', icon: Gauge, interface: 'get · set · del · incr · expire', freeTier: 'Upstash Redis (500K cmd/mo)', swapTo: 'Redis / ElastiCache', envVar: 'CACHE_PROVIDER' },
  { name: 'Queue', icon: ListChecks, interface: 'enqueue · process · schedule', freeTier: 'Upstash QStash', swapTo: 'BullMQ (self-hosted)', envVar: 'QUEUE_PROVIDER' },
  { name: 'Email', icon: Mail, interface: 'send', freeTier: 'Resend (3,000/mo)', swapTo: 'Postmark', envVar: 'EMAIL_PROVIDER' },
  { name: 'SMS', icon: MessageSquare, interface: 'send', freeTier: 'Stubbed in MVP', swapTo: 'MSG91 / Twilio', envVar: 'SMS_PROVIDER' },
  { name: 'Logger', icon: ScrollText, interface: 'debug · info · warn · error · child', freeTier: 'Pino → Axiom', swapTo: 'Sentry', envVar: 'LOGGER_PROVIDER' },
];

const DIAGRAM = `┌─────────────────────────────────────────────────────────────────────────┐
│                         BUSINESS LOGIC LAYER                            │
│  packages/core  — domain models · pricing engine · pure rules          │
│  (imports INTERFACES ONLY — never a concrete adapter)                  │
└─────────────────────────────────────────────────────────────────────────┘
                              ▲  ▲  ▲  ▲  ▲  ▲  ▲  ▲  ▲
                              │  │  │  │  │  │  │  │  │   depends on
        ┌──────────┐ ┌────────┐ ┌────────┐ ┌──────┐ ┌──────┐ ┌──────┐
        │ Database │ │Storage │ │Payment │ │Real- │ │Cache │ │Queue │
        │ Adapter  │ │Adapter │ │Adapter │ │ time │ │      │ │      │
        └────┬─────┘ └───┬────┘ └───┬────┘ └──┬───┘ └──┬───┘ └──┬───┘
             │           │          │         │       │       │
          ┌──┴───┐    ┌───┴───┐   ┌──┴────┐ ┌─┴────┐ ┌─┴────┐ ┌─┴────┐
          │ Supa- │    │ R2 /  │   │PhonePe│ │Supa- │ │Upstash│ │QStash │
          │ base  │    │ S3 /  │   │Paytm  │ │base  │ │Redis  │ │BullMQ │
          │ Neon  │    │ MinIO │   │UPI DL │ │Socket│ │       │ │       │
          │ in-mem│    │in-mem │   │in-mem │ │in-mem│ │in-mem │ │in-mem │
          └───────┘    └───────┘   └───────┘ └──────┘ └───────┘ └───────┘
   selected by DATABASE_*  STORAGE_*  PAYMENT_*  REALTIME_*  CACHE_*  QUEUE_*`;

export function ArchitectureExplorer() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-amber-600" />
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">The adapter pattern, visualised</h2>
      </div>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Business logic (top) depends on interfaces (middle) only. Concretes (bottom) are selected at
        boot by env vars. New providers plug in underneath without a single edit to business logic.
      </p>

      <Card className="mt-6 overflow-hidden border-border bg-[oklch(0.16_0_0)] text-[oklch(0.92_0_0)]">
        <pre className="overflow-x-auto p-4 text-[10px] leading-tight sm:text-xs sm:leading-tight">
          <code>{DIAGRAM}</code>
        </pre>
      </Card>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ADAPTERS.map((a) => (
          <Card key={a.name} className="border-border transition-shadow hover:shadow-md">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <a.icon className="h-4 w-4 text-amber-600" />
                  {a.name}Adapter
                </CardTitle>
                <Badge variant="outline" className="font-mono text-[10px]">
                  {a.envVar}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2.5 text-xs">
              <code className="block rounded bg-muted px-2 py-1.5 font-mono text-muted-foreground">
                {a.interface}
              </code>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                <span>
                  <span className="font-medium text-foreground">Free tier:</span> {a.freeTier}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                <span>
                  <span className="font-medium text-foreground">Swap to:</span> {a.swapTo}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
