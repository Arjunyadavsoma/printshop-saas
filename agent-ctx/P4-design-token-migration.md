# P4 — Shopkeeper Portal Design Token Migration

**Task ID:** P4
**Agent:** Claude (fullstack-dev)
**Date:** 2025-11
**Scope:** Migrate ALL 9 shopkeeper pages under `/src/app/shop/**` from raw Tailwind palette classes (`amber-`, `emerald-`, `sky-`, `rose-`, `violet-`, `zinc-`) to the semantic design tokens defined in `src/app/globals.css` (`bg-brand`, `text-success-foreground`, `bg-danger-soft`, etc.).

## Files migrated (9/9)

| File | Lines | Approximate class replacements | Notes |
|---|---|---|---|
| `src/app/shop/layout.tsx` | 302 | 6 | Sidebar active state, brand badge, owner badge, footer brand mark |
| `src/app/shop/login/page.tsx` | 225 | 11 | Gradient → `bg-brand-soft`; demo accounts card |
| `src/app/shop/register/page.tsx` | 804 | 19 | Password-strength colors (`bg-rose-500`/`bg-amber-500`/`bg-emerald-500` → `bg-danger`/`bg-warning`/`bg-success`); 4-step wizard dots; payment-method picker; service checkboxes |
| `src/app/shop/dashboard/page.tsx` | 894 | 30 | Stat tiles (5 tones); printer-engine callout; payment queue; ready-for-pickup queue; **`timeAgo` consolidated to `@/lib/utils`**; inline `PaymentMiniBadge` colors migrated (kept inline since rule #5 only mentions orders pages) |
| `src/app/shop/orders/page.tsx` | 1050 | 19 | Filterable list; batch-print bar; **inline `PaymentBadge` replaced with shared `@/components/portal/payment-badge`** — `PaymentFilter` mapped (`'rejected'` → `'failed'`) at call site; unused `Badge` import removed |
| `src/app/shop/orders/[id]/page.tsx` | 1258 | 32 | Order detail; status actions; activity timeline; PrintLatch dialog; **inline `PaymentBadge` replaced with shared component** + new `paymentStatusForOrder()` helper maps `OrderStatus`+`paidAt` → payment-status string (`cancelled`→`'failed'`, `refunded`→`'refunded'`, `paidAt`→`'paid'`); `ACTION_LABELS` tones migrated |
| `src/app/shop/printer/page.tsx` | 1139 | ~90 | Engine picker; PrintLatch + Native Printer sections; supply tracking; 7-step setup guides; code blocks (`bg-zinc-900` → `bg-primary`); callouts; badges; many `text-amber-600` icons → `text-brand` |
| `src/app/shop/settings/page.tsx` | 1105 | 21 | 5-tab settings; pricing card; payment error callouts; UPI QR upload button |
| `src/app/shop/reports/page.tsx` | 200 | 8 | Daily report summary cards + verified/pending icons |

**Total approximate class replacements: ~245**

## Verification

### `tsc --noEmit` ✅
```
$ npx tsc --noEmit
(no output — exit code 0)
```
Zero type errors. One transient parse error was caught + fixed (a stray `}` introduced during a MultiEdit on `reports/page.tsx` line 161).

### Raw palette class grep ✅
```
$ grep -rn "amber-\|emerald-\|sky-\|rose-\|violet-\|zinc-" src/app/shop/ | wc -l
0
```
All 9 files are 100% migrated.

### Dev server log ✅
`bun run dev` shows clean compiles (`✓ Ready in 737ms`, `GET / 200 in 64ms`) with no warnings or errors.

## Inline component / utility consolidation

### `PaymentBadge` (rule #5)
Both inline copies replaced with `import { PaymentBadge } from '@/components/portal/payment-badge'`:

1. **`orders/page.tsx`** — old signature `{ status: PaymentFilter }` (`'all'|'pending'|'paid'|'rejected'|'refunded'`). At the call site the `'rejected'` filter value is mapped to `'failed'` (the closest key the shared component recognises for a rejected payment — same red/danger styling):
   ```tsx
   <PaymentBadge status={pstatus === 'rejected' ? 'failed' : pstatus} />
   ```
   The shared component renders `"Failed"` instead of `"Rejected"` for cancelled orders — semantically equivalent (both indicate the payment did not succeed) and the colour stays red.

2. **`orders/[id]/page.tsx`** — old signature `{ status: OrderStatus; paidAt: string | null }` with inline mapping to colours/labels. Replaced with a small helper:
   ```tsx
   function paymentStatusForOrder(status: OrderStatus, paidAt: string | null): string {
     if (status === 'awaiting_payment') return 'pending';
     if (status === 'cancelled') return 'failed';
     if (status === 'refunded') return 'refunded';
     if (paidAt) return 'paid';
     return 'pending';
   }
   // usage:
   <PaymentBadge status={paymentStatusForOrder(order.status, order.paidAt)} paidAt={order.paidAt} />
   ```
   Label changes: `awaiting_payment` "Pending payment" → "Pending"; `cancelled` "Rejected" → "Failed"; `refunded` "Refunded" → "Refunded" (unchanged). Colours preserved (warning / danger / muted).

The dashboard's `PaymentMiniBadge` (different signature: derives label from `paidAt` + status, has a "rejected" label) was **not** replaced — rule #5 scopes the consolidation to the two orders pages only. Its raw palette classes were migrated in place to semantic tokens.

### `timeAgo` (rule #6)
The dashboard had an inline `timeAgo(iso)` returning `"5m ago"` / `"5h ago"`. Replaced with `import { timeAgo } from '@/lib/utils'` (canonical implementation returns `"5 min ago"` / `"5 hr ago"`). All 3 call sites in `dashboard/page.tsx` now use the shared helper. The inline function definition was deleted.

No inline `truncate` or `formatDateTime` were found in any of the 9 files, so no consolidation was needed for those.

## Token mapping notes (edge cases handled)

- **Gradients** (rule #7): `bg-gradient-to-br from-amber-50 via-background to-background` (login + register hero) → solid `bg-brand-soft`. `bg-gradient-to-br from-amber-50 to-white` (dashboard printer callout) → `bg-brand-soft`.
- **Dark code blocks** (rule #8): `bg-zinc-900 text-zinc-100` (`<pre>` blocks in printer page setup guides, `<code>` in CodeBlock helper) → `bg-primary text-primary-foreground`.
- **Alpha variants**: `bg-amber-50/50`, `bg-amber-50/40`, `bg-amber-50/30`, `bg-amber-50/60`, `bg-amber-50/70`, `bg-emerald-50/60`, `bg-emerald-50/50`, `bg-rose-50/50` all collapsed to the solid soft token (`bg-brand-soft`, `bg-success-soft`, `bg-danger-soft`).
- **Password strength** (`register/page.tsx`): `bg-rose-500`→`bg-danger`, `bg-amber-500`→`bg-warning`, `bg-emerald-500`/`bg-emerald-600`→`bg-success`. Preserves the red→yellow→green strength progression.
- **Left-border accents** (dashboard agent banner): `border-l-emerald-400`→`border-l-success/40`, `border-l-amber-400`→`border-l-brand/40` (slightly higher opacity than the standard `/30` to match the original darker 400-shade accent).
- **Step indicator dots** (register progress): `border-amber-500`→`border-brand`, `border-emerald-400`→`border-success/30` (with bg-success-soft + text-success-foreground for the "done" state).
- **Hover variants**: `hover:bg-amber-700`→`hover:bg-brand/90`, `hover:border-amber-400`→`hover:border-brand/40`, etc. — all hover mappings per the spec.
- **`focus:ring-amber-400`** (printer page download button + engine picker buttons) → `focus:ring-brand`.

## Issues / unresolved

- **`PaymentMiniBadge` in `dashboard/page.tsx`** — kept inline (not in scope for rule #5). Its colour classes were migrated to semantic tokens. The "rejected" label for cancelled orders is preserved (different from the shared component's "Cancelled"/"Failed"). This is a minor inconsistency between the dashboard mini badge and the orders-page full badge — to fully consolidate, the shared `PaymentBadge` would need a `'rejected'` key mapping, but that's outside this task's scope.
- **Label changes from `PaymentBadge` consolidation**: the orders list/detail pages now show `"Failed"` instead of `"Rejected"` for cancelled orders. Functionally equivalent (both indicate the payment didn't succeed) and the red/danger colour is preserved. Documented here for product awareness.
- **`timeAgo` label change**: dashboard now shows `"5 min ago"` / `"5 hr ago"` (canonical `@/lib/utils` format) instead of the old `"5m ago"` / `"5h ago"`. Slightly longer text but consistent with all other portal pages that already used the canonical helper.
- No other issues. `tsc --noEmit` passes clean, dev server compiles clean, zero raw palette classes remain in `/src/app/shop/**`.
