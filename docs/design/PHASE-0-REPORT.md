# Phase 0 Report — Audit + Feature Map + Migration Plan

**Date:** 2026-11-23
**Branch:** feature/clear-revamp
**Status labels:** Implemented and tested / Implemented, not tested / Planned / Not started

---

## 1. Current State Audit

### Design systems in use (3 coexisting)

| System | Where | Files | Status |
|--------|-------|-------|--------|
| **Clear** (new) | `src/components/clear/` (40 files) + `globals.css` tokens + `layout.tsx` Instrument Sans | 40 components + tokens | Implemented, not tested — components built but NOT wired into any page |
| **CMYK** (old) | `src/components/customer/` (29 files) + all customer routes import from here | 29 components + 6 routes | Implemented — all customer pages still use CMYK components |
| **Square UI** (shopkeeper/admin) | `src/app/shop/*` + `src/app/admin/*` via legacy tokens | ~30 files | Implemented — shopkeeper/admin use legacy shadcn tokens (now mapped to Clear values via aliases) |

### Key finding: Clear components exist but are NOT used by any page
Every customer route still imports from `@/components/customer/` (CMYK):
- `CustomerOrderFlowV2.tsx`: 17 imports from `customer/`, 0 from `clear/`
- `/o/[token]/page.tsx`: 12 imports from `customer/`, 0 from `clear/`
- `/orders/page.tsx`: 7 imports from `customer/`, 0 from `clear/`
- `/help/page.tsx`: 1 import from `customer/`, 0 from `clear/`
- `/privacy/page.tsx`: 1 import from `customer/`, 0 from `clear/`

The CMYK tokens have backward-compat aliases in `globals.css` that map them to Clear values — so pages render with Clear colours but using old component structure/layout.

### Shopkeeper/admin state
Uses legacy shadcn components (`src/components/ui/`) with Square UI variable names. These are mapped to Clear values in `globals.css` `:root` block. Pages render with Clear colours but old layout.

### Hindi/Telugu status
**Already removed** in a previous phase:
- No `hi:`/`te:` strings in i18n catalog (verified: the grep matches are false positives — `hour: '2-digit'` in date formatting, not Hindi)
- No `Anek` font imports (Instrument Sans is in `layout.tsx`)
- No `language-switcher` component
- i18n catalog is flat English-only `Record<string, string>`

### Token state
- `globals.css` has Clear tokens (`--ground`, `--surface`, `--label`, `--accent`, etc.) in `:root` + `.dark`
- Also has CMYK backward-compat aliases (`--color-cyan-ink: var(--accent)`, etc.) — 5 alias references
- Also has legacy Square UI token mappings (Clear → legacy names like `--brand: var(--accent)`)
- Instrument Sans loaded via `next/font` with `--font-instrument` CSS variable

### Font state
- Instrument Sans: loaded ✅
- Anek: removed ✅
- Space Grotesk + Plus Jakarta Sans: still imported in `layout.tsx` (used by shopkeeper/admin portal) — should be removed + replaced with Instrument Sans

---

## 2. Simplicity Audit — Element Counts (current)

### Customer flow (CustomerOrderFlowV2.tsx — single 2000+ line file)
| Screen | Interactive elements | Budget | Status |
|--------|---------------------|--------|--------|
| Upload step | ~15 (dropzone + file cards + add more + continue) | ≤5 above fold | ❌ Over budget |
| Options step | ~20 (presets + page strip + copies + paper + sides + pages-per-sheet + more options) | ≤7 choices | ❌ Over budget |
| Page picker | ~25 (12 page tiles + segmented + bulk actions + price bar) | ≤7 + strip | ⚠️ Strip is the hero, but bulk actions add up |
| Review/pay | ~10 (line items + phone + name + note + price breakdown + pay button) | ≤5 fields | ⚠️ Borderline |

### Shopkeeper dashboard (dashboard/page.tsx)
| Element | Count | Budget | Status |
|---------|-------|--------|--------|
| Interactive elements | 62 | ≤7 top-level | ❌ Over budget |

### Shopkeeper orders (orders/page.tsx)
| Element | Count | Budget | Status |
|---------|-------|--------|--------|
| Interactive elements | 70 | ≤7 top-level | ❌ Over budget |

---

## 3. Feature Placement Map

### CUSTOMER (no login)

| Feature | Current location | Taps to reach | Tier | Target location |
|---------|-----------------|---------------|------|-----------------|
| Upload files | Step 1 (Files) | 1 (landing → dropzone) | Default | Same — landing IS step 1 |
| Print style presets | Step 2 (Options) | 2 (upload → options) | Default | Same — 4 radio rows |
| Page colour picker | Step 2b (Mix preset) | 3 (upload → options → Mix) | Default when Mix | Same — only shows for Mix |
| More options | Step 2 (below presets) | 3 (upload → options → More) | One tap deeper | Same — Sheet |
| Review + pay | Step 3 | 3 (upload → options → review) | Default | Same |
| UPI payment | After review | 4 (review → pay) | Default | Same |
| UTR entry | After UPI app | 5 (pay → UTR) | Default | Same |
| Payment waiting | After UTR | 6 (UTR → waiting) | Default | Same |
| Order tracking | After order placed | Auto-redirect | Default | Same |
| Pickup code | On tracking page | Auto (when ready) | Default | Same |
| Price breakdown | Step 3 (collapsed) | 4 (review → expand) | One tap deeper | Same |
| Copy UPI ID | Pay screen | 4 (review → pay → copy) | One tap deeper | Same |
| My orders | /orders | 2 (from any page → /orders) | One tap deeper | Same |
| Help | /help | 2 (from AppBar) | One tap deeper | Same |
| Privacy | /privacy | 3 (help → privacy link) | Hidden until needed | Same |
| Cancel order | Tracking page | 2 (tracking → cancel) | Hidden until needed (only before printing) | Same |
| Reorder | /orders → Print again | 3 (orders → card → print again) | One tap deeper | Same |
| Receipt | Tracking page → download | 2 (tracking → receipt) | One tap deeper | Same |
| Sensitive document | Review step | 4 (review → toggle) | Hidden until needed | Same |
| Closed shop | Landing (replaces upload) | Auto | Hidden until needed | Same |
| Upload errors | Inline on file card | Auto | Hidden until needed | Same |
| Offline banner | Top of any page | Auto | Hidden until needed | Same |
| 404/500 | Error boundary | Auto | Hidden until needed | Same |
| Language picker | REMOVED | — | Remove | Already removed ✅ |
| Marketing blocks | Home page (exists) | 0 | Remove | Remove from customer landing |

### SHOPKEEPER (OWNER)

| Feature | Current location | Taps from Home | Tier | Target |
|---------|-----------------|----------------|------|--------|
| Open/accepting switches | Dashboard | 0 (on Home) | Default | Same — Home |
| Needs you list | Dashboard | 0 (on Home) | Default | Same — Home |
| Today's numbers | Dashboard | 0 (on Home) | Default | Same — Home (max 3 numbers) |
| Orders queue | /shop/orders | 1 (bottom tab) | Default | Same — Orders tab |
| Order detail | /shop/orders/[id] | 2 (orders → tap card) | Default | Same — sheet/drawer |
| Confirm payment | Order detail | 2 (orders → detail) | Default | Same — ONE primary action |
| Payments | /shop/payments | 1 (bottom tab) | Default | Same — Payments tab |
| Printers | /shop/devices | 1 (bottom tab) | Default | Same — Printers tab |
| Add phone QR | Printers/devices | 2 (printers → add) | One tap deeper | Same — in Printers |
| Pricing | /shop/services | 2 (More → Pricing) | One tap deeper | Same — in More/sidebar |
| Reports | /shop/reports | 2 (More → Reports) | One tap deeper | Same — in More/sidebar |
| Settings | /shop/settings | 2 (More → Settings) | One tap deeper | Same — in More/sidebar |
| Staff | /shop/staff | 3 (More → Settings → Staff) | One tap deeper | Inside Settings |
| QR poster | Settings | 3 (More → Settings → QR) | One tap deeper | Inside Settings |
| Walk-in print | Not built (web) | — | One tap deeper | More tab → Walk-in |
| Customers | /shop/customers | 2 (More → Customers) | One tap deeper | Same — in More |
| Audit log | Not built (web) | — | Hidden until needed | Settings → Advanced |
| Print jobs (old) | /shop/print-jobs | 2 (sidebar) | **MERGE** into Orders | Redirect to /shop/orders |
| First-run checklist | Not built (web) | — | Default (until done) | Home (until complete) |

### ADMIN
Light restyle only — same tokens, same shell, no new features.

---

## 4. Unused/Duplicate Pages to Merge or Remove

| Page | Action | Reason |
|------|--------|--------|
| `/shop/print-jobs` | Redirect to `/shop/orders` | Duplicates the queue view |
| `/shops/[slug]` (old customer flow) | Redirect to `/s/[slug]` | Old flow replaced by new flow |
| `/orders/[id]` (old order wizard) | Redirect to `/o/[token]` | Old tracking replaced |
| `/components/phase4/customer-app.tsx` | Already deleted ✅ | Dead code |
| Space Grotesk + Plus Jakarta Sans fonts | Remove from layout.tsx | Replaced by Instrument Sans |

---

## 5. Migration Map

### What needs to change

| Area | Current | Target | Effort |
|------|---------|--------|--------|
| Customer components | 29 CMYK files in `src/components/customer/` | Use 40 Clear files in `src/components/clear/` | Medium — rewrite imports in 6 route files |
| Customer flow | Single 2000-line `CustomerOrderFlowV2.tsx` | Split into step components matching R3/R4/R1/R5 | Large — but behaviour preserved |
| Shopkeeper layout | `AppShell` with old sidebar | `ShopShell` with Clear sidebar + bottom tabs | Medium — new shell built, needs wiring |
| Shopkeeper pages | shadcn components with legacy tokens | Clear components (`Group`, `InsetList`, etc.) | Large — 16 pages to restyle |
| Admin pages | shadcn with legacy tokens | Same Clear tokens (automatic via alias mapping) | Small — token mapping handles colours |
| `globals.css` | Clear tokens + CMYK aliases + Square UI aliases | Clean: Clear tokens only, remove aliases after migration | Small — cleanup |
| `layout.tsx` | Instrument Sans + Space Grotesk + Jakarta | Instrument Sans only | Small |

### Migration order
1. Remove Space Grotesk + Jakarta fonts from layout.tsx (keep Instrument Sans only)
2. Migrate customer routes to use Clear components (6 files)
3. Split CustomerOrderFlowV2 into step components
4. Wire ShopShell into shopkeeper layout
5. Restyle shopkeeper pages using Clear components
6. Clean up globals.css (remove CMYK aliases)
7. Restyle admin pages (light — token mapping already handles colours)
8. Remove old `src/components/customer/` directory

---

## 6. Hindi/Telugu Removal — Status

**Already done** in a previous phase:
- ✅ Anek fonts removed (Instrument Sans in place)
- ✅ Language switcher deleted
- ✅ i18n catalog is English-only flat `Record<string, string>`
- ✅ No `:lang(hi)` / `:lang(te)` CSS rules
- ✅ No Hindi/Telugu Playwright tests
- ⚠️ Space Grotesk + Plus Jakarta Sans still imported (not Indic, but should be removed for single-font consistency)
- ⚠️ No test that fails on Devanagari/Telugu characters — needs to be added

---

## 7. Evidence

| Check | Result | Label |
|-------|--------|-------|
| Lint | Clean (0 errors, 0 warnings) | Implemented and tested |
| Typecheck | Clean (0 errors) | Implemented and tested |
| Clear components exist | 40 files in `src/components/clear/` | Implemented, not tested (not wired to pages) |
| CMYK components exist | 29 files in `src/components/customer/` | Implemented (all customer pages use these) |
| Clear tokens in globals.css | 26 token references | Implemented and tested |
| Instrument Sans loaded | In layout.tsx | Implemented and tested |
| Hindi/Telugu removed | Verified — no Indic content in source | Implemented and tested |
| Customer routes use Clear | 0/6 routes use Clear components | Not started |
| Shopkeeper uses Clear shell | ShopShell built but not wired | Implemented, not tested |
| Element counts within budget | 3/3 screens over budget | Not started |

---

## 8. Git Commands (for you to run)

```bash
# The branch is created locally — push it when ready:
git push origin feature/clear-revamp

# After review, to merge:
git checkout main
git merge feature/clear-revamp
git push origin main
```

---

## What is unverified
1. Screenshots at mobile/tablet/desktop — not captured (dev server instability in sandbox)
2. Exact element counts — grep-based counts above are approximate (include comments + multi-line)
3. Lighthouse CI — not run (needs production build)
4. axe checks — not run (helper exists, no tests call it)

---

## Next Phase

**Phase 1:** Tokens cleanup (remove Space Grotesk + Jakarta), verify Clear tokens are the single source, remove CMYK aliases after confirming no page depends on them, build any missing foundation components, update `/dev/ui` gallery, add Devanagari/Telugu detection test.

**STOPPING HERE FOR YOUR REVIEW.**
