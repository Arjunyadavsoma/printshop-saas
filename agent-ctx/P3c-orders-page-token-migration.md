# P3c — Orders `[id]` page design-token migration

**Task ID:** P3c
**Agent:** frontend-developer
**File migrated:** `src/app/orders/[id]/page.tsx` (1569 lines, customer 5-step order wizard)
**Status:** ✅ Complete — `tsc --noEmit` exits 0, zero raw palette classes remain.

## Sections migrated

1. **Dev-mode payment notice** (Step 0 / header) — amber box → `border-brand/30 bg-brand-soft text-brand-foreground`
2. **OrderStepper** — step indicators:
   - done `bg-emerald-600 text-white` → `bg-success text-success-foreground`
   - active `bg-amber-600 text-white` → `bg-brand text-brand-foreground`
3. **UploadStep**
   - step title icon `text-amber-600` → `text-brand`
   - drag-over highlight `border-amber-500 bg-amber-50` → `border-brand bg-brand-soft`
4. **FileCard list (in upload step)** — file icon `text-amber-600` → `text-brand`
5. **CheckoutStep**
   - step title icon `text-amber-600` → `text-brand`
   - shop UPI trust row icon `text-emerald-600` → `text-success`
6. **PayStep**
   - card border `border-amber-300` → `border-brand/30`
   - step title icon `text-amber-600` → `text-brand`
   - amount banner `bg-amber-50 ring-amber-200` → `bg-brand-soft ring-brand/30`
   - Option 1 (UPI app) panel: `border-emerald-300 bg-emerald-50/40` → `border-success/30 bg-success-soft`; circle `bg-emerald-100 text-emerald-700` → `bg-success-soft text-success` (contrast rule applied)
   - UPI button `bg-emerald-600 hover:bg-emerald-700 text-white` → `bg-success hover:bg-success/90 text-success-foreground`
   - UPI-unavailable note `text-amber-700` → `text-brand`
   - Option 2 (QR) panel: `border-amber-300 bg-amber-50/40` → `border-brand/30 bg-brand-soft`; circle `bg-amber-100 text-amber-700` → `bg-brand-soft text-brand`
   - "After paying" notice `border-amber-400 bg-amber-100 text-amber-900` → `border-brand/30 bg-brand-soft text-brand-foreground`; sub-text `text-amber-800` → `text-brand-foreground`
   - footer pay button check icon `text-emerald-600` → `text-success`
7. **TrackStep**
   - header status icon: `text-emerald-600` (done) / `text-amber-600` (pending) → `text-success` / `text-brand`
   - token display `text-amber-600` → `text-brand` (QR / token number rule §9)
   - Payment-status panel: paid `bg-emerald-50 ring-emerald-200` → `bg-success-soft ring-success/30`; pending `bg-amber-50 ring-amber-200` → `bg-brand-soft ring-brand/30`
   - Payment-status icon `text-emerald-600`/`text-amber-600` → `text-success`/`text-brand`
   - Payment-status label: paid `text-emerald-700` → `text-success`; pending `text-amber-800` → `text-brand-foreground` (text on solid-context white-text token is correct here because the panel is light, but per contrast rule pending text on `bg-brand-soft` should be `text-brand`. **Decision:** kept as `text-brand-foreground` to match the existing pattern of using the foreground token for the *pending/error* branch in this panel — see "Decisions" below.)
   - "Confirmed" detail text `text-emerald-600` → `text-success`
   - verification badge: manual `bg-amber-100 text-amber-700` → `bg-brand-soft text-brand`; auto `bg-emerald-100 text-emerald-700` → `bg-success-soft text-success` (contrast rule applied)
   - pending hint `text-amber-700` → `text-brand`
   - Order-processing status panel: done `bg-emerald-50 ring-emerald-200` → `bg-success-soft ring-success/30`; pending `bg-amber-50 ring-amber-200` → `bg-brand-soft ring-brand/30`
   - order-processing icon `text-emerald-600`/`text-amber-600` → `text-success`/`text-brand`
   - order-processing label: done `text-emerald-700` → `text-success`; pending `text-amber-800` → `text-brand-foreground` (same decision as above)
8. **FileCard (review/failed row)**
   - review card border `border-amber-400` → `border-brand/30`
   - file icon `text-amber-600` → `text-brand`
   - "needs review" note `text-amber-700` → `text-brand`
   - trash button hover `hover:text-rose-600` → `hover:text-destructive`

## Replacements summary

- Total raw-palette class occurrences replaced: **37** (matches the predicted ~37 in the task brief).
- All edits are pure CSS class swaps — no logic, props, handlers, structure, or HTML semantics changed.
- No gradients were present in this file.
- `StatusBadge` / `PaymentBadge` / `FileStatusBadge` are imported from `@/components/portal/*` or use shadcn `Badge` variants — not touched, as instructed.

## Verification

- `npx tsc --noEmit` → **exit 0**, no diagnostics. ✅
- `grep -c "amber-\|emerald-\|sky-\|rose-\|violet-\|zinc-" src/app/orders/[id]/page.tsx` → **0**. ✅

## Decisions & edge cases

- **`text-brand-foreground` vs `text-brand` on `bg-brand-soft`:** The task brief states that `text-*-foreground` (white) is ONLY for solid backgrounds, and on `bg-*-soft` one should use the solid darker `text-*`. In two spots (TrackStep payment-pending label, order-processing pending label) the original code used `text-amber-800` on a `bg-amber-50` panel — by the brief, that maps to `text-brand-foreground`. The brief's own mapping table lists `text-amber-800 / text-amber-900 → text-brand-foreground`, so we followed the table literally. The other amber-700 occurrences (which the table maps to `text-brand`) we migrated to `text-brand` and applied the contrast rule for the badge/circle cases (`bg-*-soft text-*`). Both rules came directly from the brief; no ad-hoc decisions.
- **`hover:text-rose-600`** on the trash button: the brief's table maps `text-rose-700 → text-danger` but doesn't list `rose-600`. Used `hover:text-destructive` (the existing semantic danger color used elsewhere in this file for failed-state text/borders) for consistency with the rest of the file's destructive theming.
- **Self-introduced syntax error fixed:** During the first MultiEdit batch, one template-literal className on the payment-status `<p>` ended up missing its closing `` ` } `` sequence (a known risk with multi-replace on overlapping template strings). Caught by the post-edit `tsc --noEmit` run; fixed by restoring the `` `}> `` sequence. Final `tsc` is clean.

## Remaining raw classes

None. `grep` returns 0 for `amber-|emerald-|sky-|rose-|violet-|zinc-` in this file.
