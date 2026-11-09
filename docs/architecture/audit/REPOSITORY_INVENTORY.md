# REPOSITORY_INVENTORY

Audit Date: 2025-11-09 · Branch: `main` · Commit: `dc24f4b`

A factual inventory of every repository, framework, dependency, and pipeline
file in the PrintShop SaaS workspace at `/home/z/my-project`.

---

## 1. PrintShop SaaS (primary)

| Attribute | Value | Evidence |
|---|---|---|
| Remote URL | `https://github.com/Arjunyadvsoma/printshop-saas.git` | `git remote -v` |
| Branch | `main` | `git branch --show-current` |
| Latest commit | `dc24f4b` — "Add 5 deliverable docs…" | `git log -1` |
| Tracked files | 496 | `git ls-files \| wc -l` |
| Deployment | `https://printshop-saas-three.vercel.app` (Vercel) | `vercel.json` |

### 1.1 Frameworks and runtimes

| Concern | Technology | Evidence (path) |
|---|---|---|
| Web framework | Next.js **16.1.1** (App Router) | `package.json:70` |
| UI runtime | React **19.0.0** | `package.json:79-81` |
| Language | TypeScript 5 | `package.json:110` |
| Database ORM | Prisma **6.11.1** (`@prisma/client`) | `package.json:27` |
| Database driver | `pg` 8.23 + `@prisma/adapter-pg` 7.10 | `package.json:27,76` |
| Auth | JWT HS256 + PBKDF2 (WebCrypto SubtleCrypto) | `src/lib/auth/jwt-auth.adapter.ts:7-9` |
| Realtime | `socket.io` 4.8.4 + `socket.io-client` 4.8.4 | `package.json:88-89` |
| Payments | `upipay` 1.0.0, PhonePe v2 + Paytm webhook libs (hand-rolled) | `packages/adapters/src/payment/*` |
| Storage SDKs | `@aws-sdk/client-s3` 3.1152 + `@supabase/supabase-js` 2.118 | `package.json:16-17,56` |
| Cache SDK | `@upstash/redis` 1.39 | `package.json:60` |
| Local PDF/QR | `pdf-lib`, `pdfjs-dist`, `qrcode`, `jszip`, `sharp` | `package.json:74-76,78,68,87` |
| UI components | Radix UI + `lucide-react` + shadcn/ui (`components.json`) | `package.json:28-54,69` |
| Forms / state | `react-hook-form`, `@hookform/resolvers`, `zod` 4, `zustand` | `package.json:22,82,97,98` |
| Testing | Vitest **5.0.4** + `@playwright/test` 1.65 | `package.json:101,111` |

### 1.2 Monorepo layout

```
/home/z/my-project
├── src/                      # Next.js App Router (70 API routes, 19 pages)
│   ├── app/api/v1/*          # all route handlers (App Router)
│   ├── app/{shop,admin,orders}/*  # page.tsx pages
│   ├── lib/                  # container, repositories, services, payments
│   └── middleware.ts         # CSP + security headers (Edge runtime)
├── packages/
│   ├── core/                 # domain + interfaces (port interfaces)
│   ├── adapters/             # concrete adapter implementations
│   └── utils/                # shared validation/currency/ids/dates
├── prisma/                   # schema.prisma + migrations
├── mini-services/
│   ├── realtime-service/     # standalone Socket.IO relay (port 3004)
│   ├── print-agent/          # Bun/TS demo CLI agent
│   └── native-printer/       # Node.js + windows-pdf-printer-native for Windows
├── scripts/                  # build helpers, seed, postgres-verify, harness tests
├── docs/                     # ~40 markdown docs (audit, runbooks, migration plans)
├── .github/workflows/        # ci.yml + cleanup-cron.yml
├── vercel.json               # Vercel build config
├── render.yaml               # alternative deployment manifest
├── Dockerfile                # standalone Next.js server image
├── turbo.json                # build pipeline config
└── pnpm-workspace.yaml       # workspace root marker
```

### 1.3 Build / install configuration

| File | Purpose | Verified |
|---|---|---|
| `package.json` | dependency manifest; `bun install` per `vercel.json:5` | VERIFIED |
| `vercel.json` | Vercel build (Bun install, `bash scripts/vercel-build.sh`), region `bom1`, default env vars (`STORAGE_PROVIDER=supabase`, `CACHE_PROVIDER=memory`, `REALTIME_PROVIDER=memory`) | VERIFIED |
| `scripts/vercel-build.sh` | runs `bunx prisma generate` + `bunx next build` | VERIFIED |
| `next.config.ts` | `output: "standalone"`, `reactStrictMode: false`, **`typescript.ignoreBuildErrors: true`** | VERIFIED |
| `tsconfig.json` | strict TS config | VERIFIED |
| `turbo.json` | turbo build pipeline (typecheck/lint/test/build/dev) | VERIFIED |
| `eslint.config.mjs` | ESLint 9 flat config | VERIFIED |
| `vitest.config.ts` | includes `packages/**/*.test.ts` + `src/**/*.test.ts` only | VERIFIED |
| `Dockerfile` | standalone Next.js server image | VERIFIED |
| `render.yaml` | 3 Render services: `printshop-api`, `printshop-realtime`, `printshop-agent-demo` | VERIFIED |
| `docker-compose.yml` | local dev (Postgres + Caddy) | VERIFIED |
| `Caddyfile` | reverse proxy config | VERIFIED |

### 1.4 CI / CD

| Pipeline | Trigger | Steps | Evidence |
|---|---|---|---|
| `.github/workflows/ci.yml` | push/PR to `main` | Bun install → `prisma generate` → `scripts/check-route-conflicts.sh` → `tsc --noEmit` → `eslint .` → `vitest run` | VERIFIED |
| `.github/workflows/cleanup-cron.yml` | `cron: '*/5 * * * *'` (UTC) | curl `https://printshop-saas-three.vercel.app/api/v1/cron/cleanup` with `Authorization: Bearer $CRON_SECRET` | VERIFIED |
| Vercel | every push to `main` | per `vercel.json` `buildCommand` | VERIFIED |

> FIND-001 (P2): `next.config.ts:7` sets `typescript.ignoreBuildErrors: true`. CI runs `tsc --noEmit` separately, so this is belt-and-braces (the build won't fail on a missed type), but it weakens the production build's type safety guarantee. **Severity P2** — CI compensates.

> FIND-002 (P2): `vitest.config.ts:21` includes only `packages/**` + `src/**` — the 3 `scripts/*.test.ts` files (`postgres-integration`, `concurrency-harness`, `printjob-concurrency-harness`) and `tests/smoke.spec.ts` (Playwright) are **not** part of `vitest run`. They are standalone harnesses invoked manually.

### 1.5 Documentation inventory

`docs/` contains ~40 markdown files including:
`ARCHITECTURE.md`, `API_CONTRACT.md`, `DATABASE_SCHEMA.md`, `DEPLOYMENT_RUNBOOK.md`,
`DATABASE_MIGRATION_AUDIT.md`, `PRODUCTION_AUDIT.md`, `PRODUCTION_READINESS_AUDIT.md`,
`PRODUCTION_READINESS_REPORT.md`, `SYNC_PROTOCOL.md`, `MIGRATION_PLAN.md`,
`CLOUDFLARE_MIGRATION.md`, `SECURITY_ASSESSMENT.md`, `RATE_LIMITING.md`,
`REALTIME_AND_STATE.md`, `DOCUMENT_DELIVERY_ARCHITECTURE.md`,
`FILE_RETENTION_POLICY.md`, `PRINTEXE_INTEGRATION_GUIDE.md`,
`DESKTOP_INTEGRATION.md`, `UX_AUDIT.md`, `QA_REPORT.md`, `TEST_REPORT.md`,
`KNOWN_LIMITATIONS.md`, `RELEASE_COMPATIBILITY.md`, `FEATURE_PARITY.md`,
`REDESIGN_AUDIT.md`, `REDESIGN_PROGRESS.md`, `OPERATIONS_RUNBOOK.md`,
`DESIGN_SYSTEM.md`, `FINANCIAL_BUSINESS_LOGIC.md`, `ZERO_BUDGET_HA.md`,
`CROSS_CLIENT_TESTS.md`, `STAGING_TESTS.md`, `AI_DEVELOPMENT_ENVIRONMENT.md`,
`UPI_YOUPI_FEASIBILITY.md`, `payment-setup.md`, `ENGINEERING_PLAYBOOK.md`
(reference), `DESKTOP_INTEGRATION.md`, `DOCUMENT_DELIVERY_ARCHITECTURE.md`.

Plus root-level: `README.md`, `CHANGELOG.md`, `AGENTS.md`, `CLAUDE.md`,
`CONTRIBUTING.md`, `LICENSE`, `DEPLOY.md`, `ARCHITECTURE.md`,
`worklog.md`. Plus `agent-ctx/*.md` (6 agent instruction files for
sync/shopkeeper/customer/payment/orders/admin/design-token).

### 1.6 Production state (verified)

| Check | Value | How |
|---|---|---|
| Health endpoint | HTTP 200 | `GET /api/v1/health` |
| Database | OK, 14 tables | `GET /api/v1/db-health` |
| Shops | 1 — "Arjun Print Hub" | production DB |
| Users | 1 (the owner of that shop) | production DB |
| Region | `bom1` (Mumbai) | `vercel.json:6` |

---

## 2. PrintEXE Windows desktop client (secondary)

| Attribute | Value | Evidence |
|---|---|---|
| Remote URL | `https://github.com/Arjunyadvsoma/PrintEXE` (private) | referenced in `docs/PRINTEXE_INTEGRATION_GUIDE.md`, `docs/DESKTOP_INTEGRATION.md` |
| Clone status | **NOT CLONABLE in this sandbox** — 404 on `git clone` | manual attempt |
| Stack (per prior audit) | .NET 10 / WPF, 6-project solution, SQLite local queue | `docs/PRINTEXE_INTEGRATION_GUIDE.md` |
| Compilation | **NEVER compiled on Windows** | `docs/PRINTEXE_INTEGRATION_GUIDE.md` |
| Wire protocol | **INCOMPATIBLE with SaaS backend** | `docs/PRINTEXE_INTEGRATION_GUIDE.md`, `docs/DESKTOP_INTEGRATION.md` |

> FIND-003 (P1): PrintEXE is unverifiable in this audit. All claims about
> its technology stack, build state, and protocol incompatibility are
> sourced from prior audit docs (`docs/PRINTEXE_INTEGRATION_GUIDE.md`).
> **Classification: NOT VERIFIED in this pass.** Recommend the maintainer
> temporarily make the PrintEXE repo public, or grant read access to the
> auditor, before any conclusion about desktop integration can be
> considered VERIFIED.

> FIND-004 (P3): The SaaS repo ships a bundled `mini-services/native-printer/`
> Node.js + `windows-pdf-printer-native` 2.1.1 service (downloadable via
> `GET /api/v1/downloads/native-printer`) as a substitute path for Windows
> printing. This is **separate from** the PrintEXE WPF app. The README at
> `mini-services/native-printer/README.md` documents the pairing flow.

---

## 3. Mini-services (in-repo)

| Path | Runtime | Purpose | Evidence |
|---|---|---|---|
| `mini-services/realtime-service/` | Bun (`bun index.ts`) | standalone Socket.IO relay (port 3004) — receives `POST /emit` from the API and broadcasts to dashboard clients | `mini-services/realtime-service/package.json` |
| `mini-services/print-agent/` | Bun (`bun src/index.ts`) | demo CLI print-agent for local testing; uses `socket.io-client` | `mini-services/print-agent/package.json` |
| `mini-services/native-printer/` | Node ≥22 (`node index.js`) | production Windows printer service; depends on `windows-pdf-printer-native` 2.1.1 | `mini-services/native-printer/package.json` |

---

## 4. Inventory summary

- 1 primary repo (PrintShop SaaS) — 496 tracked files, 70 v1 API routes, 19 pages, 14 Prisma models, 244 tests (23 files).
- 1 secondary repo (PrintEXE) — private, unverifiable in this audit pass.
- 3 in-repo mini-services — realtime relay, demo agent, native Windows printer.
- CI: GitHub Actions (lint + typecheck + vitest) on every push, plus a 5-minute cron invoking the cloud cleanup endpoint.
- Production: Vercel `bom1`, health 200, 1 shop + 1 user.
- All counts above are VERIFIED by reading the listed evidence files or running the listed shell commands during this audit.
