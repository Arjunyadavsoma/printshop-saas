# PRINTELYX — Consumer Design System

**Date:** 2026-11-27
**Source of truth:** `docs/PRINTELYX-DESIGN-DECISION.md` (selected methodology: "Impeccable")

This document references the design decision and adds component-level implementation standards. For tokens, typography, colors, spacing, radii, and responsive rules, see `docs/PRINTELYX-DESIGN-DECISION.md`.

## Component Standards (already implemented)

All components use the existing `src/components/clear/` library:
- `button.tsx` — PrimaryButton, TintedButton, TextButton, DestructiveButton
- `input.tsx`, `phone-input.tsx`, `number-stepper.tsx`
- `price-breakdown.tsx`, `price-bar.tsx`
- `status-pill.tsx`, `status-timeline.tsx`
- `utr-input.tsx`, `payment-sheet.tsx`
- `skeleton.tsx`, `error-state.tsx`, `empty-state.tsx`
- `consumer-page.tsx`, `consumer-tab-bar.tsx`
- `banner.tsx`, `toast.tsx`, `sheet.tsx`

## Design tokens (CSS variables in globals.css)

Defined as `--accent`, `--accent-press`, `--accent-tint`, `--ground`, `--surface`, `--label`, `--label-2`, `--label-3`, `--hairline`, `--success`, `--warning`, `--error`. All components reference these variables — no hardcoded colors.

## Approved patterns

1. **Sticky bottom bar (mobile):** `fixed bottom-0 left-0 right-0 z-40` + `pb-[max(0.75rem,env(safe-area-inset-bottom))]`
2. **Sticky right sidebar (desktop):** `lg:sticky lg:top-24`
3. **Card:** `rounded-[16px] border border-[var(--hairline)] bg-[var(--surface)] p-4 sm:p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]`
4. **Loading:** `loading={placing}` on PrimaryButton shows spinner + disables
5. **Error:** `role="alert"` red banner with clear message + retry
6. **Empty state:** illustration + helpful copy + primary action

## Consistency across routes

All consumer routes use the `ConsumerPage` wrapper from `src/components/clear/consumer-page.tsx` which provides the consistent header, max-width container, and background.
