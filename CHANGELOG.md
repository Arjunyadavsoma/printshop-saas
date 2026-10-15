# Changelog

All notable changes to PrintShop SaaS. Conventional Commits. The format is
based on [Keep a Changelog](https://keepachangelog.com/).

## [0.7.0] — Phase 7: polish & deploy

### Added
- `GET /api/v1/metrics` — platform metrics: orders/min, avg + p95 print time,
  payment success rate, active agents, totals (spec §11).
- Request-id propagation + structured request logging on every wrapped
  route (`X-Request-Id` header + JSON `{method, path, status, durationMs,
  requestId}` for Axiom/Logtail) (spec §11).
- Sentry integration point in `toAppError` (no-op without `SENTRY_DSN`;
  one-line swap for `@sentry/node` in production) (spec §11).
- `.github/workflows/ci.yml` — typecheck + lint + test + db-migrate on push/PR
  (spec §12).
- `render.yaml` — three-service free-tier deploy (API + realtime mini-service
  + demo print-agent) (spec §32).
- `vercel.json` — web deploy config with security headers (spec §32).
- `Dockerfile` — multi-stage container build (spec §32).
- `scripts/seed.ts` — standalone seed script (spec §13).
- `load-test.js` — k6 load test targeting 100 orders/min (spec §14).
- Phase 7 UI section on `/`: live health/ready, metrics dashboard, an
  in-browser load-test runner (real concurrent fetches → RPS + p95 + success),
  deploy-config preview.

### Changed
- README updated with the full 7-phase status + quickstart + deploy guide.
- `.env.example` documents the new env vars (SENTRY_DSN, REALTIME_*,
  PRINT_AGENT_*).

## [0.6.0] — Phase 6: print agent

### Added
- `mini-services/print-agent/` — Node/bun CLI daemon (setup/start/status/
  test-printer). socket.io client + disk queue + reconnect backoff; cross-
  platform print (`lp`/`pdf-to-printer` + demo mode).
- `withDeviceAuth` middleware + agent endpoints: register, token
  (device→JWT exchange), heartbeat, jobs/pending, jobs/:id/status
  (state-machine, first-claim-wins, realtime publish).
- `PrintAgentRepository`, `dispatchToAgent`, `GET /storage/get`.
- The print service now dispatches to the agent when one is online (in-process
  simulation stays as the offline fallback).

## [0.5.0] — Phase 5: shop dashboard

### Added
- `mini-services/realtime-service/` — socket.io server (port 3003) + HTTP
  /emit relay (3004), JWT-authed per-shop rooms.
- `SocketIoRelayRealtimeAdapter` concrete.
- Dashboard: live WebSocket-driven order queue, analytics (recharts), QR +
  sticker PDF, settings editor, agent management.

## [0.4.0] — Phase 4: customer web app

### Added
- Mobile-framed multi-step wizard (shop → upload → pay → status) with
  drag-drop multi-file upload, per-file settings, live pricing via the real
  `priceFile()` engine, UPI checkout + QR, token status polling.
- `GET /api/v1/dev/qr` — generic QR generator.

## [0.3.0] — Phase 3: payments

### Added
- PhonePe adapter (real X-VERIFY SHA-256 HMAC verify), Paytm adapter (real
  CHECKSUMHASH AES-128-CBC + SHA-256), UPI deep-link adapter.
- `PaymentAdapterRegistry`, `processWebhook` (audit-before-process, idempotent,
  UNIQUE-constraint replay guard), webhook routes, dev simulate routes.
- 7 payment integration tests (signed payloads, idempotency, tamper rejection).

## [0.2.0] — Phase 2: backend core

### Added
- Composition root + concrete adapter wiring (Prisma DB, in-memory
  storage/cache/queue/realtime, UPI payment, JWT auth, JSON logger).
- Repository layer (the only DB touchpoint, tenant-scoped).
- 20+ REST routes with Zod validation, JWT + role middleware, rate limiting.
- Presigned uploads + pdf-lib page parsing, print queue, PDF receipt.

## [0.1.0] — Phase 1: foundation

### Added
- `packages/core` — 9 adapter interfaces + domain models + pure pricing
  engine (35 unit tests).
- `packages/utils`, `packages/adapters` (in-memory concretes + free-tier
  skeletons), `docker-compose.yml`, `.env.example`, Prisma schema.
- `ARCHITECTURE.md` (adapter-pattern deep-dive + swap walk-through).
