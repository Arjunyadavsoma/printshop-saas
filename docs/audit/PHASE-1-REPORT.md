# PHASE 1 REPORT — One Contract (fix/e2e-printshop)

Date: 2026-11-20 · Status: **complete, stopped for review**

## 1) What was found (with file paths)

- **B-001 (Phase 0's headline P0) was wrong — corrected.** `git merge-base --is-ancestor` proves `phase4-release-qualification` (saas `09aa7c1`, PrintEXE local tip) is an **ancestor of origin/main in BOTH repos**: the phase1–6 work was already merged before the v0.6.1 session. Phase 0's "divergence" evidence came from stale laptop-clone working trees, not from main. No reconciliation merge existed to make; main is the single lineage. BASELINE.md updated (B-001 → closed, with the verification commands noted).
- **B-019 scoped and real**: **seven** suites hardcoded machine-specific DB fallbacks (`postgresql://z@127.0.0.1/...` or passwordless `postgres@`) — webhook-postgres-fk, migration-integrity (+2 doc comments), app-checkout-concurrency, app-webhook-integration, checkout-real-postgres, payment-connection-loss-phase4, payment-webhook-concurrency-phase3. All now fall back to the CI service-container convention (`postgres:postgres@127.0.0.1:5433/...`), so the whole vitest suite runs **standalone with no env vars: 60/60 files, 690 passed / 4 skipped, 0 errors** — and lint 0, `tsc --noEmit` 0, `next build` 0. (The local portable PG additionally needed a one-time `CREATE ROLE postgres LOGIN SUPERUSER PASSWORD 'postgres'` bootstrap — noted in the report; CI's docker PG has it by default.)
- **The frozen contract (v1.0) had drifted from the code in 11 places** — all verified against route handlers and fixed:
  - error codes `TICKET_EXPIRED`/`TICKET_CONSUMED` never existed (real: `UNAUTHORIZED` for unknown+expired — anti-enumeration — plus `PAIRING_TICKET_UNAVAILABLE`/`PAIRING_TICKET_CONSUMED` 409, `ENTITLEMENT_REQUIRED` 403);
  - §15 said token rotation was "future / not implemented" while `POST /api/v1/companion/token/rotate` is live (5/60s, 10-minute `prevTokenHash` overlap, `device.token_rotated` event);
  - §6/§7 command field names + ack response were wrong (`{applied:true}` → `{commandId,status,updatedAt}`);
  - `needs_review` job status, `failedJobs` in pending-jobs, `job.needs_review`/`device.token_rotated`/`sync.pushed` events, `auth-error {message}` shape, `multi_device` enforcement at mint+consume+post-insert, versioned token hashing (`v2:` + `DEVICE_TOKEN_PEPPER`) — all undocumented;
  - Appendix C documented a token path that exists nowhere (`%AppData%\PrintEXE\device-token.dat`); the real canonical path is `%LocalAppData%\PrintShop\Companion\Security\device.dat` with a 3-tier automatic migration (v0.4.7 AppData → LocalAppData Security → `.bak` crash recovery);
  - `README.md` §"What this is NOT" claimed the backend "does not yet expose the routes the companion needs" — false since v0.6.1 (18/18 local probe).

## 2) What I changed and why

**SaaS repo (`fix/e2e-printshop`):**
- `docs/integration/COMPANION_V1_CONTRACT.md` — v1.0 "Frozen" → **v1.1 ACTIVE SSOT**: every drift fixed, new §15b shop-snapshot / §15c paste-token / §15d sync registration, Socket.IO event catalogue completed, envelope rules (`X-Request-Id`, production 500 masking, `meta`), retry table kept, versioning + change rules formalized, §17 changelog.
- `src/lib/contracts/companion.ts` + `companion.examples.ts` — the machine registry: 21 Zod schemas (full HTTP bodies), 15-route registry with auth + source-file pointers, 14 server socket events, 21 example sets.
- `scripts/contracts/gen-schema.ts` — generates `docs/integration/companion-v1.schema.json` (Zod 4 native `z.toJSONSchema`, no new deps; 15 routes / 21 example sets).
- `src/lib/contracts/companion.contract.test.ts` — **26 tests, all green**: artifact ↔ Zod sync (deep equality on regenerated JSON), every example parses against its schema, no orphan examples, every documented route maps to a real `route.ts` (`:param` → `[...]` aware), doc version ↔ artifact version pinned.
- z@ fallbacks fixed (B-019 — 7 suites) to the CI convention `postgres:postgres@127.0.0.1:5433/...`; `eslint.config.mjs` now ignores `scripts/**` (the Phase-0 probe scripts are dev tooling, not app code); a stale `.next/lock` from an OOM-killed build was cleared before the clean build.
- `mini-services/realtime-service/README.md` — B-013 closed on the docs side: the shared-secret rule, local boot recipe, production topology (serverless can't host it), CORS.

**PrintEXE repo (`fix/e2e-printshop`):**
- `docs/contracts/companion-v1.schema.json` — byte-identical copy of the artifact (SHA256 verified equal).
- `tests/PrintShopCompanion.Infrastructure.Tests/CompanionContractTests.cs` — 8 drift tests (compiles clean under net10.0-windows; runs in windows CI): artifact version ↔ `CompanionProtocol.ExpectedContractVersion` (new constant), every client route (`ApiUrl` segments) exists in the artifact with the right method, examples deserialize into the real DTOs (`RegisterAgentResponseDto`, `PendingJobsEnvelopeDto`, `AgentTokenResponseDto`, `AgentHeartbeatResponseDto`, `AgentJobStatusResponseDto` incl. the applied-vs-skipped union), status-request serializes with contract field names, socket events the client listens for exist in the artifact.
- `README.md` — false "backend lacks routes" claim replaced with current status + SSOT pointer; mock-backend section now carries the B-014 caveat honestly.
- SSOT-deferral banner added to `CONTRACT_COMPATIBILITY.md`, `PROTOCOL.md`, `BACKEND-MAPPING.md`, `DELIVERY_PROTOCOL.md` (historical, lose on conflict).

## 3) Commands run and real output

| Command | Result |
|---|---|
| `git merge-base --is-ancestor …` (both repos) | phase branches ARE ancestors of main — B-001 closed |
| `bun scripts/contracts/gen-schema.ts` | wrote artifact (21 defs, 15 routes, 21 example sets) |
| `bunx vitest run src/lib/contracts/companion.contract.test.ts` | **26 passed (26)** |
| `dotnet build tests/PrintShopCompanion.Infrastructure.Tests.csproj` | **Build succeeded** (0 errors; warnings pre-existing) |
| `shasum` both artifact copies | identical SHA256 `1b575266…` |
| Full SaaS battery + standalone re-runs | **lint 0 · tsc 0 · vitest 60/60 files, 690 passed / 4 skipped, 0 errors (standalone, no env) · next build 0** — fresh logs in `docs/audit/phase0/` |

## 4) Unverified / manual

- The 8 C# contract tests compile locally but EXECUTE only on windows-latest CI (B-021) — the push triggers that run; check it before Phase 2.
- Production redeploy (B-003) + PAT rotation (B-002) remain manual, as flagged in Phase 0.

## 5) Next phase

**Phase 2 — SaaS hardening of the money + ops path**: wire PaymentAttempt/PaymentEvent persistence into the webhook (B-007), entitlement gating beyond analytics (B-006), CRON_SECRET + cleanup ops (B-005), then Phase 3 (dashboard states) and Phase 4 (PrintEXE printing truth: B-008/009/010/012).
