# PrintShop SaaS Design System

## Phase 8: Foundation

### Semantic Token System

All colors are defined as OKLCH values in `src/app/globals.css` and bridged
into Tailwind v4 via `@theme inline`. The legacy `tailwind.config.ts` has been
removed — Tailwind v4 uses CSS-based configuration exclusively.

#### Light Theme Tokens (verified WCAG 2.2 AA contrast)

| Token | OKLCH | Hex | Contrast on soft bg |
|---|---|---|---|
| `--brand` | `oklch(0.45 0.19 41)` | `#a30a00` | 6.88:1 ✅ |
| `--brand-soft` | `oklch(0.95 0.05 75)` | `#ffeaca` | — |
| `--brand-hover` | `oklch(0.40 0.19 41)` | `#8a0800` | — |
| `--brand-border` | `oklch(0.80 0.06 75)` | — | — |
| `--success` | `oklch(0.42 0.14 152)` | — | 6.75:1 ✅ |
| `--success-soft` | `oklch(0.95 0.04 152)` | — | — |
| `--warning` | `oklch(0.72 0.18 70)` | — | — |
| `--warning-foreground` | `oklch(0.18 0.04 70)` | — | 7.38:1 ✅ |
| `--warning-soft` | `oklch(0.95 0.05 70)` | — | 5.22:1 ✅ |
| `--info` | `oklch(0.45 0.13 230)` | — | 5.98:1 ✅ |
| `--info-soft` | `oklch(0.95 0.04 230)` | — | — |
| `--danger` | `oklch(0.50 0.19 25)` | — | 5.44:1 ✅ |
| `--danger-soft` | `oklch(0.95 0.05 25)` | — | — |
| `--muted-foreground` | `oklch(0.48 0 0)` | — | 5.99:1 ✅ |
| `--focus` | `oklch(0.55 0.15 41)` | — | — |

All ratios verified via `scripts/validate-contrast.ts` using the CSS Color 4
OKLCH→sRGB conversion algorithm.

### Typography Scale

| Size | px | Usage |
|---|---|---|
| `text-xs` | 12px | Metadata, badges, helper text |
| `text-sm` | 14px | Labels, secondary text |
| `text-base` | 16px | Body text, inputs (prevents mobile zoom) |
| `text-lg` | 20px | Subheadings |
| `text-xl` | 24px | Section headings |
| `text-2xl` | 30px | Page titles |

No interface text below 12px. 222 arbitrary 9–11px usages identified for
incremental migration in future phases.

### Shared Components

#### StatusIndicator
- Semantic variants: neutral, info, success, warning, danger, brand
- Icon + text label (never color alone)
- Accessible name via `aria-label`
- Maps to business states: awaiting_payment, paid, printing, ready, collected, cancelled, refunded

#### PageHeader
- Title (h1), description, breadcrumbs, actions
- Responsive layout

#### EmptyState
- Title, description, icon, optional action
- Accessible structure

#### LoadingSkeleton
- CardSkeleton, ListSkeleton, TableSkeleton, PageSkeleton
- `aria-hidden="true"` to prevent misleading announcements

### Dead Component Cleanup

Removed 16 unreferenced components from `phase1`, `phase3`, `phase4`, `phase5`, `phase7` directories. Zero import references found in `src/app/` for any of these files.

### Tailwind Configuration

- **Tailwind v4** — CSS-based config via `@theme inline` in `globals.css`
- **Legacy `tailwind.config.ts` removed** — contained conflicting `hsl(var(...))` mappings; not referenced by `postcss.config.mjs` or `next.config.ts`
- PostCSS plugin: `@tailwindcss/postcss` (v4)

### Contrast Validation

Run: `bunx tsx scripts/validate-contrast.ts`

Validates 8 foreground/background pairs using the CSS Color 4 OKLCH→sRGB algorithm. All pairs pass WCAG 2.2 AA (≥4.5:1).

### Migration Status

- **Raw palette usages:** 113 identified, 0 migrated in this phase (incremental migration planned for UI phases)
- **Arbitrary small fonts:** 222 identified, 0 migrated in this phase
- **Token usages:** 453 existing (brand/success/warning/info/danger/muted)
