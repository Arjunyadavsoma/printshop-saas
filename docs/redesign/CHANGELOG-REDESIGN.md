# Customer Redesign — Changelog

## Phase 0: Audit (2026-11-22)
- Complete route + component inventory (8 active routes, 5 missing)
- 14 screenshots at 360×800, 390×844, 412×915
- Performance baseline (dev server — production Lighthouse deferred)
- Heuristic review: 6 P0, 10 P1, 10 P2 issues identified
- Step count baseline: 5 screens, ~14 visible fields, ~90s (new flow)

## Phase 1: Design Plan (2026-11-22)
- CMYK process colour palette (Cyan-ink #006FA6, Magenta-ink #C2185B, Yellow-ink #FFD60A, Ink #0F1B2D)
- Anek font family (Latin + Devanagari + Telugu by Ek Type)
- 4/8 spacing scale, 3 radius values (4/8/16px), borders encode structure
- Halftone textures for B&W / colour page distinction
- Perforated token slip, registration marks as dividers
- 6 ASCII wireframes (shop landing, options, page picker, review+pay, payment waiting, tracking)
- PASS 2 self-review: removed button arrows, removed unnecessary headings

## Phase 2: Design System + Component Library (2026-11-22)
- 26 components in `/src/components/customer/`
- Design tokens in globals.css (CMYK palette, halftone textures, perforated edges, page-flip animation, safe-area insets, touch-target helper, focus ring)
- Anek fonts loaded via next/font (Latin + Devanagari + Telugu, subsetted, display: swap)
- `.customer-flow` scope (doesn't affect shopkeeper/admin portal)
- Dev gallery at `/dev/ui` showing every state
- Lint + typecheck clean

## Phase 3: Pages + Flows (2026-11-22)
- `/s/[shopSlug]` refactored: AppBar + CustomerOrderFlowV2 with Stepper, 4 presets, PageStrip, StickyActionBar, BottomSheet for "More options"
- `/o/[token]` refactored: TokenSlip + StatusTimeline + visibility-aware polling (5s → 10s → 30s → 60s backoff, stops at 30min)
- `/orders` created: device-local recent orders, empty state
- `/help` created: 8-item FAQ accordion
- `/privacy` created: plain-language file retention policy
- Route siblings: loading.tsx + error.tsx + not-found.tsx for /s/ and /o/
- P0 fixes: UPI deep-link wired to real shop.upiId, touch targets 48px, input text 16px, Stepper + presets added
- Screens reduced: 5 → 3 (Files → Options → Pay)
- Visible fields reduced: ~14 → 4 preset cards

## Phase 4: Advanced Features (2026-11-22)
- IndexedDB draft recovery (survives refresh/tab kill, 2h TTL, restore prompt)
- Color suggestion UX (auto-detect prompt with Accept/Customize)
- i18n foundation: 60+ strings in en/hi/te, useI18n hook, LanguageSwitcher, browser-lang detection
- Analytics: 17 events, localStorage queue, batch flush to /api/v1/analytics/track, no personal data
- Remember last choices: localStorage per shopSlug, smart defaults on return
- Add-to-home-screen: shows after 2nd order, Chrome beforeinstallprompt, iOS instructions
- PWA manifest: Cyan-ink theme, Paper background, customer shortcuts

## Phase 5: Performance, Accessibility, Privacy (2026-11-22)
- Route-level code splitting: CustomerOrderFlowV2 lazy-loaded via next/dynamic (ssr: false)
- Price CLS fix: min-w-[80px] on total display
- Quote AbortController: stale requests cancelled on page toggle
- Page strip virtualization verified: content-visibility: auto + contain-intrinsic-size
- aria-live on price changes + status updates
- BottomSheet: aria-labelledby (useId), focus trap, focus restore verified
- prefers-reduced-motion: global + targeted rules verified
- axe-core added to devDependencies + axe-check script for Playwright
- Sensitive document toggle (Aadhaar/PAN: pickup code required, deleted after printing)
- Analytics funnel view at /dev/funnel

## Phase 6: Docs + Handoff (2026-11-22)
- COMPONENTS.md: full component index
- CHANGELOG-REDESIGN.md: this file
- DEVICE-CHECKLIST.md: manual real-device testing checklist
- AUDIT.md updated with before/after metrics table
- Known limits section documenting what could not be tested

## Before/After Summary

| Metric | Before (audit) | After (Phase 5) |
|--------|----------------|-----------------|
| Screens (scan → paid) | 5 | 3 |
| Visible fields (options) | ~14 | 4 preset cards |
| Touch targets (page strip) | 36px | 48px |
| UPI deep-link | `pa=TODO` placeholder | Real shop.upiId + amount |
| Stepper | ❌ | ✅ Files → Options → Pay |
| Presets | ❌ | ✅ 4 one-tap cards |
| Draft persistence | ❌ | ✅ IndexedDB |
| Offline detection | ❌ | ✅ OfflineBanner + pause polling |
| Tracking aria-live | ❌ | ✅ polite |
| Tracking polling backoff | 5s forever | 5s → 10s → 30s → 60s, stops at 30min |
| Route siblings | ❌ | ✅ loading/error/not-found for /s/ + /o/ |
| i18n | ❌ (English only) | ✅ en/hi/te (60+ strings) |
| Analytics | ❌ | ✅ 17 events, privacy-friendly |
| Sensitive document | ❌ | ✅ Toggle for Aadhaar/PAN |
| Help + Privacy pages | ❌ | ✅ /help + /privacy |
| PWA manifest | Amber theme (shopkeeper) | Cyan-ink theme (customer) |
| Code splitting | Static import | Dynamic (ssr: false) |
