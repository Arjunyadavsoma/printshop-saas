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

# 3. Run the pricing test suite (35 tests)
cd packages/core && bunx vitest run && cd ../..

# 4. Start the web app
bun run dev
#   → open the Preview Panel on the right (port 3000)
```

The `/` route shows:
- the architecture diagram above, live;
- the **adapter swap matrix** (every interface + its concretes);
- a **working pricing calculator** that calls the real `priceFile()` engine and
  renders the line-item breakdown.

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

## Build order (the 7-phase plan)

This repo implements **Phase 1** only. The remaining phases land in order:

1. ✅ **Foundation** — core, utils, adapters interfaces, pricing engine, docker
2. ⏳ Backend core — Fastify, auth, repository layer, order/file endpoints
3. ⏳ Payments — PhonePe/Paytm/UPI concretes, webhooks, idempotency
4. ⏳ Customer web app — upload UI, live pricing, checkout, status polling
5. ⏳ Shop dashboard — WebSocket queue, print triggers, QR, analytics, settings
6. ⏳ Print agent — CLI daemon, WS client, pdf-to-printer, .exe packaging
7. ⏳ Polish & deploy — Sentry, CI/CD, Vercel/Render, seed script, load test

---

## License

MIT — see [`LICENSE`](./LICENSE).
