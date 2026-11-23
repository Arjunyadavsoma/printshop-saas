# Phase 1-7 Report — Mobile Executor Backend + Docs

**Date:** 2026-11-23
**Branch:** `feature/mobile-executor`

## Phase 1: Backend ✅
- Prisma schema: PrintAgent +kind/platform/appVersion/capabilities/agentName, PrintJob +priority/position/isHeld/executorMode/claim/version, Printer +printerUuid, new PrinterPath model
- Migration SQL: additive, all columns have defaults, IF NOT EXISTS guards
- Queue service: getQueue, reorderTask (fractional index), setPriority, holdTask, releaseTask, rerouteTask, reprintTask — all audited
- Claim/lease service: atomic claim with version check, lease renewal, release, expiry → UNCERTAIN
- Dispatcher gate: /jobs/pending filters held/manual/claimed tasks — old PrintEXE unaffected
- 8 new API endpoints + 3 device-agent endpoints, all Zod-validated
- Lint + typecheck: clean

## Phase 2: IPP Library (docs only — Flutter app is a separate repo)
The IPP library (`packages/ipp` in the Flutter repo) will implement:
- IPP/2.0 binary encode/decode (RFC 8011, PWG 5100.x)
- Operations: Get-Printer-Attributes, Validate-Job, Print-Job, Create-Job+Send-Document, Get-Job-Attributes, Get-Jobs, Cancel-Job
- Format negotiation: PDF → URF/PWG-raster → JPEG → unsupported
- TLS: trust-on-first-use per printer (pin certificate fingerprint)
- Streaming: chunked HTTP, rasterising in Dart isolate
- Tests: byte-level golden fixtures, negotiation tests, CUPS simulator integration
See `docs/mobile/IPP.md` for the full spec.

## Phase 3-5: Flutter App (docs only — separate repo `printshop-shop-app`)
The Flutter app will implement:
- Clear design system ported to ThemeData (tokens, Instrument Sans, page tile)
- Screens: Queue (home), Task detail, Manual print flow, Printers, Walk-in, More
- Auth: shop email + password → QR pairing → secure storage
- API client: dio + socket_io_client + drift cache
- Discovery: mDNS/DNS-SD for _ipp._tcp + manual IP entry
- IPP printing: end-to-end against CUPS simulator
- Execution safety: claim → lease heartbeat → download → print → report → cleanup
See `docs/mobile/ARCHITECTURE.md` + `docs/mobile/USER-GUIDE.md` for specs.

## Phase 6: Web Dashboard Queue Controls ✅ (backend ready)
The backend endpoints for the web dashboard queue are built:
- GET /shop/queue returns tasks with executor labels
- POST /shop/queue/reorder, /tasks/:id/priority, /hold, /release, /reroute, /reprint
- The web dashboard needs a Queue view component (to be built in the Clear design system)
- "Add this phone" QR dialog: uses the existing PairingTicket flow
- Settings: "Manual printing from phones" switch (shop setting)

## Phase 7: Docs + Hardening
All docs written:
- ARCHITECTURE.md: executors, claim/lease, sequence diagrams
- API.md: all endpoints with request/response shapes
- IPP.md: operations, attributes, format negotiation, raster notes
- COMPATIBILITY.md: what works, what doesn't, what to do
- SECURITY.md: tokens, TLS pinning, file handling, permissions
- DEVICE-TESTS.md: real-device testing checklist
- KNOWN-LIMITS.md: honest assessment
- USER-GUIDE.md: shopkeeper guide, plain English

## What is unverified
1. **Prisma migration on production Supabase** — additive, needs direct DATABASE_URL
2. **Old PrintEXE compatibility** — server-side filter should work, needs contract test
3. **Flutter app** — separate repo, not built in this environment
4. **IPP library** — separate repo, not built in this environment
5. **Real printer testing** — needs physical printers + phones
6. **Socket events** — queueVersion monotonic counter needs implementation
7. **Fractional index** — current implementation is simplified; production needs lexorank
