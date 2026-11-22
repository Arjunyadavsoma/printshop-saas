# Secret Scan Report

**Tool:** gitleaks v8.21.2
**Date:** 2026-11-22
**Scope:** Full git history (262 commits) + working tree

## Results: 13 findings

### FALSE POSITIVES (12 — test fixtures, examples, documentation)

| # | File | Line | Rule | Verdict | Reason |
|---|------|------|------|---------|--------|
| 1 | packages/adapters/src/payment/razorpay.adapter.test.ts | 12 | generic-api-key | FALSE POSITIVE | `rzp_test_key123`, `testsecret123` — obviously fake test values |
| 2 | src/lib/contracts/companion.examples.ts | 44 | generic-api-key | FALSE POSITIVE | Example deviceToken in contracts/examples file |
| 3 | src/lib/contracts/companion.examples.ts | 151 | generic-api-key | FALSE POSITIVE | Same example pattern |
| 4 | docs/integration/companion-v1.schema.json | 1179 | generic-api-key | FALSE POSITIVE | JSON schema example value |
| 5 | docs/integration/companion-v1.schema.json | 1385 | generic-api-key | FALSE POSITIVE | Same schema example |
| 6 | docs/payments/PAYTM_CHECKSUM_COMPATIBILITY.md | 196 | generic-api-key | FALSE POSITIVE | `a1b2c3d4e5f6...` — sequential test key for checksum docs |
| 7 | src/lib/payments/paytm-checksum.test.ts | 21 | generic-api-key | FALSE POSITIVE | Same `a1b2c3d4...` test fixture |
| 8 | src/lib/payments/paytm-checksum.test.ts | 55 | generic-api-key | FALSE POSITIVE | Same test fixture |
| 9 | docs/integration/PRINTEXE_API_CONTRACT.md | 68 | generic-api-key | FALSE POSITIVE | Truncated JWT example (`eyJ...`) in docs |
| 10 | src/lib/printlatch/printlatch.test.ts | 98 | generic-api-key | FALSE POSITIVE | `PL-XXXX-XXXX-XXXX-XXXX` — placeholder format |
| 11 | packages/utils/src/ids.ts | 11 | generic-api-key | FALSE POSITIVE | Token alphabet character set, not a secret |
| 12 | src/lib/printlatch/printlatch.test.ts | (related) | — | FALSE POSITIVE | Test pairing code placeholder |

### POTENTIALLY REAL (1 — needs user review)

| # | File | Line | Rule | Verdict | Action |
|---|------|------|------|---------|--------|
| 13 | worklog.md | 1437 | generic-api-key | **POTENTIALLY REAL** | **User must review + rotate if active** |

**Context (redacted):** `worklog.md:1437` contains a value matching the pattern `nak_live_<32 hex chars>` which appears to be an access key logged during development. The worklog context discusses it as a "new" key. If this is a real API key for any service, it should be rotated immediately — it's committed in plaintext to a public git history.

**Recommendation:** Do NOT paste the value. Review `worklog.md` line 1437 yourself. If the `nak_live_*` value is a real active key, rotate it at the provider. Then remove it from the worklog (or replace with a placeholder) in a future commit.

## Git config check
- `.git/config`: No credentials stored (clean)
- Remote URLs: No embedded tokens (clean — push uses ephemeral PATs, not stored)
