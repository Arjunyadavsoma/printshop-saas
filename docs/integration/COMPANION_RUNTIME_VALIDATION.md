# Companion Runtime Validation

**Date:** 2026-11-16
**Status:** SaaS-side implemented and unit-tested. Runtime integration pending.

## SaaS-Side Validation (Completed)

### Pairing Protocol
| Test | Result |
|---|---|
| Pairing ticket creation (authenticated owner) | ✅ Pass |
| Pairing ticket creation (unauthenticated → 401) | ✅ Pass |
| Ticket exchange (valid → device token + agentId) | ✅ Pass |
| Ticket exchange (invalid ticket → 401) | ✅ Pass |
| Ticket exchange (reused → 409) | ✅ Pass |
| Ticket exchange (invalid format → 400) | ✅ Pass |
| Rate limiting (unique IP per test) | ✅ Pass |

### Device Management
| Test | Result |
|---|---|
| Device listing (scoped to shop) | ✅ Pass |
| Command creation (refresh_printers) | ✅ Pass |
| Invalid command type rejection (run_shell → 400) | ✅ Pass |
| Idempotent command creation (same key → same command) | ✅ Pass |

### Build & Static Analysis
| Check | Result |
|---|---|
| ESLint | ✅ 0 errors |
| TypeScript (tsc --noEmit) | ✅ 0 errors |
| Prisma generate | ✅ Success |
| Full test suite | ✅ 566 passed, 44 skipped, 0 failed |
| PostgreSQL integration tests | ⚠️ Blocked (5 files — no local Postgres) |

## Cross-Repository Contract Compatibility

### SaaS Routes → PrintEXE Implementation Mapping

| SaaS Endpoint | PrintEXE Module | Match |
|---|---|---|
| POST /companion/pairing/begin | Infrastructure/Pairing | ✅ |
| POST /companion/pair | Infrastructure/Pairing | ✅ |
| GET /companion/commands | Infrastructure/Commands | ✅ |
| POST /companion/commands | Infrastructure/Commands | ✅ |
| GET /shops/me/devices | Backend/Endpoints | ✅ |
| PATCH /shops/me/devices/[id] | Backend/Endpoints | ✅ |
| DELETE /shops/me/devices/[id] | Backend/Endpoints | ✅ |
| POST /shops/me/devices/[id]/commands | Backend/Endpoints | ✅ |
| POST /agents/token | Infrastructure/Sync | ✅ (existing) |
| POST /agents/heartbeat | Infrastructure/Sync | ✅ (existing) |
| GET /agents/jobs/pending | Infrastructure/Queue | ✅ (existing) |
| POST /agents/jobs/[id]/status | Infrastructure/Queue | ✅ (existing) |
| POST /agents/jobs/[id]/received | Infrastructure/Queue | ✅ (existing) |

### PrintEXE Feature Branch State
- **Branch:** `feat/unified-print-exe-cloud-integration`
- **Commit:** `815d11c`
- **CI:** Windows build passed (run 44005967006)
- **Tests:** 9/9 Queue.Tests, 98/98 Infrastructure.Tests
- **Documentation:** CONTRACT_V1_REVIEW, CONTRACT_COMPATIBILITY, PHASE2_FINAL_REPORT

## Runtime Validation (Pending)

The following tests require a real Windows machine + PrintEXE installation:

1. Shopkeeper initiates pairing on web dashboard
2. PrintEXE receives pairing ticket via deep link or manual entry
3. PrintEXE exchanges ticket for device token
4. Device token stored via DPAPI
5. PrintEXE connects and sends heartbeat
6. Web dashboard shows device online
7. Shopkeeper sends refresh_printers command
8. PrintEXE executes and reports result
9. Web dashboard shows command succeeded
10. Network disconnection → offline queue continues
11. Network restoration → synchronization resumes
12. Device revocation → PrintEXE loses access
13. PrintEXE restart → automatic credential restoration
14. Physical printer test → spooler evidence recorded

**These tests cannot be performed in this environment (Linux sandbox, no Windows machine).**
