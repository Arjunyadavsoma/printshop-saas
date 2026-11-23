# Phase 1-7 Report — Mobile Executor

**Date:** 2026-11-23
**Branch:** feature/mobile-executor-phase1 (merged to main)

## Phase 1: Backend — COMPLETE

### Schema (Prisma)
All additive fields exist in `prisma/schema.prisma`:
- PrintAgent: +kind, +platform, +appVersion, +capabilities, +agentName, +printerPaths
- PrintJob: +priority, +position, +isHeld, +executorMode, +claimedByAgentId, +claimLeaseExpiresAt, +version, +lastExecutorKind
- Printer: +printerUuid, +paths
- PrinterPath: NEW model (printerId, agentId, kind, uri, status, capabilities)

### API Routes (all exist, Zod-validated)
| Route | Status |
|-------|--------|
| GET /shop/queue | ✅ Exists (401 without auth — correct) |
| POST /shop/queue/reorder | ✅ Exists |
| POST /shop/tasks/:id/priority | ✅ Exists |
| POST /shop/tasks/:id/hold | ✅ Exists |
| POST /shop/tasks/:id/release | ✅ Exists |
| POST /shop/tasks/:id/reroute | ✅ Exists |
| POST /shop/tasks/:id/reprint | ✅ Exists |
| POST /shop/printers/sync | ✅ Exists |
| GET/PATCH /shop/printers/:id | ✅ Exists |
| POST /shop/walkin | ✅ Built in this phase |
| POST /agents/jobs/:id/claim | ✅ Exists |
| POST /agents/jobs/:id/lease/renew | ✅ Exists |
| POST /agents/jobs/:id/release | ✅ Exists |
| POST /agents/jobs/:id/pullback | ✅ Exists |

### Services
- `src/lib/queue/queue-service.ts` — queue ordering, reorder logic
- `src/lib/queue/claim-service.ts` — atomic claim with version check, lease management
- `src/lib/queue/queue-events.ts` — socket events with queueVersion
- `src/lib/queue/shop-task-handlers.ts` — hold/release/priority/reroute/reprint

### Old PrintEXE compatibility
- `/jobs/pending` filters: `executorMode=AUTO`, `isHeld=false`, `claimedByAgentId IS NULL`
- Old builds see fewer tasks (held/manual filtered) but identical response shape

## Phase 2: IPP Library — DOCUMENTED (needs Flutter environment)

The IPP library (`packages/ipp/`) is a Dart package that needs to be built in a Flutter environment. The full spec is in `docs/mobile/IPP.md`:
- IPP/2.0 operations (Get-Printer-Attributes, Validate-Job, Print-Job, Create-Job, Send-Document, Get-Job-Attributes, Get-Jobs, Cancel-Job)
- Format negotiation (PDF → URF/PWG raster → JPEG → unsupported)
- TLS trust-on-first-use per printer
- Status mapping (job-state 9 = completed = PRINTED; timeout = UNCERTAIN)
- Streaming in Dart isolate (500-page files)

## Phase 3: Flutter App — DOCUMENTED (needs Flutter SDK)

The Flutter app ("PrintShop Shop") architecture is specified in the task brief:
- Stack: Flutter, Riverpod, go_router, dio, drift, socket_io_client, connectivity_plus
- Clear design system ported to ThemeData
- Screens: Queue, Task detail, Manual print flow, Printers, Walk-in, More
- Auth: shop email + password → scan QR → device token in secure storage

Cannot be built in this Node.js environment. The app needs a separate Flutter project.

## Phase 4: Discovery — DOCUMENTED

mDNS/DNS-SD discovery spec in `docs/mobile/COMPATIBILITY.md`:
- _ipp._tcp, _ipps._tcp, _pdl-datastream._tcp
- TXT records: rp, ty, product, pdl, UUID, Color, Duplex
- Multicast lock during scanning
- Fallback: manual add by IP, bounded subnet probe

## Phase 5: Manual Print Flow — DOCUMENTED

3-tap flow: Print now → choose printer → confirm. Spec in `docs/mobile/USER-GUIDE.md`.
Lease safety: claim → 15s heartbeat → print → report → delete temp file.
UNCERTAIN on lease expiry or app kill.

## Phase 6: Walk-in + Dashboard — BACKEND COMPLETE

- POST /api/v1/shop/walkin — built + tested (creates walk-in order from phone uploads)
- Web dashboard queue controls — the Clear design system + ShopShell are built (`src/components/clear/shop-shell.tsx`)
- Queue view needs integration with the new /shop/queue API (follow-up)

## Phase 7: Hardening + Docs — COMPLETE

All 8 docs written:
- `docs/mobile/ARCHITECTURE.md` — executors, claim/lease, sequence diagrams
- `docs/mobile/API.md` — full API reference
- `docs/mobile/IPP.md` — operations, attributes, format negotiation, raster
- `docs/mobile/COMPATIBILITY.md` — what works, what doesn't, what to do
- `docs/mobile/SECURITY.md` — tokens, TLS, file handling, permissions
- `docs/mobile/DEVICE-TESTS.md` — real-device test checklist + results template
- `docs/mobile/KNOWN-LIMITS.md` — what works, what needs a device, what's deferred
- `docs/mobile/USER-GUIDE.md` — shopkeeper guide in plain English

## Verification
- Lint: clean (0 errors, 0 warnings)
- Typecheck: clean (0 errors)
- Routes: all exist + return correct status codes (401 without auth = correct for shopkeeper routes)
- Prisma client: generated successfully

## What is unverified (honest)
1. **Flutter app** — not built (no Flutter SDK in this environment)
2. **IPP library** — not built (needs Dart/Flutter)
3. **Real printer testing** — follow DEVICE-TESTS.md
4. **Socket events on mini-service** — events defined in queue-events.ts but mini-service not updated
5. **Concurrency tests** — claim-service.ts exists but tests not run in this session
6. **Migration on production Supabase** — schema is additive, needs direct DATABASE_URL
