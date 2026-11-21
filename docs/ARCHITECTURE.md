# PrintShop — Architecture (v2, product build)

> Scope of this revision: the QR-based print ordering product (customer flow,
> shopkeeper operations, document pipeline, print planner, dispatcher +
> simulator). It supersedes the v1.0 audit-era architecture document; the
> device/companion contract and existing models are preserved unchanged.

**Status:** v2.0 — 2026-11-21 (Phase 0 of the product build).

---

## 1. System map

```
                    ┌─────────────────────────────────────────────────┐
                    │                printshop-saas (Next.js)         │
   customer phone   │  /s/[shopSlug]  /o/[token]        route handlers│
  ─────────────────▶│  upload → pipeline → planner → quote → order    │
                    │        │                                        │
   shopkeeper PC    │  /shop/*  board · order detail · payments ·     │
  ─────────────────▶│  printers · pricing · settings · reports        │
                    │        │                ┌──────────────────┐    │
                    │  /api/v1/* ─────────────▶│ realtime service │    │
                    │  (customer/shop/device)  │ (Socket.IO, rooms│    │
                    │        │                │  shop:{id},      │    │
                    │  /api/v1/agents/*       │  order:{token})  │    │
                    │        │                └────────┬─────────┘    │
                    │  document pipeline worker               │      │
                    │  (normalize → thumbnails → inkcov)      │      │
                    └────────┼─────────────────────────────────┼──────┘
                             │                 job.dispatch    │
                             ▼                                 ▼
                    ┌────────────────┐                ┌──────────────────┐
                    │ PostgreSQL     │                │ PrintEXE agents  │
                    │ (Prisma)       │                │ (Windows, real)  │
                    └────────────────┘                └──────────────────┘
                             ▲                                 ▼
                    ┌────────────────┐                ┌──────────────────┐
                    │ StorageProvider│◀───────────────│ SimulatorAgent   │
                    │ (local disk /  │  signed URLs   │ (this repo, dev) │
                    │  S3/R2/Supabase│                │ /tmp/simulated-  │
                    └────────────────┘                │ output           │
                                                      └──────────────────┘
```

The web app stays the authoritative backend (as in v1). The realtime
mini-service is unchanged (`mini-services/realtime-service`, port 3001,
shared `JWT_ACCESS_SECRET`). The document pipeline worker is a library run
in-process by route handlers plus a cron entry — no new service process is
required for dev; a Dockerfile for the worker with LibreOffice/Ghostscript
documents the production packaging.

## 2. Module boundaries (src/lib)

| Module | Role | Notes |
|---|---|---|
| `lib/printing/planner.ts` | **PrintPlanner** — pure function: spec + shop rules + printers → PrintPlan (tasks, pricing breakdown, collation guide, warnings). No IO. | 100% unit tested (§5.3 matrix). |
| `lib/pricing/price-engine.ts` | Price computation from PriceRule slabs + add-ons + urgent. Integer paise only. Server-only. | Extends the existing price-file engine; PriceRule-table backed with legacy `pricingConfig` fallback. |
| `lib/pipeline/normalize.ts` | PDF validation; images→PDF (sharp); DOCX/PPTX/XLSX→PDF (LibreOffice `soffice --headless` — REAL in this environment). | Ghostscript `gs` + `pdfinfo` present — real conversion, real ink coverage. |
| `lib/pipeline/color-suggest.ts` | Per-page color suggestion via Ghostscript `inkcov` (real CMYK coverage per page). Fallback: content-stream heuristic. | Suggestion only; customer decides. |
| `lib/pipeline/thumbnails.ts` | Page PNGs via pdftoppm (poppler) — real render. | Stored via StorageProvider. |
| `lib/pipeline/task-pdf.ts` | Builds per-task PDFs with pdf-lib (N-up imposition, blank-page duplex padding, assembly slip, receipt). | Pure where possible; file IO behind StorageProvider. |
| `lib/orders/state-machine.ts` | Order + task status machine. Illegal transitions rejected server-side. | Append-only OrderEvent timeline written on every transition. |
| `lib/payments/upi.ts` | `upi://pay?...` intent builder (VPA validation), UTR validation, PaymentVerifier adapter interface (MANUAL default). | Never claims verification. |
| `lib/dispatch/dispatcher.ts` | PrintDispatcher interface: CompanionDispatcher (existing socket contract) + SimulatorDispatcher (fake agent). | One (taskId, attempt) dispatch; UNCERTAIN never auto-retried. |
| `lib/i18n` | next-intl catalogs en/hi/te. | All customer+shopkeeper strings through the catalog. |

Existing modules preserved unchanged: auth (pbkdf2 + JWT + roles),
payments (PhonePe PSP flow — coexists with the new direct-UPI flow),
storage adapters, delivery-coordinator, device contract routes.

## 3. Contracts

### 3.1 Device contract (UNCHANGED, extended backward-compatibly)
pair / heartbeat / jobs pending / claim / received / commands — all existing
routes keep their shapes. Extensions (additive only):
- `GET /agents/jobs/pending` payload rows gain `taskId` (= PrintJob id),
  `taskPdfSha256`, `sheetCount`, `duplex`, `colorMode`, `paperSize`,
  `orientation`, `scale`, `setLabel`, `orderShortId`, `attempt`.
  Unknown fields are ignored by older companions.
- New socket event `job.dispatch` payload = same task DTO (event already
  exists in the contract; the payload fields are additive).
- `POST /agents/jobs/:id/status` accepts `uncertain` and `spooled` with
  `jobId`; idempotent on (taskId, attempt); never marks PRINTED without
  spooler confirmation → UNCERTAIN surfaces to the shopkeeper.

### 3.2 Customer contract (new)
- `POST /api/v1/orders/quote` — spec + pageModes → itemized paise breakdown.
- `POST /api/v1/orders` — create order (server recomputes price; client
  total must match or "prices changed" is returned).
- `POST /api/v1/orders/:token/payment` — submit UTR (+ screenshot).
- `GET /api/v1/orders/:token` — tracking timeline (no login).
- `POST /api/v1/orders/:token/cancel` — only before PRINTING.
- Upload: `POST /api/v1/s/{slug}/uploads/init|chunk|complete` (resumable,
  chunked), `GET /api/v1/s/{slug}/files/:id` (status).

### 3.3 Shopkeeper contract (new, session-auth)
`/api/v1/shops/me/...` — orders (list/detail/transition actions), payments
(confirm/reject/bulk), printers CRUD + commands, price-rules, add-ons,
settings, reports, customers, audit. OPERATOR role cannot mutate pricing,
UPI, staff, or delete data.

## 4. State machines (enforced server-side)

### Order
```
DRAFT → AWAITING_PAYMENT → PAYMENT_SUBMITTED → PAID → QUEUED → PRINTING
      → PARTIALLY_PRINTED → READY → COLLECTED
side exits: CANCELLED (before PRINTING) · FAILED (attention needed)
            · EXPIRED (unpaid 30 min)
PRINT_THEN_PAY shops: DRAFT → QUEUED → PRINTING → READY → PAID_ON_PICKUP
            → COLLECTED
```
READY requires ALL tasks PRINTED. Every transition writes an OrderEvent.

### PrintTask (= PrintJob row, device contract)
```
PENDING → DISPATCHED → RECEIVED → PRINTING → SPOOLED → PRINTED
        → UNCERTAIN (no spooler confirmation before timeout)
        → FAILED (retry ⇒ attempt+1 only on safe failure or shop approval)
        → CANCELLED
```

## 5. Storage key layout (StorageProvider, signed URLs, HMAC + expiry)

```
shops/{shopId}/orders/{orderId}/orig/{fileId}.{ext}      original upload
shops/{shopId}/orders/{orderId}/pdf/{fileId}.pdf         normalized PDF
shops/{shopId}/orders/{orderId}/tasks/{taskId}.pdf       per-task PDF
shops/{shopId}/orders/{orderId}/thumbs/{fileId}/{n}.png  page thumbnails
shops/{shopId}/orders/{orderId}/pay/{fileId}.png         payment screenshot
shops/{shopId}/posters/{slug}-{lang}.pdf                 QR posters
```
Retention: default 24 h after collection (shop-configurable, max 7 days)
via the existing FileCleanupTask + cron route; originals deleted at
conversion completion.

## 6. Security invariants
- Every shop-scoped query filters by shopId (tenant isolation tests).
- Files only via short-lived signed URLs; magic-byte + MIME checks;
  filename sanitization; 50 MB/file, 200 MB/order.
- Rate limits on upload/quote/order/payment endpoints.
- httpOnly session cookies; CSRF on mutations; strict CSP; no secrets in
  logs (device-token redactor already wired).
- Money: integer paise end-to-end; server-side computation only.

## 7. Simulators & honest labels
| Simulator | Where | Label |
|---|---|---|
| SimulatorAgent (fake device: accepts tasks, random delays, fail/offline/latency controls, writes PDFs to /tmp/simulated-output) | `mini-services/simulator-agent` + `/dev/simulator` panel (dev-only) | SIMULATED DEVICE |
| Console OTP | `lib/notifications` adapters | DEV OTP |
| Real printers | none — needs Windows + PrintEXE (MANUAL-TESTING.md) | NOT SIMULATED HERE |
| UPI payment verification | shopkeeper confirmation only (PaymentVerifier MANUAL) | VERIFICATION IS MANUAL |

## 8. Run commands (dev)
```bash
docker compose up -d postgres           # or the existing dev DB on :5433
bun install
bun run db:migrate && bun run db:seed
bun run dev                             # Next on :3000
bun run realtime                        # Socket.IO on :3001
bun run sim                             # simulator agent on :3999
bun run test && bun run typecheck && bun run lint
```

## 9. Testing matrix
- Unit: planner, price engine, range parser, state machine, UPI builder,
  signed URL, tenant isolation.
- Integration: upload→convert→quote→order→pay→confirm→dispatch→printed→
  ready→collected (test DB).
- E2E: Playwright mobile+desktop full journey; payment rejected→resubmit;
  printer fail→reroute; shop closed; Hindi smoke; axe a11y checks.
- Load sanity: 50 concurrent quotes on a 200-page PDF.
- CI: typecheck + lint + tests.
