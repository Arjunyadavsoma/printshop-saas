# BEFORE-AFTER — Printelyx audit (fix/site-audit)

**Production crawl:** 168 page-loads (14 routes × 6 viewports × light/dark) before; targeted verification passes after. Real-device/WebKit limits documented in BUG-LIST.

| Metric | Before | After | Proof |
|---|---|---|---|
| P0 bugs | 3 | **0** | `pipeline.integration.test.ts` 14/14; `tests/payment-utr.spec.ts` green |
| Customer order journey | Blocked at UTR entry (window.prompt) | **End-to-end: upload → options → colour pages → review → pay → UTR sheet → waiting** | `journeys/full-flow2.json`, e2e |
| Upload validation | .txt + corrupt PDFs accepted "Ready" | Rejected at init + client + pipeline; corrupt → FAILED | vitest regressions |
| Page-count pricing | 15 MB garbage → "318 pages, ₹636" | Real parser only; undeterminable → FAILED | vitest regression |
| Home Lighthouse perf | 69 | **85** (CLS 0.306 → **0**, a11y 94 → 98) | `evidence/lighthouse/` |
| Shop Lighthouse | 93 / a11y 100 / CLS 0 | **94 / 100 / 0** | `evidence/lighthouse/` |
| Titles/canonical/OG | 4 routes lowercase, no canonical/OG anywhere | Unique titles + canonical + OG/Twitter + og.png on all routes | `evidence/phase3-verify.json` |
| Stub pages | /about /contact /pricing /terms "being written" | Real content; env-driven contacts (hidden when unset) | phase3-verify.json |
| Privacy | "build date of this app", printshop.local | Real date (kept in code) + retention table, no .local | phase3-verify.json |
| /orders dead UI | "Coming soon" form rendered live | Panel only behind OTP flag; empty state kept | phase3-verify.json |
| /dev/* on production | 200 (public) | **404** (middleware gate) | curl in commit log |
| robots/sitemap | sitemap.xml 404 | 200 via app/sitemap.ts | probe |
| Offline | Bare "Loading…" forever | /offline page + SW fallback + home error card | mobile-checks + sw.js |
| Stray "Current theme" text | Present | Removed | phase3-verify.json |
| Footer | "·" separators, "→" arrows, 31×18px targets | Plain list, ≥48px targets, no arrows | phase3-verify.json |
| Pay-screen UPI rows | Static divs (dead) | Real upi:// intent links | code + e2e |
| Dev tools exposed | /dev/ui, /dev/funnel public | 404 in production build | curl |
| Broken links | 0 | 0 | link-status.json |
| Horizontal overflow | 0 px everywhere | 0 px everywhere (smoke gate added) | smoke suite |

**Remaining work (honest):** home perf 85→90 (code-split), smoke-suite axe findings on /terms + /track, P1-6 production QA-shop data cleanup, P1-14 migration/seed repair, iOS/WebKit + real-device passes (see BUG-LIST could-not-verify).
