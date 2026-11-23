# Phase 0 Report — Audit, Migration Map, Token Plan

**Date:** 2026-11-23
**Branch:** `feature/clear-design-system`
**Base:** latest main
**Decision:** English only. The previous CMYK/halftone/Anek design is REPLACED by "Clear". Keep behaviour; change skin.

---

## 1. Current State Audit

### Two old design systems coexist

| System | Where | Files affected | Status |
|--------|-------|---------------|--------|
| **A — CMYK/Halftone/Anek** | Customer flow (`/s/*`, `/o/*`, `/orders`, `/help`, `/privacy`, `/dev/ui`, `/dev/funnel`) | 32 customer components + 13 route files = **45 files** | Active — the "customer redesign" from Phases 2-6 |
| **B — Process-ink/counter-slip** | Legacy `CustomerOrderFlow.legacy.tsx` + `globals.css:528-562` | 2 files | Dead code — `.legacy.tsx` is unreferenced |
| **C — Square UI** | Shopkeeper (`/shop/*`) + Admin (`/admin/*`) | ~30 files | Active — uses `--brand`, `--surface`, `--muted-foreground` tokens |

### Screenshots needed (not captured in this sandbox)

The brief requires screenshots at mobile/tablet/desktop for customer, shopkeeper, and admin. Due to the 2-core sandbox limitation (dev server dies between tool calls), I could not capture stable screenshots. **Manual step:** run the dev server locally and screenshot:
- Customer: `/s/quickprint`, `/o/[token]`, `/orders`, `/help`, `/privacy` at 390×844 + 1280×800
- Shopkeeper: `/shop/dashboard`, `/shop/orders`, `/shop/payments` at 390×844 + 768×1024 + 1280×800
- Admin: `/admin` at 1280×800

---

## 2. Migration Map — Token Replacement

### Colour tokens

| Old (CMYK) | Old (Square UI) | Clear value | Role |
|------------|-----------------|-------------|------|
| `--color-paper: #F7F8FA` | `--background` | `--ground: #F2F3F7` | Page background |
| `--color-surface: #FFFFFF` | `--surface` | `--surface: #FFFFFF` | Cards, groups |
| `--color-ink: #0F1B2D` | `--foreground` | `--label: #1C1C1E` | Primary text |
| `--color-muted: #5B6675` | `--muted-foreground` | `--label-2: #5B5F66` | Secondary text |
| — | — | `--label-3: #6B6F76` | Tertiary text, icons |
| `--color-cyan-ink: #006FA6` | `--brand` | `--accent: #0A58D6` | Primary action |
| — | — | `--accent-press` (8% darker) | Pressed state |
| `--color-on-cyan: #FFFFFF` | `--brand-foreground` | `--on-accent: #FFFFFF` | Text on accent |
| — | — | `--accent-tint: #E6EEFC` + text `#0A4CB8` | Tinted button bg |
| `--color-border-ink: #0F1B2D1A` | `--border` | `--hairline: #DADBE1` | Default border |
| `--color-border-ink-strong` | — | (Clear spec) | Focused border |
| — | — | `--track: #E3E4EA` | Segmented control track |
| — | — | `--fill: #F2F3F7` | Input fill, thumbnail fill |
| `--color-success: #0B7A4B` | `--success` | success dot `#1F8A55` / tint `#DDF3E7` / text `#14663F` | Success status |
| `--color-warning: #F59E0B` | `--warning` | warning tint `#FFF1CC` / text `#7A4B00` | Warning status |
| `--color-error: #B3261E` | `--destructive` | danger `#B3261E` / tint `#FBE3E1` / text `#9C1F18` | Error status |
| `--color-magenta-ink: #C2185B` | — | **RETIRED** | Was: colour-page indicator |
| `--color-yellow-ink: #FFD60A` | — | **RETIRED** | Was: decorative |

### Print semantics (the product's visual hook — NEW for Clear)

| Token | Value | Usage |
|-------|-------|-------|
| `--pg-bw-dot` | half `#1C1C1E` / half `#FFFFFF`, 1px `#6B6F76` ring | B&W page indicator |
| `--pg-colour-bg` | `linear-gradient(160deg, #CFE3FF, #F6D3EC 55%, #FFF0B8)` | Colour page tile background |
| `--pg-colour-dot` | `conic-gradient(#E5484D, #F5C400, #30A46C, #0091FF, #D6409F, #E5484D)` | Colour page indicator |
| Kanban column fill | `#E8E9EF` | Shopkeeper kanban |

### Radius tokens

| Old | Clear value | Role |
|-----|-------------|------|
| `--radius-tight: 4px` | (retire) | Was: chips, tiles |
| `--radius-default: 8px` | input/thumb: `12px` | Inputs, thumbnails |
| `--radius-soft: 16px` | group: `22px` / sheet top: `28px` / button: `999px` (fully rounded) / chip: `999px` / kanban column: `18px` / card: `14px` / segmented track: `12px`, inner: `10px` | Clear uses radius BY ROLE, not one scale |

### Shadow tokens

| Old | Clear approach |
|-----|----------------|
| `--shadow-sheet` | Almost none — structure from white-on-grey + hairlines. Shadow only on: active segment, sheets/popovers, frosted bar border. |
| `--shadow-bar` | Frosted bar: `rgba(255,255,255,.86)` + `backdrop-filter: blur(16px)` |
| `--shadow-slip` | (retire — use frosted bar or sheet shadow) |

### Font

| Old | Clear |
|-----|-------|
| Anek Latin + Devanagari + Telugu (3 next/font instances) | **Instrument Sans** (400, 500, 600, 700) via next/font, Latin subset, `display: swap`, fallback `system-ui, -apple-system, Segoe UI, Roboto, sans-serif` |
| `--font-customer` | `--font-sans: Instrument Sans, system-ui, ...` |

### Type scale (mobile / desktop)

| Token | Mobile | Desktop |
|-------|--------|---------|
| Large title | 34/1.08, -0.02em, 700 | 40-44 |
| Title | 24/1.2, -0.01em, 700 | 28 |
| Headline | 17/1.3, 600 | — |
| Body | 16/1.5, 400 | — |
| Secondary | 14/1.45, label-2 | — |
| Caption | 13/1.4 | — |
| Chip/label | 12/1.2, 600 (never below 12) | — |
| Price | 24/1.1, 700, tabular, -0.01em | 30-32 |

---

## 3. Files to Migrate (45 customer + ~30 shop/admin)

### Customer components (32 files in `src/components/customer/`)
All need full restyle. Priority order:
1. `tokens.ts` — rewrite with Clear values
2. `button.tsx`, `text-field.tsx`, `phone-field.tsx`, `chip.tsx`, `segmented-control.tsx` — atomic primitives
3. `app-bar.tsx`, `sticky-action-bar.tsx`, `bottom-sheet.tsx` — layout
4. `page-thumb.tsx`, `page-strip.tsx` — the signature moment (halftone → Clear dot/tint)
5. `token-slip.tsx`, `status-timeline.tsx`, `status-pill.tsx` — status
6. Remaining: `file-card.tsx`, `upload-dropzone.tsx`, `price-breakdown.tsx`, `payment-sheet.tsx`, `utr-input.tsx`, `skeleton.tsx`, `empty-state.tsx`, `error-state.tsx`, `toast.tsx`, `offline-banner.tsx`, etc.

### Customer routes (13 files)
- `src/app/s/[shopSlug]/page.tsx` + `CustomerOrderFlowV2.tsx` + `CustomerFlowSkeleton.tsx`
- `src/app/s/[shopSlug]/{loading,error,not-found}.tsx`
- `src/app/o/[token]/{page,loading,error,not-found}.tsx`
- `src/app/{orders,help,privacy}/page.tsx`
- `src/app/dev/{ui/gallery-client,funnel/page}.tsx`

### Legacy to DELETE
- `src/app/s/[shopSlug]/CustomerOrderFlow.legacy.tsx` — unreferenced, uses old system B tokens
- `globals.css` lines 528-562 — the `--paper/--ink/--p-cyan` block + `.halftone` / `.perforation` utilities

### Shopkeeper/Admin (~30 files)
Already on Square UI tokens. Light Clear pass = re-skin the Square UI tokens to Clear values in `globals.css` `:root` block. No per-file changes unless the Clear spec introduces new component patterns (bottom tab bar, kanban, drawer).

---

## 4. Hindi/Telugu Removal List

**Decision: English only.** The following files contain Hindi/Telugu content to DELETE in Phase 1:

| File | What to remove | Action |
|------|---------------|--------|
| `src/lib/i18n/messages.ts` | 55 keys × 2 locales (hi, te) = 110 translations | Keep only `en` values. Convert from `{ en, hi, te }` structure to flat `{ key: "English string" }` or `en.json` |
| `src/lib/i18n/i18n-provider.tsx` | `Locale` type (`'en' \| 'hi' \| 'te'`), `detectBrowserLocale()`, `setLocale()` | Remove locale switching. Hardcode `locale = 'en'`. Remove `localStorage` locale key. |
| `src/components/customer/language-switcher.tsx` | The entire component (EN / हिंदी / తెలుగు switcher) | **DELETE the file**. Remove from AppBar. |
| `src/app/layout.tsx` lines 2, 31-50, 163 | `Anek_Latin`, `Anek_Devanagari`, `Anek_Telugu` imports + instances + `.variable` classes on `<body>` | Remove all 3 Anek imports + instances + body className additions. Replace with Instrument Sans. |
| `src/app/globals.css` line 120 | `--font-customer: var(--font-anek-latin), var(--font-anek-devanagari), var(--font-anek-telugu), ...` | Replace with `--font-sans: Instrument Sans, system-ui, ...` |
| `src/app/globals.css` lines 216-218 | `.customer-flow :lang(hi), :lang(te) { line-height: 1.6 }` | **DELETE** — no Indic scripts to adjust for |
| `tests/i18n/i18n-snapshots.test.ts` | Playwright snapshot tests for hi/te at 360px | **DELETE the file** — no multilingual testing needed |
| `docs/redesign/I18N-REVIEW.md` | Native-speaker review doc for en/hi/te | **DELETE or archive** — English only |
| `src/app/manifest.ts` | `lang: 'en'` (already correct — keep) | No change needed |
| `<html lang="en">` in layout.tsx | Already `"en"` — keep | No change |
| Analytics `language` dimension | Not found in `analytics.ts` — was never added | No action needed |
| Shop `languages` DB column | **Keep untouched** — no migration. Just stop reading/writing it. | Verify no code reads it |

### Test to add (fails build if Hindi/Telugu appears)
Add a test that scans all `.tsx`/`.ts` files for Devanagari (U+0900-097F) or Telugu (U+0C00-0C7F) characters + fails if found. This prevents accidental re-introduction.

---

## 5. Token Centralization Plan

### Single source of truth
All design tokens will live in `src/app/globals.css` as CSS variables in the `:root` block (light mode) + `.dark` block (dark mode). No separate `tokens.ts` file — components reference CSS variables directly via Tailwind's arbitrary value syntax (`bg-[var(--surface)]`, `text-[var(--label)]`).

### Tailwind theme mapping
Map the CSS variables into the `@theme inline` block so Tailwind generates utility classes:
```css
@theme inline {
  --color-ground: var(--ground);
  --color-surface: var(--surface);
  --color-label: var(--label);
  --color-label-2: var(--label-2);
  --color-accent: var(--accent);
  --color-hairline: var(--hairline);
  /* ... etc */
}
```
This generates `bg-ground`, `text-label`, `border-hairline`, etc.

### ESLint rule for raw hex
Add a custom ESLint rule (or Stylelint) that fails on:
- Raw hex colors (`#XXXXXX`) outside `globals.css`
- Arbitrary radii (`rounded-[Npx]`) that don't match the Clear scale
- `Anek` font references

### Migration order
1. Define Clear tokens in `globals.css` (replace both `:root` Square UI block + customer-flow block)
2. Remove `.customer-flow` scope class entirely
3. Install Instrument Sans via `next/font`
4. Remove Anek fonts + Hindi/Telugu content
5. Rewrite `tokens.ts` (or delete it)
6. Rewrite 32 customer components
7. Migrate 13 customer routes
8. Delete legacy files + old token blocks
9. Light Clear pass on shopkeeper/admin (re-skin tokens)
10. Update manifest.ts, layout.tsx theme-color meta

---

## 6. Reference Screens (R1-R13)

The 13 approved reference screens are in the uploaded HTML file (`upload/PrintShop Clear design screens.html`, 2MB Figma export). They define:

| Screen | Description | Route |
|--------|-------------|-------|
| R1 | Page picker, mobile (customer step 2b) | `/s/[shop]/order#picker` |
| R2 | Landing, mobile | `/s/[shop]` |
| R3 | Files, mobile (step 1) | `/s/[shop]/order#files` |
| R4 | Print style, mobile (step 2) | `/s/[shop]/order#options` |
| R5 | Review, mobile (step 3) | `/s/[shop]/order#review` |
| R6 | Pay, mobile | `/s/[shop]/order#pay` |
| R7 | Waiting, mobile | `/o/[token]` (payment pending) |
| R8 | Tracking, mobile | `/o/[token]` |
| R9 | Shop home, mobile | `/shop/dashboard` |
| R10 | Shop order detail, mobile | `/shop/orders/[id]` |
| R11 | Shop payments, mobile | `/shop/payments` |
| R12 | Customer order builder, desktop | `/s/[shop]` at 1280px |
| R13 | Shop orders kanban, desktop | `/shop/orders` at 1280px |

**Not yet drawn** (I'll design these in the same system): login, first-run checklist, printers, pricing, reports, customers, settings, notifications, audit/dispute, receipt, help, privacy, empty/error/offline/closed/404/500 states, upload error states, double-sided page picker, shopkeeper tablet counter mode, dark mode.

---

## 7. What Is Unverified

1. **Screenshots** — not captured (dev server instability in sandbox). Manual step: screenshot all routes at 390×844 + 1280×800.
2. **Reference screen matching** — the R1-R13 screens need to be matched pixel-by-pixel. I'll verify in Phase 3 (customer pages) + Phase 4 (shopkeeper pages) by rendering each + comparing.
3. **Shopkeeper/admin current state** — the audit confirmed they use Square UI tokens but didn't detail every page's layout. Phase 2 (shells) + Phase 4 (shopkeeper pages) will address this.
4. **Dark mode** — the existing dark mode tokens (`.dark .customer-flow`) need to be replaced with Clear dark tokens. Phase 6 covers this.

---

## Next Phase

**Phase 1: Design system v2** — define Clear tokens in `globals.css`, install Instrument Sans, build foundation + container components, create `/dev/ui` gallery (mobile + desktop, light + dark), remove Hindi/Telugu + old fonts.

**Awaiting your review of this audit + migration map before proceeding.**
