import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Layers, ShieldCheck, Zap } from 'lucide-react';

const PRINCIPLES = [
  {
    icon: Layers,
    title: 'Adapter pattern everywhere',
    body: '9 interfaces in packages/core, concretes in packages/adapters. Business logic never imports a concrete.',
  },
  {
    icon: ShieldCheck,
    title: 'Zero commission, tenant-isolated',
    body: 'Money flows straight to the shopkeeper’s UPI. Every query is scoped by shopId from the JWT.',
  },
  {
    icon: Zap,
    title: 'All free tiers, swappable',
    body: 'Supabase → Postgres, R2 → S3, Upstash → Redis — each swap is one env-var line, zero logic edits.',
  },
];

export function Hero() {
  return (
    <header className="relative overflow-hidden border-b border-border bg-gradient-to-b from-amber-50/60 to-background">
      <div className="absolute inset-0 -z-10 opacity-[0.04] [background-image:radial-gradient(circle_at_1px_1px,currentColor_1px,transparent_0)] [background-size:22px_22px]" />
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">PHASE 7 · DEPLOY ✦ ALL 7 DONE</Badge>
          <Badge variant="secondary">Production-grade SaaS</Badge>
          <Badge variant="outline">India-first</Badge>
        </div>
        <h1 className="mt-5 text-4xl font-bold tracking-tight text-foreground sm:text-6xl">
          PrintShop <span className="text-amber-600">SaaS</span>
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground sm:text-xl">
          QR-based print-shop management for the Indian market. Customers scan, upload, configure,
          and pay <strong className="text-foreground">directly to the shopkeeper’s own UPI</strong> —
          0% commission. The platform charges the shop ₹499–₹1,499/mo.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700 ring-1 ring-emerald-200">
            <CheckCircle2 className="h-4 w-4" /> 53 tests + 7 phases shipped
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-700 ring-1 ring-amber-200">
            <CheckCircle2 className="h-4 w-4" /> metrics + CI + deploy configs
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 font-medium text-rose-700 ring-1 ring-rose-200">
            <CheckCircle2 className="h-4 w-4" /> live load-test runner
          </span>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div
              key={p.title}
              className="rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <p.icon className="h-5 w-5 text-amber-600" />
              <h3 className="mt-3 font-semibold text-foreground">{p.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
