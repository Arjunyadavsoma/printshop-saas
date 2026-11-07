# Admin Portal — Design-Token Migration + StatusBadge/truncate Dedup

**Task ID**: P5
**Agent**: full-stack-developer
**Date**: 2026-10-22
**Scope**: `src/app/admin/**` (9 files)

## Summary

Migrated every admin page from raw Tailwind palette classes (`amber-*`, `emerald-*`, `sky-*`, `rose-*`, `violet-*`, `zinc-*`) to the PrintShop semantic design tokens (`bg-brand`, `bg-success-soft`, `text-info-foreground`, `bg-primary`, etc.) defined in `src/app/globals.css`. Simultaneously deduplicated the four inline `StatusBadge` copies by importing the shared `src/components/portal/status-badge.tsx`, and consolidated four inline `truncate` helpers into the shared `src/lib/utils.ts` export.

No logic, state, props, API calls, event handlers, or HTML semantics were changed. The only structural addition is a visually-hidden `<h1 className="sr-only">` at the top of each admin content page (the audit flagged that admin content pages had no `<h1>`).

## Files migrated (9)

| # | File | Lines | Inline StatusBadge removed? | Inline truncate removed? | `<h1>` sr-only added? |
|---|------|-------|------------------------------|--------------------------|------------------------|
| 1 | `src/app/admin/layout.tsx` | 250 | n/a (none) | n/a | n/a (visible `<h1>` already in top bar) |
| 2 | `src/app/admin/page.tsx` | ~460 | ✅ + `STATUS_COLORS` replaced with `STATUS_BADGE_CLASS` alias | ✅ (default 8 — all call sites pass explicit lengths) | ✅ "Dashboard" |
| 3 | `src/app/admin/login/page.tsx` | 158 | n/a | n/a | n/a (visible `<h1>` already present in 404 + form) |
| 4 | `src/app/admin/orders/page.tsx` | 316 | ✅ | ✅ (default 10 — all call sites pass explicit lengths 10/10/12, so the shared default of 8 is compatible) | ✅ "All orders" |
| 5 | `src/app/admin/orders/[id]/page.tsx` | 474 | ✅ + `STATUS_COLORS` removed | n/a (file used `.slice(0, 8)` directly, no inline truncate) | ✅ "Order detail" |
| 6 | `src/app/admin/shops/page.tsx` | 293 | n/a (none) | n/a | ✅ "Shop directory" |
| 7 | `src/app/admin/shops/[id]/page.tsx` | 376 | ✅ | ✅ (default 8 — all call sites pass explicit lengths) | ✅ "Shop detail" |
| 8 | `src/app/admin/analytics/page.tsx` | 439 | n/a | n/a | ✅ "Analytics" |
| 9 | `src/app/admin/monitoring/page.tsx` | 464 | n/a | ✅ (default 8 — all call sites pass explicit lengths) | ✅ "Monitoring" |

## Class replacements applied (~95 total)

### Dark sidebar / login chrome (rule #5 — emerald accent unified to brand)

- `bg-zinc-900` (sidebar) → `bg-primary`
- `border-zinc-800` (on dark) → `border-primary-foreground/10`
- `text-zinc-100` / `text-zinc-200` / `text-zinc-300` (on dark) → `text-primary-foreground`
- `text-zinc-400` (muted-on-dark) → `text-primary-foreground/70`
- `hover:bg-zinc-800` / `hover:bg-zinc-700` → `hover:bg-primary-foreground/10`
- `bg-emerald-600 text-white` (logo / login button) → `bg-brand text-brand-foreground`
- `text-emerald-600` / `text-emerald-400` (sidebar accent + ShieldCheck) → `text-brand`
- `bg-zinc-950` (login page bg, not in table) → `bg-primary` (interpreted as darkest dark surface)
- `bg-zinc-900` (login Card) → `bg-primary/90` (slightly lifted dark surface)
- `border-zinc-700` (login input border) → `border-primary-foreground/10`

### Status / KPI accents (per the mapping table)

- `bg-amber-100` / `bg-amber-50` → `bg-brand-soft`
- `text-amber-700` / `text-amber-600` → `text-brand`
- `text-amber-800` / `text-amber-900` → `text-brand-foreground`
- `border-amber-200` / `border-amber-300` → `border-brand/30`
- `bg-emerald-100` / `bg-emerald-50` → `bg-success-soft`
- `text-emerald-700` / `text-emerald-600` → `text-success-foreground`
- `border-emerald-200` / `border-emerald-300` → `border-success/30`
- `bg-emerald-500` (HealthDot) → `bg-success`
- `bg-sky-100` → `bg-info-soft`
- `text-sky-800` / `text-sky-700` / `text-sky-600` → `text-info-foreground`
- `bg-violet-100` → `bg-muted`
- `text-violet-800` / `text-violet-700` / `text-violet-600` → `text-muted-foreground`
- `bg-zinc-200` / `bg-zinc-100` / `bg-zinc-50` → `bg-muted`
- `text-zinc-700` / `text-zinc-600` / `text-zinc-500` / `text-zinc-900` → `text-muted-foreground` / `text-foreground`
- `border-zinc-200` / `border-zinc-300` (on light) → `border-border`
- `bg-zinc-400` (HealthDot unknown) → `bg-muted-foreground`

### Link / button accents (emerald-as-link unified to brand for cross-portal consistency)

- `text-emerald-700 dark:text-emerald-400` (links) → `text-brand`
- `text-emerald-700 hover:underline dark:text-emerald-400` → `text-brand hover:underline`

### All `dark:*` variants for migrated colors were dropped

The semantic tokens are theme-adaptive via the `:root` + `.dark` blocks in `globals.css`, so `dark:bg-emerald-950`, `dark:text-emerald-300`, etc. are redundant and were removed.

## StatusBadge deduplication

Four admin pages defined their own inline `StatusBadge` function plus a `STATUS_COLORS` constant. All four were deleted and replaced with:

```ts
import { StatusBadge } from '@/components/portal/status-badge';
```

Files that lost their inline `StatusBadge`:
- `src/app/admin/page.tsx` — also kept a `STATUS_BADGE_CLASS` import because the orders-by-status tooltip at the bottom of the dashboard still needs a status→class lookup (aliased as `const STATUS_COLORS = STATUS_BADGE_CLASS` to minimise the diff at the call site).
- `src/app/admin/orders/page.tsx`
- `src/app/admin/orders/[id]/page.tsx`
- `src/app/admin/shops/[id]/page.tsx`

The shared `StatusBadge` accepts `{ status: OrderStatus | string }` — the same signature the inline copies used. The `OrderStatus` type from `@/components/portal/admin-types` is structurally identical to the `OrderStatus` from `@platform/core/domain` that the shared component imports (both are the same 7-value string union), so all call sites type-check cleanly.

In `admin/orders/[id]/page.tsx`, the file also had two other status-colour maps — `FILE_STATUS_COLORS` (per-file print status) and `JOB_STATUS_COLORS` (per-print-job status). These were NOT deduplicated (no shared component exists for them) but their raw palette values were migrated to semantic tokens per the mapping table.

## truncate consolidation

Four admin pages defined their own inline `truncate`:

| File | Old default | Call sites | Action |
|------|-------------|------------|--------|
| `admin/monitoring/page.tsx` | 8 | `truncate(o.id, 8)`, `truncate(o.customerToken, 10)`, `truncate(o.paymentTxnId, 12)`, `truncate(e.entityId, 8)`, `truncate(e.shopId, 8)`, `truncate(e.userId, 8)` — all explicit | Removed inline; `import { truncate } from '@/lib/utils'` (default 8) |
| `admin/orders/page.tsx` | **10** | `truncate(o.id, 10)`, `truncate(o.customerToken, 10)`, `truncate(o.paymentTxnId, 12)` — all explicit | Removed inline; `import { truncate } from '@/lib/utils'` (default 8). The old default of 10 was never actually used by any call site (all pass explicit lengths), so the shared default of 8 is fully compatible. |
| `admin/shops/[id]/page.tsx` | 8 | `truncate(o.id, 8)`, `truncate(o.customerToken, 10)`, `truncate(o.paymentTxnId, 12)` — all explicit | Removed inline; `import { truncate } from '@/lib/utils'` |
| `admin/page.tsx` | 8 | `truncate(o.id, 8)` — explicit | Removed inline; `import { truncate } from '@/lib/utils'` |

`admin/orders/[id]/page.tsx` did NOT have an inline `truncate` (it used `.slice(0, 8)` directly on the order ID), so no change there.

## Touch-target fixes (rule #7)

- The mobile menu trigger in `admin/layout.tsx` (`size="icon"` → `size-9` = 36px) was bumped to `h-11 w-11` (44px) — visible only on mobile via the `lg:hidden` wrapper.
- Every `Refresh` button (`size="sm"` → `h-8` = 32px) across the admin content pages got `min-h-[44px]` added to its className to meet the 44px touch-target on mobile while staying compact on desktop.
- The login submit button already had `min-h-[44px]` — kept.
- The pagination Prev/Next buttons in `admin/orders/page.tsx` and `admin/shops/page.tsx` already had `min-h-[44px] min-w-[44px]` — kept.

## Structural change: `<h1 className="sr-only">` (rule #6)

Added a visually-hidden `<h1>` at the top of each admin content page's root `<div>`:

- `admin/page.tsx` → `<h1 className="sr-only">Dashboard</h1>`
- `admin/orders/page.tsx` → `<h1 className="sr-only">All orders</h1>`
- `admin/orders/[id]/page.tsx` → `<h1 className="sr-only">Order detail</h1>`
- `admin/shops/page.tsx` → `<h1 className="sr-only">Shop directory</h1>`
- `admin/shops/[id]/page.tsx` → `<h1 className="sr-only">Shop detail</h1>`
- `admin/analytics/page.tsx` → `<h1 className="sr-only">Analytics</h1>`
- `admin/monitoring/page.tsx` → `<h1 className="sr-only">Monitoring</h1>`

`admin/layout.tsx` already has a visible `<h1>` in the sticky top bar ("PrintShop Admin"), and `admin/login/page.tsx` already has visible `<h1>` elements in both its 404 state and its login form — so neither needed an additional sr-only heading.

## Verification

- `npx tsc --noEmit` → **exit 0**, zero type errors.
- `rg "amber-|emerald-|sky-|rose-|violet-|zinc-" src/app/admin/` → **0 matches** (the only remaining occurrence was a stale JSDoc comment in `admin/layout.tsx` that said "uses a zinc-900 sidebar with an emerald accent" — updated to "uses a bg-primary dark sidebar with a bg-brand amber accent").
- `rg "function StatusBadge|const StatusBadge" src/app/admin/` → **0 matches** (all 4 inline copies removed).
- `rg "function truncate" src/app/admin/` → **0 matches** (all 4 inline copies removed).
- `rg "bg-gradient-to" src/app/admin/` → **0 matches** (no gradients existed in admin pages; rule #4 satisfied trivially).
- Dev server log shows clean compiles (`GET / 200`), no runtime errors.

## Remaining raw palette classes (intentional)

The mapping table does NOT cover `red-*` or `orange-*` (only `rose-*` is mapped, and no admin page uses rose). The following raw palette classes were intentionally LEFT AS-IS per the strict "apply EXACTLY" rule:

- `bg-red-100`, `text-red-800`, `dark:bg-red-950`, `dark:text-red-300` — error / failed / cancelled / unhealthy indicators (the mapping table has no `red-*` entry; the shared `StatusBadge` uses `bg-danger-soft text-danger-foreground border-danger/30` for the `cancelled` status, but for the inline error cards and `FILE_STATUS_COLORS.failed` / `JOB_STATUS_COLORS.failed` / `needs_review` entries, the raw red/orange palette was retained because no mapping was specified).
- `text-red-600` — `AlertCircle` / `XCircle` icons in error cards.
- `text-red-700 dark:text-red-300` — "last error" text in print jobs table; "Unhealthy" label in HealthTile.
- `border-red-200`, `bg-red-50`, `dark:border-red-900`, `dark:bg-red-950/40` — error Card borders/backgrounds.
- `bg-orange-100`, `text-orange-800`, `dark:bg-orange-950`, `dark:text-orange-300` — `needs_review` status in FILE_STATUS_COLORS and JOB_STATUS_COLORS (orange has no mapping entry).

The verification grep in the task spec (`amber-|emerald-|sky-|rose-|violet-|zinc-`) does not check for `red-` or `orange-`, so these remaining classes are acceptable.

## Recharts hex colors (admin/analytics/page.tsx)

The bar chart in `admin/analytics/page.tsx` uses inline hex color attributes on recharts components:
- `CartesianGrid stroke="#e4e4e7"` (zinc-200 hex)
- `XAxis stroke="#71717a"` / `YAxis stroke="#71717a"` (zinc-500 hex)
- `Tooltip contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e4e4e7', ... }}`
- `Bar fill="#10b981"` (emerald-500 hex), `Bar fill="#f59e0b"` (amber-500 hex), `Bar fill="#ef4444"` (red-500 hex)

These are **inline SVG/style attributes**, not Tailwind CSS class names. Rule #1 explicitly says "ONLY change CSS class names" — so these hex values were left untouched. (Converting them to CSS variables would require either a `<defs>` + `var(--color-*)` reference in SVG, or moving the chart colors to a CSS class — both of which exceed the "only change class names" scope.)

## Issues / notes

- **Design-system contrast caveat**: The shared `StatusBadge` (in `src/components/portal/status-badge.tsx`, which is off-limits for this task) pairs `bg-success-soft` (very-light-green, L=0.95) with `text-success-foreground` (near-white, L=0.985) in light mode — a near-invisible combination. This same pattern is replicated across the customer portal and shopkeeper portal. Since the task says "apply EXACTLY" and the shared component is the canonical pattern, I followed the table strictly (`text-emerald-600 → text-success-foreground`, etc.). If low-contrast badges appear in the admin UI, the fix belongs in `globals.css` (redefining `--success-foreground` / `--info-foreground` for light mode) or in the shared `StatusBadge` — both outside this task's scope.
- **`truncate` default change**: The inline `truncate` in `admin/orders/page.tsx` had a default of 10 (vs. the shared default of 8). I verified that NO call site in that file relied on the default — every call passes an explicit length (10, 10, or 12). So consolidating to the shared `truncate` (default 8) is fully behaviour-preserving.
- **`admin/page.tsx` `STATUS_COLORS` alias**: The dashboard's "Orders by status (today)" tooltip at the bottom of the page uses `STATUS_COLORS[status as OrderStatus]` to colour a `<div>` per status. Rather than rewriting that call site, I kept a one-line alias `const STATUS_COLORS: Record<OrderStatus, string> = STATUS_BADGE_CLASS;` so the existing call site works unchanged. This is the minimum-diff approach.
