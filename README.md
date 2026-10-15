# PrintShop SaaS

> QR-based print-shop management for the Indian market. Customers scan a
> shop-specific QR, upload files, configure print settings, and pay **directly
> to the shopkeeper's own UPI account** (0% commission). The platform charges
> the **shop** a flat SaaS subscription.

---

## What this is (Phase 1)

Phase 1 delivers the **foundation** of a production-grade, multi-tenant SaaS
built around one non-negotiable principle:

> **Every external dependency sits behind an adapter interface.** Swapping
> Supabase for self-hosted Postgres, Cloudflare R2 for AWS S3, or adding a new
> payment provider, is a one-line config change — zero business-logic edits.

This phase ships:

| Deliverable | Location |
| --- | --- |
| Domain models + Zod schemas | `packages/core/src/domain/` |
| Adapter interfaces (9 of them) | `packages/core/src/interfaces/` |
| Pure pricing engine + 35 unit tests | `packages/core/src/pricing/` |
| Shared helpers (INR currency, validation, dates, ids) | `packages/utils/` |
| Concrete adapter implementations (in-memory stubs + free-tier skeletons) | `packages/adapters/` |
| Database schema (Prisma mirror of §4) | `prisma/schema.prisma` |
| Local dev services (Postgres + Redis + MinIO + Mailpit) | `docker-compose.yml` |
| Full env reference | `.env.example` |
| Adapter-pattern deep-dive + swap walk-through | `ARCHITECTURE.md` |
| Package README | `packages/core/README.md` |

The interactive `/` route is a **live explorer** of this foundation: it renders
the architecture tree, the adapter swap matrix, and a working pricing
calculator that calls the **real** `priceFile()` engine (no mocks).

---

## Architecture (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BUSINESS LOGIC LAYER                            │
│  packages/core  — domain models · pricing engine · pure rules          │
│  (imports INTERFACES ONLY — never a concrete adapter)                  │
└─────────────────────────────────────────────────────────────────────────┘
                              ▲  ▲  ▲  ▲  ▲  ▲  ▲  ▲  ▲
                              │  │  │  │  │  │  │  │  │   depends on
┌──────────┐ ┌────────┐ ┌────┴──┴──┴──┐ ┌──┴──┴──┐ ┌──┴──┴──┐ ┌─────────┐
│ Database │ │Storage │ │  Payments   │ │Realtime│ │ Cache  │ │  Queue  │
│ Adapter  │ │Adapter │ │  Adapter    │ │Adapter │ │Adapter │ │ Adapter │
└────┬─────┘ └───┬────┘ └──────┬──────┘ └────┬───┘ └───┬───┘ └────┬────┘
     │           │             │              │         │          │
  ┌──┴───┐    ┌──┴───┐     ┌───┴────┐     ┌────┴───┐ ┌───┴────┐ ┌───┴────┐
  │Supabase   │ R2 / │     │PhonePe │     │Supabase│ │Upstash │ │QStash /│
  │Postgres   │ S3 / │     │Paytm   │     │Realtime│ │ Redis  │ │ BullMQ │
  │Neon       │ MinIO │     │UPI DL  │     │SocketIO│ │ Redis  │ │        │
  │in-memory  │in-mem │     │in-mem  │     │in-mem  │ │in-mem  │ │in-mem  │
  └────────┘  └──────┘     └────────┘     └────────┘ └────────┘ └────────┘
   selected by            selected by       selected by   selected by  selected by
   DATABASE_PROVIDER      STORAGE_PROVIDER  PAYMENT_*     REALTIME_*   QUEUE_*
```

The business layer is **structurally unable** to import a concrete adapter —
it only sees the interface. New providers plug in underneath without a single
edit to business logic.

---

## 5-minute quickstart

```bash
# 1. Install deps
bun install

# 2. (optional) bring up local Postgres + Redis + MinIO + Mailpit
docker compose up -d

# 3. Run the test suite (53 tests: pricing + repo + payments)
bunx vitest run

# 4. Start the web app
bun run dev
#   → open the Preview Panel on the right (port 3000)

# 5. (optional) start the realtime mini-service for the WebSocket dashboard
cd mini-services/realtime-service && bun --hot index.ts &

# 6. (optional) start a print-agent daemon (demo mode — no real printer)
cd mini-services/print-agent && PRINT_AGENT_DEMO=1 bun src/index.ts start

# 7. (optional) seed the demo shop standalone
bun run scripts/seed.ts

# 8. (optional) load test (needs k6 installed)
k6 run load-test.js --env BASE_URL=http://localhost:81
```

The `/` route shows **all seven phases live**:
- the **customer phone** (Phase 4) — mobile-framed upload→pay→status wizard;
- the **shop dashboard** (Phase 5) — WebSocket-driven queue + analytics + QR + settings;
- the **payments explorer** (Phase 3) — real PhonePe/Paytm signature verification round-trips;
- the **backend explorer** (Phase 2) — drive the full API lifecycle;
- the **observability & deploy** panel (Phase 7) — live health/metrics + a load-test runner;
- the **pricing calculator** (Phase 1) — calls the real `priceFile()` engine;
- the architecture diagram + adapter swap matrix.

---

## Adapter swap guide (one-line changes)

Every adapter is selected at boot by an env var. To swap, change **one** line
of `.env` and restart:

| Want to… | Change |
| --- | --- |
| Move off Supabase 500MB → self-hosted Postgres | `DATABASE_PROVIDER=postgres` + `DATABASE_URL_POSTGRES=…` |
| Add a second payment provider (Razorpay) | implement `RazorpayPaymentAdapter`, set `PAYMENT_PROVIDER=razorpay` |
| Outgrow Upstash 500K cmd/mo → ElastiCache | `CACHE_PROVIDER=redis` + `REDIS_URL=…` |
| Drop Resend for Postmark | implement `PostmarkEmailAdapter`, set `EMAIL_PROVIDER=postmark` |
| Self-host realtime past 200 concurrent | `REALTIME_PROVIDER=socketio` |

A full worked example (Supabase → self-hosted Postgres) is in
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Build order — ✦ all 7 phases shipped

| # | Phase | Status |
| --- | --- | --- |
| 1 | Foundation — core, utils, adapters interfaces, pricing engine, docker | ✅ |
| 2 | Backend core — composition root, JWT+PBKDF2 auth, repository layer, 20+ REST routes, presigned uploads | ✅ |
| 3 | Payments — PhonePe X-VERIFY + Paytm CHECKSUMHASH (real crypto), idempotent webhooks, 7 integration tests | ✅ |
| 4 | Customer web app — mobile-framed upload→pay→status wizard, live pricing, UPI QR | ✅ |
| 5 | Shop dashboard — socket.io mini-service, WebSocket-driven queue, analytics, QR + sticker PDF, settings | ✅ |
| 6 | Print agent — CLI daemon (setup/start/status/test-printer), device-token auth, disk queue, reconnect backoff | ✅ |
| 7 | Polish & deploy — /metrics + request logging + Sentry point, GitHub Actions CI, render.yaml + vercel.json + Dockerfile, k6 load test, seed, CHANGELOG | ✅ |

## Deploy

- **Web** (`/`): Vercel — `vercel.json` (security headers, BOM region). `vercel --prod`.
- **API + realtime + agent**: Render — `render.yaml` (three free-tier services). `render deploy --config render.yaml`.
- **Docker**: `docker build -t printshop-api .` (multi-stage Dockerfile).
- **CI**: `.github/workflows/ci.yml` runs typecheck + lint + test on every push; on `main`, pushes the Prisma schema to staging + seeds.
- **Load test**: `k6 run load-test.js --env BASE_URL=…` (targets 100 orders/min, p95 < 2s).
- **Sentry**: set `SENTRY_DSN` — the integration point in `toAppError` becomes live (swap the stub for `@sentry/node`).

See [`CHANGELOG.md`](./CHANGELOG.md) for the per-phase history.

---

## License

MIT — see [`LICENSE`](./LICENSE).
