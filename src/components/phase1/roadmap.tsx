import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Lock } from 'lucide-react';

interface Phase {
  n: number;
  title: string;
  items: string[];
  status: 'done' | 'next' | 'locked';
}

const PHASES: Phase[] = [
  {
    n: 1,
    title: 'Foundation',
    items: [
      'Monorepo scaffold',
      'packages/core: interfaces + pricing engine',
      'packages/utils + packages/adapters',
      'Docker compose + .env.example',
      'Domain schema + 35 pricing tests',
    ],
    status: 'done',
  },
  {
    n: 2,
    title: 'Backend core',
    items: ['Composition root + adapter wiring', 'JWT + PBKDF2 auth + role middleware', 'Repository layer (only DB touchpoint)', '20+ REST routes with Zod validation', 'Presigned uploads + pdf-lib page parse'],
    status: 'done',
  },
  { n: 3, title: 'Payments', items: ['PhonePe X-VERIFY (SHA-256 HMAC)', 'Paytm CHECKSUMHASH (AES-128-CBC)', 'Idempotent webhooks + audit-before-process', '7 integration tests (signed payloads)'], status: 'done' },
  { n: 4, title: 'Customer web app', items: ['Mobile-framed multi-step wizard', 'Drag-drop upload + per-file settings', 'Live pricing (real engine, client-side)', 'UPI checkout + QR handoff', 'Token status polling → ready'], status: 'done' },
  { n: 5, title: 'Shop dashboard', items: ['WebSocket order queue', 'Per-file print triggers', 'QR + sticker PDF', 'Analytics', 'Settings'], status: 'next' },
  { n: 6, title: 'Print agent', items: ['CLI daemon + setup wizard', 'WebSocket + disk queue', 'pdf-to-printer', 'Windows .exe via pkg'], status: 'locked' },
  { n: 7, title: 'Polish & deploy', items: ['Sentry + logging + health', 'GitHub Actions CI/CD', 'Vercel + Render deploy', 'Seed + demo shop', 'k6 load test'], status: 'locked' },
];

export function Roadmap() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">7-phase build order</h2>
      <p className="mt-2 max-w-3xl text-muted-foreground">
        Phases 1 and 2 are shipped and verified in-browser. Up next is Phase 3 (payments). Here’s the full roadmap so
        you can see where each deliverable lives in the bigger picture.
      </p>

      <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PHASES.map((p) => (
          <li
            key={p.n}
            className={`relative rounded-xl border p-4 transition-shadow ${
              p.status === 'done'
                ? 'border-emerald-300 bg-emerald-50/50 ring-1 ring-emerald-200'
                : p.status === 'next'
                  ? 'border-amber-300 bg-amber-50/40 ring-1 ring-amber-200'
                  : 'border-border bg-card'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Phase {p.n}
              </span>
              {p.status === 'done' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : p.status === 'next' ? (
                <Circle className="h-4 w-4 text-amber-600" />
              ) : (
                <Lock className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <h3 className="mt-1 font-semibold text-foreground">{p.title}</h3>
            <ul className="mt-2 space-y-1">
              {p.items.map((it) => (
                <li key={it} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-current" />
                  {it}
                </li>
              ))}
            </ul>
            {p.status === 'done' && (
              <Badge className="absolute -top-2 right-3 bg-emerald-600 text-white hover:bg-emerald-700">
                Shipped
              </Badge>
            )}
            {p.status === 'next' && (
              <Badge className="absolute -top-2 right-3 bg-amber-500 text-white hover:bg-amber-600">
                Up next
              </Badge>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
