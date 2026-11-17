import { CheckCircle2, FileCode2, FolderTree, Container, FileText, FlaskConical } from 'lucide-react';

const TREE = `printshop-saas/
├── packages/
│   ├── core/                      # domain + interfaces + pricing engine
│   │   └── src/
│   │       ├── domain/            # enums, Zod schemas, aggregates
│   │       ├── interfaces/        # 9 adapter contracts (the wall)
│   │       ├── pricing/           # priceFile() + 35 tests
│   │       └── errors/            # AppError hierarchy
│   ├── utils/                     # INR currency, validation, dates, ids
│   └── adapters/                  # concretes: supabase, r2, upstash, …
├── prisma/schema.prisma           # §4 domain model (Postgres-ready)
├── docker-compose.yml             # Postgres + Redis + MinIO + Mailpit
├── .env.example                   # every variable, documented
├── ARCHITECTURE.md                # adapter pattern + swap walk-through
└── README.md`;

const DELIVERABLES = [
  { icon: FolderTree, label: 'Monorepo structure', path: 'packages/{core,utils,adapters}' },
  { icon: FileCode2, label: '9 adapter interfaces', path: 'packages/core/src/interfaces' },
  { icon: FlaskConical, label: 'Pricing engine + 35 tests', path: 'packages/core/src/pricing' },
  { icon: FileCode2, label: 'Domain models + Zod schemas', path: 'packages/core/src/domain' },
  { icon: Container, label: 'Local dev services', path: 'docker-compose.yml' },
  { icon: FileText, label: 'Domain DB schema (§4)', path: 'prisma/schema.prisma' },
  { icon: FileText, label: 'Env reference', path: '.env.example' },
  { icon: FileText, label: 'Architecture docs', path: 'README.md · ARCHITECTURE.md · packages/core/README.md' },
];

export function Deliverables() {
  return (
    <section className="border-y border-border bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Phase 1 deliverables</h2>
        <p className="mt-2 max-w-3xl text-muted-foreground">
          Everything below exists on disk and is verified by the test suite. The directory tree is
          the actual layout you can explore.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="overflow-hidden rounded-xl border border-border bg-[oklch(0.16_0_0)]">
            <div className="border-b border-white/10 px-4 py-2 text-xs font-medium text-white/60">
              printshop-saas/
            </div>
            <pre className="overflow-x-auto p-4 text-[11px] leading-relaxed text-[oklch(0.88_0_0)]">
              <code>{TREE}</code>
            </pre>
          </div>

          <ul className="space-y-2.5">
            {DELIVERABLES.map((d) => (
              <li
                key={d.label}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3.5"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-foreground">
                    <d.icon className="h-4 w-4 text-amber-600" />
                    {d.label}
                  </p>
                  <code className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                    {d.path}
                  </code>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
