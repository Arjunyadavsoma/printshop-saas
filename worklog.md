# PrintShop SaaS — Build Worklog

This file is the single shared worklog across all agents. Each agent appends
(never overwrites). Sections start with `---`.

---
Task ID: 1
Agent: orchestrator (main)
Task: Phase 1 foundation — monorepo scaffold, packages/core (interfaces + pricing engine + tests), packages/utils, packages/adapters, docker-compose, .env.example, README/ARCHITECTURE/LICENSE/CONTRIBUTING, Prisma schema mirror of §4.

Work Log:
- Created monorepo-style package tree: packages/core/{domain,interfaces,pricing,errors}, packages/utils/src, packages/adapters/{database,storage,cache,realtime,queue,email,sms,logger,payment}.
- packages/core: domain enums + Zod schemas (Shop, User, Order, PrintFile, PrintJob, Subscription, AuditLog); 9 adapter interfaces (database, storage, payment, realtime, cache, queue, email, sms, logger, auth); pure pricing engine split into types/resolve-rate/breakdown/pricing-engine with round-half-up paise math, duplex + bulk + min-order rules; AppError hierarchy; barrel exports.
- Installed vitest; wrote 35 unit tests for the pricing engine (round-half-up, rate fallback ladder, base/duplex/bulk/min-order boundary, colour & paper variants, mixed scenarios, invalid input). ALL 35 PASSING.
- packages/utils: INR currency helpers (formatINRFromPaise/parseINRToPaise/addPaise), Zod validation schemas (Indian phone, UPI VPA, shop slug, order token, upload request), dates, ids (uuid, generateOrderToken with unambiguous alphabet, storageKey).
- packages/adapters: in-memory concretes (Database/Storage/Cache/Realtime/Queue) + stubs (Email/SMS/Logger) that actually work for tests; free-tier skeletons (SupabaseDatabaseAdapter, R2StorageAdapter, UpstashCacheAdapter, PhonePePaymentAdapter, UpiDeepLinkPaymentAdapter) that satisfy the interfaces and are wired in later phases.
- Prisma schema (prisma/schema.prisma) mirrors §4 of the spec — shops, users, orders, files, print_jobs, print_agents, subscriptions, audit_logs — with the UNIQUE(paymentTxnId) replay-prevention constraint and paise Int money.
- docker-compose.yml: Postgres 16 + Redis 7 + MinIO + Mailpit for local dev.
- .env.example documents every variable grouped by adapter, with the swap matrix.
- README.md (root), packages/core/README.md, ARCHITECTURE.md (adapter pattern deep-dive + Supabase→Postgres worked example), LICENSE (MIT), CONTRIBUTING.md.
- turbo.json + pnpm-workspace.yaml reference monorepo config.
- Added @platform/core, @platform/utils, @platform/adapters path aliases to tsconfig.json.

Stage Summary:
- Phase 1 deliverables complete and verified: 35/35 pricing tests pass.
- Architecture invariant (business logic never imports concretes) is structurally enforced by the package dependency direction.
- Next: build the interactive / route demo (architecture explorer + live pricing calculator using the real engine) and verify end-to-end with Agent Browser.

---
Task ID: 1-verify
Agent: orchestrator (main)
Task: End-to-end self-verification of the Phase 1 / route via Agent Browser, plus lint + tests.

Work Log:
- Installed vitest; pricing suite: 35/35 tests pass (round-half-up, rate fallback ladder, base/duplex/bulk/min-order boundaries, colour & paper variants, mixed scenarios, invalid input).
- Built interactive / route: Hero, live PricingCalculator (client component importing the REAL priceFile() from @platform/core), ArchitectureExplorer (ASCII diagram + 9 adapter cards), AdapterMatrix (6 swap scenarios, all "0 lines" edited), Deliverables (tree + checklist), Roadmap (7 phases), sticky SiteFooter.
- Started Next dev server (port 3000) fully detached with setsid + direct next binary (the package.json dev script's `tee` pipe was killing the process on shell exit).
- Agent Browser verification through the Caddy gateway (port 81 → 3000):
  * Page title: "PrintShop SaaS — QR-based print shop management for India" ✓
  * All sections render (hero, calculator, architecture diagram, swap matrix, deliverables, roadmap, footer) ✓
  * No page errors / no console errors ✓
  * Live pricing calculator golden path (calls the real engine, recomputes on every input change):
      - Default 5 B&W A4 → ₹10.00 (5×₹2)
      - Pages=100 B&W → ₹190.00 (100×₹2 − 5% bulk)
      - + Duplex → ₹171.00 (₹190 − 10% duplex)
      - + Colour → ₹513.00 (100×₹6=₹600 −₹60 duplex −₹27 bulk)
    Line items confirmed: "Print (Colour, A4) 100 × ₹6.00 = ₹600.00 | Duplex discount −₹60.00 | Bulk discount −₹27.00"
    Badges: "pages×copies = 100 · duplex applied · bulk applied"
- BUG FOUND via browser verification: the calculator's reconciliation used `addPaise` (which rejects negatives) on line items that include negative discount rows → React render crash → "NO TOTAL" once discounts appeared. Fixed by switching to a plain integer sum (the engine itself was never wrong). Re-verified: all four states now correct.
- Lint: 1 error (no-this-alias in StubLoggerAdapter.child) → fixed with lexical arrow capture → eslint clean.
- Responsive: mobile (390×844) and desktop (1440×900) both render; footer pushed down naturally on long content (bottom=9270px > viewport), sticky structure (min-h-screen flex flex-col + mt-auto) in place.
- Screenshots captured: /tmp/phase1-desktop.png (640KB full), /tmp/phase1-final.png (587KB colour+duplex+bulk state).

Stage Summary:
- Phase 1 fully shipped and browser-verified. 35/35 pricing tests pass, eslint clean, dev server serves GET / 200 with no runtime/hydration errors, and the live pricing calculator demonstrably calls the real @platform/core engine and recomputes correctly across base → bulk → duplex → colour transitions.
- One real bug caught and fixed by the self-verification loop (exactly its purpose).
- Ready for the user's review before proceeding to Phase 2.

---
Task ID: 2
Agent: orchestrator (main)
Task: Phase 2 — Backend core. Composition root + adapter wiring, JWT+PBKDF2 auth + role middleware, repository layer (only DB touchpoint, tenant-scoped), 20+ REST routes with Zod validation, presigned uploads + pdf-lib page parse, print queue, live backend explorer on /.

Work Log:
- Foundation: ApiEnvelope ({success,data,error}) + AppError→envelope normaliser; JsonConsoleLogger (pino-shape to stdout); JwtAuthAdapter (HS256 via Web Crypto + PBKDF2-SHA256 600k-iter password hashing + refresh-token rotation with jti revocation via CacheAdapter); rate-limit (fixed-window via CacheAdapter.incr+expire); PrismaDatabaseAdapter (table-agnostic over Prisma client, keeps Prisma's type marshalling, swappable to Postgres/Drizzle).
- Composition root (src/lib/container.ts): selects concretes from env vars; wires real working concretes (Prisma db, in-memory storage/cache/queue/realtime, UPI deep-link payment, JWT auth, JSON logger). Stored on globalThis so in-memory adapters survive across Next.js dev route-module instances (critical fix — without it, bytes PUT to storage vanished before the confirm step).
- Repository layer: BaseRepository + Shop/User/Order/File/AuditLog/PrintJob repos — the ONLY layer importing the db adapter. Tenant scoping enforced (findByIdAndShop, updateByShop return null on cross-tenant access — proven by repo tests). JSON-field marshalling (pricingConfig, paymentCredentials, metadata) handled at the repo boundary.
- API middleware: withAuth (verifies JWT, loads principal, enforces roles + stale-token shop-scope check), withRateLimit, withHandle.
- Auth routes: POST /auth/login (rate-limited, issues access+refresh, audits), POST /auth/refresh (rotates jti), GET /me.
- Shop-owner routes: GET/PATCH /shops/me, GET /shops/me/orders (paginated+filterable), GET /shops/me/orders/:id (with files), POST .../print, POST .../complete (deletes storage blobs), GET /analytics (revenue/status-mix/popular-settings/peak-hour), GET /qr (real QR via qrcode lib, PNG data URL + SVG).
- Public customer routes: GET /shops/:slug (pricing + privacy policy), POST /shops/:slug/orders (generates unambiguous order token), POST /orders/:id/files/upload-url (presigned, mime+size validated), POST /orders/:id/files (confirms via storage.head + pdf-lib page count), PATCH /orders/:id/files/:fileId (recomputes via the REAL priceFile engine + reprices order total), POST /orders/:id/checkout (real upi:// URI via UpiDeepLinkPaymentAdapter), GET /orders/:id/status, GET /orders/:id/receipt (real PDF via pdf-lib).
- Support routes: PUT /storage/put (in-process upload receiver for the in-memory storage so the full flow works without a cloud bucket — documented as production-N/A), POST /dev/seed (idempotent demo shop+owner), POST /dev/orders/:id/mark-paid (dev-only PSP webhook simulation), GET /payments/upi/verify/:orderId, GET /health, GET /ready.
- Print queue: ensurePrintHandler() registered lazily; InMemoryQueueAdapter dispatches async (setTimeout 0) so it behaves like a real queue; handler simulates printing (1.5s) → file completed → maybeMarkOrderReady flips the order to ready. Fixed an ordering bug where the print route set status=printing AFTER the synchronous handler had already set ready.
- vitest.config.ts with regex path aliases so @platform/* and @/ resolve under vitest.
- 11 repository unit tests (in-memory adapter): round-trip, findBySlug, update pricing JSON, getByOwner NotFound, tenant isolation (cross-tenant read returns null, cross-tenant update is a no-op), status filter, count, verifyCredentials. All 11 pass. Total 46 tests (35 pricing + 11 repo).
- Phase 2 BackendExplorer UI on /: 8 guided steps (create order → upload → settings → checkout → mark-paid → print → complete → analytics/QR) + a live request-log console + order-detail table. Auto-seeds + logs in on mount.
- Prisma schema fix: added Shop.printJobs back-relation, removed dangling Order.printJobs (FK validation).

Bugs found & fixed during self-verification (exactly the point of the loop):
- envelope.ts file never written after the dir-creation retry → routes 500'd with module-not-found. Fixed by creating the file.
- Seed created the user with shopId='__pending__' (a fake string) which violated the Shop FK → changed to null, then update to the real id after the shop row exists.
- Container singleton wasn't shared across Next.js dev route-module instances → in-memory storage lost bytes between PUT and confirm → fixed by storing the container on globalThis.
- QR route read `format` from path params but it's a query param → fixed to req.nextUrl.searchParams.
- Print route set order=printing AFTER the synchronous queue handler had already set ready (clobbering it) → fixed by setting status before dispatch + making the queue dispatch async.

End-to-end verified via curl through the gateway (one bash call so the dev server stays up):
seed→login→create→upload→confirm(pdf-lib:1 page)→patch(pricing engine: 2×₹6 colour A4, duplex 10% off = ₹10.80)→checkout(real upi:// URI)→mark-paid→print(queue dispatched)→poll(order→ready, file→completed)→complete(collected)→analytics(revenue ₹10.80, collected=1). All 20+ routes return 200 with correct data.
Agent Browser verified the UI: auto-seed+login on mount → "auth token acquired" + "quickprint@okaxis" badges → clicking "POST /shops/quickprint/orders" creates the order and the badge updates to "order 2HV6Y7 · awaiting_payment". No console errors.

Stage Summary:
- Phase 2 backend fully shipped and verified end-to-end. 46 tests pass, eslint clean, dev server serves GET / 200 and all /api/v1/* routes return correct JSON envelopes.
- Architecture invariant holds: routes import repos, repos import the DatabaseAdapter interface, the composition root is the only place concretes are constructed. Swapping Prisma→Postgres or UPI→PhonePe is a one-line env change.
- Ready for Phase 3 (payments: PhonePe/Paytm concretes + webhook signature verification + idempotency).

---
Task ID: 3
Agent: orchestrator (main)
Task: Phase 3 — Payments. PhonePe X-VERIFY (SHA-256 HMAC) + Paytm CHECKSUMHASH (AES-128-CBC + SHA-256) adapters with REAL signature crypto, idempotent webhook handlers (audit-before-process), PaymentAdapterRegistry for per-shop provider routing, integration tests with signed payloads, dev simulate routes for visible round-trips, PaymentsExplorer UI on /.

Work Log:
- Split the Phase-2 payment adapters into 3 files in packages/adapters/src/payment/: phonepe.adapter.ts (real X-VERIFY: sha256(base64(body)+path+salt)###idx, constant-time compare, base64-payload decode), paytm.adapter.ts (real CHECKSUMHASH: AES-128-CBC over sha256(sorted params+'|'+merchantKey), base64; HTML response page), upi-deeplink.adapter.ts (UPI deep-link, extracted from the old combined file). Exported generatePaytmChecksum for the simulate route to sign.
- PaymentAdapterRegistry (src/lib/payments/registry.ts): holds all 3 concretes, routes by PaymentProvider. Adding Razorpay/Cashfree later = register + one env line.
- Container: added paymentRegistry (alongside the default `payment` for back-compat). All 3 adapters registered.
- webhook.service.ts (processWebhook): the spec's §6 pipeline — (1) audit-log the raw payload BEFORE processing, (2) extract the untrusted merchantOrderId → lookupPaymentSession (stored at checkout via rememberPaymentSession, keyed by merchantOrderId in the CacheAdapter, 10-min TTL), (3) load shop → credentials, (4) adapter.handleWebhook (REAL crypto verify), (5) idempotency check (pay:done:<txnId> in cache, 24h), (6) validate amount + tenant + state transition, (7) flip order to paid (paymentTxnId has a UNIQUE constraint = final replay guard; a duplicate throws → caught → idempotent), (8) mark processed + audit, then auto-dispatch to print.
- Refactored BaseRepository to resolve the adapter lazily from the container (get adapter() { return getContainer().db; }) instead of capturing it at construction — so tests can setContainerForTesting(in-memory) and the singleton repos pick it up. Updated the repos factory + Phase-2 repo tests accordingly.
- Webhook routes: POST /payments/phonepe/webhook (X-VERIFY), POST /payments/paytm/callback (CHECKSUMHASH, renders HTML). Both unauthenticated but signature-verified + idempotent.
- Dev simulate routes: POST /payments/dev/phonepe/simulate + /paytm/simulate — sign a payload with the shop's dev key and feed it through the REAL processWebhook pipeline (sign→verify→idempotent-flip) in-process.
- Updated checkout route to route via the registry to the shop's configured provider + rememberPaymentSession(merchantOrderId, {orderId,shopId,amountPaise,provider}).
- Seeded the demo shop with dev paymentCredentials (phonepe salt + paytm merchant key from env w/ dev defaults); back-compat refresh for Phase-2-seeded shops.
- vitest.config.ts regex aliases already handle @platform/*; payments.test.ts uses setContainerForTesting(InMemory) so the singleton repos resolve to the in-memory db.
- Integration tests (src/lib/payments/payments.test.ts, 7 tests): PhonePe valid sig → order paid; PhonePe tampered → 401 + order stays awaiting_payment; PhonePe idempotency (same txnId twice → #2 no-op); PhonePe wrong salt index → 401; PhonePe FAILED state → order stays awaiting_payment; Paytm valid checksum → order paid + HTML; Paytm tampered amount → checksum fails → 401. ALL 7 PASS. Total 53 tests (35 pricing + 11 repo + 7 payments).
- Phase 3 PaymentsExplorer UI on /: provider switcher (PhonePe/Paytm), "Create priced order" (valid minimal PDF → pdf-lib parses 1 page → priced ₹10.80 → checkout), "Simulate webhook #1/#2" buttons that exercise the real sign→verify→idempotent round-trip, round-trip detail card, live request-log console.
- Updated Hero badge → PHASE 3 · PAYMENTS, badges → 53 tests + 3 payment adapters + idempotent webhooks; Roadmap marks Phase 3 done, Phase 4 (customer web app) next.

Bugs found & fixed during self-verification:
- PhonePe X-VERIFY: initially double-base64'd (btoa(rawBody)) — fixed to sign the base64 payload directly (sha256(rawBody + path + salt)).
- The Phase-2 `repos` singleton captured the db adapter at construction → setContainerForTesting wouldn't re-route it → refactored BaseRepository to lazy resolution.
- UI's prepareOrder used an invalid PDF blob → confirm set needs_review → checkout failed → "session expired" on simulate. Fixed to a valid minimal 1-page PDF (pdf-lib parses → pageCount=1).
- Idempotency banner misfired on error responses → tightened to require statusCode<300.

End-to-end verified via curl through the gateway (one call):
order create → upload → confirm(pdf-lib:1 page) → patch(₹10.80) → checkout → PhonePe #1 [200 applied=True "order marked paid via phonepe (txn …)"] → PhonePe #2 [200 applied=False "order already in status 'printing' (idempotent)"] → Paytm [200 applied=False html=True] → tampered phonepe (wrong salt) [HTTP 401]. Final order status → printing→ready.
Agent Browser verified the UI: authed → Create priced order (order f516392c · awaiting_payment) → Simulate #1 ("marked paid") → Simulate #2 (idempotent no-op) → order badge → ready. No console errors. 982KB screenshot.

Stage Summary:
- Phase 3 payments fully shipped and verified end-to-end with REAL signature crypto (no SDK stubs — the verification math runs). 53 tests pass, eslint clean.
- Architecture invariant holds: the webhook service + routes import only the PaymentAdapter interface + the registry; swapping PhonePe→Razorpay is register + env. Per-shop provider routing via the shop's paymentCredentials.
- Ready for Phase 4 (customer web app: /[shopSlug] route, drag-drop upload UI, live pricing, checkout handoff, status polling).

---
Task ID: 4
Agent: orchestrator (main)
Task: Phase 4 — Customer Web App. Mobile-framed multi-step wizard (shop → upload → pay → status) embedded in /, drag-drop multi-file upload with per-file settings, live pricing via the real priceFile() client-side, UPI checkout + QR handoff, token status polling → ready.

Work Log:
- Added GET /api/v1/dev/qr?data=<urlencoded> route (server-side qrcode → pngDataUrl) so the customer app can render a `upi://` payload as a scannable QR on desktop.
- Built src/components/phase4/customer-app.tsx: a mobile-phone-framed wizard (stepper: Shop → Upload → Pay → Status).
  * ShopStep: GET /shops/:slug → shop name, pricing grid, privacy note (auto-delete 60s/24h), "Start order" → POST /shops/:slug/orders → orderId+token → upload step.
  * UploadStep: drag-drop zone + file picker (multi) + "add a demo file". For each file: upload-url → PUT (in-memory storage) → confirm (pdf-lib parses 1 page) → per-file row with copies/colour/duplex controls + live price. Each setting change calls priceFile() on the client for instant reprice AND PATCHes the server (server-authoritative). Sticky bottom bar shows order total + Pay.
  * PayStep: POST checkout → upiUri + amountPaise; fetches /dev/qr to render the UPI QR; "Open in UPI app" link (window.location=upiUri on mobile); "I've paid — track my order" → POST /payments/dev/phonepe/simulate (real X-VERIFY webhook round-trip) → status step.
  * StatusStep: big token number, polls GET /orders/:id/status every 1.5s, shows payment-confirmed → printing → ready → collected; "Start another order" restart.
- Live pricing uses the REAL priceFile() from @platform/core/pricing imported client-side (same engine the backend uses) — instant reprice on every control change, no server round-trip needed for the preview.
- Wired CustomerApp into / page (top, after Hero — it's the end-user experience). Updated Hero badge → PHASE 4 · CUSTOMER APP; Roadmap marks Phase 4 done, Phase 5 (shop dashboard) next.

Bugs found & fixed during self-verification:
- The customer app's demo-file blob needed to be a VALID minimal PDF (the earlier `%PDF-1.4 fake` made pdf-lib return null → needs_review). Reused the valid 1-page PDF string from Phase 3.
- Agent-browser's `find text "I've paid"` broke my eval-based click helper (the apostrophe in "I've" produced a JS syntax error inside includes('...')). Switched to matching "track my order" (no apostrophe) — a test-automation quirk, not an app bug.

End-to-end verified via Agent Browser (one call, server alive throughout, deterministic eval-clicks):
shop loads ("QuickPrint Demo Shop") → Start order → upload step → add a demo file → file priced ₹5.00 (1 B&W page ₹2, min-order ₹5 applied) → Pay → UPI QR rendered → "I've paid" → phonepe simulate (real webhook) → status polling → final-status: ready + "Ready to collect!".
Dev log: clean sequence — files POST 200 → files/:id PATCH 200 → checkout 200 → /dev/qr 200 → phonepe/simulate 200 → status polls (every ~1.5s) all 200. No errors/⨯. 916KB screenshot.

Stage Summary:
- Phase 4 customer web app fully shipped and verified. 53 tests pass, eslint clean, no runtime errors.
- The customer flow is genuinely end-to-end: scan (shop load) → upload (drag-drop, pdf-lib page count) → configure (live pricing from the real engine) → pay (UPI deep-link + QR) → status (token + polling → ready).
- Ready for Phase 5 (shop dashboard: WebSocket order queue, per-file print triggers, QR + sticker PDF, analytics, settings).
