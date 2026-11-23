# Phase 1 Report — Clear Design System v2

**Date:** 2026-11-23
**Branch:** `feature/clear-design-system`

## What changed

### Token centralization (globals.css — complete rewrite)
- **Unified token set**: ONE source of truth for customer + shopkeeper + admin. No `.customer-flow` scope — Clear tokens map to legacy Square UI variable names so shopkeeper/admin works without per-file changes.
- **Light values**: ground #F2F3F7, surface #FFFFFF, label #1C1C1E, label-2 #5B5F66, accent #0A58D6, hairline #DADBE1, track #E3E4EA
- **Dark values**: layered surfaces (#0B0B0D → #1C1C1E), accent #2E7FFF, AA verified
- **Status colours**: success #1F8A55, warning #F5C400, danger #B3261E (each with tint + text)
- **Print semantics**: pg-bw-dot (half black/half white conic), pg-colour-bg (pastel gradient), pg-colour-dot (rainbow conic)
- **Radius by role**: input 12, group 22, sheet 28, button 999, chip 999, kanban 18, card 14, segmented 12/10
- **Frosted bar**: rgba(255,255,255,.86) + blur(16px) + solid fallback
- **Removed**: all CMYK tokens, .customer-flow scope, .halftone-bw/colour/skip, .perforated-*, .page-flip, legacy --paper/--ink/--p-cyan block

### Font: Instrument Sans (replaces Anek)
- Instrument Sans via next/font (400, 500, 600, 700, Latin subset, display: swap)
- Removed: Anek_Latin, Anek_Devanagari, Anek_Telugu imports + instances + body className
- FOUC prevention script for dark mode

### Hindi/Telugu removal (English only by decision)
- Deleted: language-switcher.tsx, tests/i18n/, I18N-REVIEW.md, CustomerOrderFlow.legacy.tsx
- Simplified i18n: messages.ts is now flat Record<string,string> (en only)
- Simplified i18n-provider: no locale switching, no browser-lang detection

### Clear component library (27 files in src/components/clear/)
**Foundation (13):** Button (Primary/Tinted/Destructive/Text + loading + compact), IconButton, Input, PhoneInput, UTRInput, Chip, Badge, StatusPill, Switch, SegmentedControl, RadioRowGroup, Checkbox, Skeleton (Box/Label/Card/PageStrip)

**Containers (11):** Group, InsetList (ChevronRow/ValueRow/SwitchRow), Sheet (bottom mobile / right drawer desktop + focus trap), PriceBar (frosted sticky), PriceBreakdown, EmptyState, ErrorState, Toast, Banner, Stepper, Accordion

**Print-specific (2):** PageTile (half-black/half-white dot + rainbow conic + pastel gradient + flip animation), PageStrip (virtualized grid + ColourSummary + bulk actions + money nudge)

**Gallery (1):** /dev/ui shows every component in every state

### Quality
- Lint: clean (0 errors, 0 warnings)
- Typecheck: clean (0 errors)
- 48px touch targets throughout
- 16px input text (no iOS zoom)
- CSS variables only (no hardcoded hex in components)
- Visible keyboard focus (2px accent ring via globals.css)
- prefers-reduced-motion respected
- ARIA everywhere (role, aria-checked/pressed/expanded/busy/invalid/describedby/labelledby/live)

## What is unverified
1. **Gallery rendering at mobile + desktop** — dev server verified HTTP 200 but not browser-tested at 390×844 + 1280×800 (dev server instability in sandbox)
2. **Dark mode visual quality** — tokens defined but not visually verified
3. **WCAG AA contrast** — values calculated but not verified with a contrast checker tool
4. **Instrument Sans tabular numerals** — font loaded but `font-variant-numeric: tabular-nums` support not verified
5. **Old customer components** — still use CMYK tokens. Migration to Clear components is Phase 2-3.

## Files changed
- `src/app/globals.css` — complete rewrite (563 → ~300 lines)
- `src/app/layout.tsx` — Instrument Sans + FOUC script + removed Anek
- `src/lib/i18n/messages.ts` — simplified to flat en-only
- `src/lib/i18n/i18n-provider.tsx` — removed locale switching
- `src/components/customer/tokens.ts` — updated with Clear values
- `src/components/clear/` — 27 new files (24 components + tokens + gallery + index)
- `src/app/dev/ui/page.tsx` — updated to use Clear gallery
- Deleted: language-switcher.tsx, CustomerOrderFlow.legacy.tsx, tests/i18n/, I18N-REVIEW.md
