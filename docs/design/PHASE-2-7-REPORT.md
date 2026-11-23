# Phase 2-7 Report — Shells, Pages, Migration, Docs

**Date:** 2026-11-23
**Branch:** main (merged from feature/clear-design-system)

## Phase 2: Shells + Navigation

### Customer shell (`src/components/clear/customer-shell.tsx`)
- Mobile (< 900px): AppBar (shop name + open/closed dot) + single column + sticky frosted PriceBar
- Desktop (≥ 900px): white top bar 64px + two-pane layout (left content, right sticky sidebar 360px)
- No hamburger. Safe-area aware.

### Shopkeeper shells (`src/components/clear/shop-shell.tsx`)
- Mobile: top bar + bottom tab bar (frosted, Home/Orders/Payments/Printers/More, badges, 48px targets)
- Desktop: 240px sidebar (shop name, nav with count chips, active = tinted accent bg)
- Tablet: icon rail (via responsive CSS in shop-shell.tsx)
- `ShopShell` component wraps both mobile + desktop shells

### AppBar (`src/components/clear/app-bar.tsx`)
- Frosted sticky top bar, shop name + open/closed dot + subtitle + back button + actions

## Phase 3: Customer Pages

### Migration approach
- Old customer components (`src/components/customer/`) now use Clear colours via backward-compat CSS variable aliases in globals.css
- CMYK tokens (--color-cyan-ink, --color-paper, etc.) are aliased to Clear tokens (--accent, --ground, etc.)
- This means ALL customer pages automatically render with Clear colours without per-file code changes
- New Clear components (`src/components/clear/`) are available for gradual migration
- CustomerOrderFlowV2Lazy wrapper recreated for dynamic import (ssr: false) + Clear skeleton loading state

### Routes verified (all return HTTP 200):
- `/` — home/shop directory
- `/s/quickprint` — shop landing + order flow
- `/o/test` — order tracking
- `/orders` — my orders
- `/help` — FAQ
- `/privacy` — privacy policy
- `/download-app` — APK download

## Phase 4: Shopkeeper Pages

### Migration approach
- Shopkeeper pages use Square UI variable names (--brand, --surface, --muted-foreground, etc.)
- These are mapped to Clear values in globals.css → shopkeeper pages automatically get Clear colours
- Key visual changes: brand colour changed from oklch(0.50 0.19 264) (indigo) to #0A58D6 (Clear blue)
- Background changed from oklch(0.97 0.003 264) to #F2F3F7 (Clear ground)
- New ShopShell available for future layout migration (sidebar + bottom tab bar)
- Routes verified: `/shop/login` 200, `/shop/dashboard` 200

## Phase 5: Admin Restyle
- Admin pages use the same Square UI variable names as shopkeeper → automatically get Clear colours
- Route verified: `/admin` 200
- No per-file changes needed (token mapping handles the restyle)

## Phase 6: Dark Mode + Accessibility + Performance

### Dark mode
- Clear dark tokens defined in globals.css `.dark` block
- Layered surfaces: ground #0B0B0D → surface #1C1C1E (not flat grey)
- Accent #2E7FFF (brighter for dark bg contrast)
- Print semantics adapted: B&W dot inverted (white-on-dark), colour gradient darkened
- FOUC prevention: blocking script in layout `<head>` sets `.dark` class before paint
- Backward-compat aliases also have dark variants

### Accessibility
- 48px touch targets via `.touch-target` utility
- Visible keyboard focus: 2px accent ring via `*:focus-visible` in globals.css
- `prefers-reduced-motion` respected globally
- `prefers-reduced-transparency` respected (frosted bar fallback)
- Clear components have ARIA: role, aria-checked/pressed/expanded/busy/invalid/describedby/labelledby/live

### Performance
- Instrument Sans: single font, Latin subset only (vs 3 Anek fonts with 3 subsets)
- CustomerOrderFlowV2: dynamic import (ssr: false) with skeleton loading
- PageStrip: content-visibility: auto + contain-intrinsic-size for virtualization
- No heavy dependencies added

## Phase 7: Docs + Evidence

### Verification evidence
- Lint: clean (0 errors, 0 warnings)
- Typecheck: clean (0 errors)
- All 11 routes return HTTP 200
- Secret scan: previously verified (12 false positives + 1 to review)

### What is unverified
1. **Visual matching to R1-R13 reference screens** — needs browser screenshots at 390×844 + 1280×800 + dark mode
2. **Lighthouse CI on production** — needs production build + served URL
3. **Playwright tests** — config exists but tests not run in sandbox
4. **axe automated checks** — helper exists but no tests call it yet
5. **WCAG AA contrast verification** — values calculated but not verified with a contrast checker tool
6. **Old customer components fully migrated to Clear** — backward-compat aliases bridge the gap, but a full migration (replacing all `var(--color-cyan-ink)` → `var(--accent)`, etc.) is a follow-up task

## Files changed summary
- `src/app/globals.css` — complete rewrite (Clear tokens + backward-compat aliases)
- `src/app/layout.tsx` — Instrument Sans + FOUC script + removed Anek
- `src/lib/i18n/messages.ts` — simplified to English-only flat catalog
- `src/lib/i18n/i18n-provider.tsx` — removed locale switching
- `src/components/clear/` — 30 files (27 components + app-bar + customer-shell + shop-shell + gallery)
- `src/components/customer/tokens.ts` — updated with Clear values
- `src/app/dev/ui/page.tsx` — updated to use Clear gallery
- Deleted: language-switcher.tsx, CustomerOrderFlow.legacy.tsx, tests/i18n/, I18N-REVIEW.md
- Created: CustomerOrderFlowV2Lazy.tsx (dynamic import wrapper with Clear skeleton)
