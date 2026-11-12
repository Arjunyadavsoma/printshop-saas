# Square UI Migration — Design Brief (Stages D–I)

Reference for all route redesigns. Read this before editing any route.

## 1. Design Tokens (already in src/app/globals.css)

| Purpose | Class | Notes |
|---|---|---|
| Page background | `bg-page` | Outermost wrapper behind content |
| Card / panel surface | `bg-surface` | Cards, sidebar, topbar |
| Elevated surface | `bg-surface-elevated` | Hovered/active cards |
| Brand fill | `bg-brand` + `text-brand-foreground` | Primary buttons, logo |
| Brand soft | `bg-brand-soft` + `text-brand` | Active nav, subtle highlights |
| Success | `bg-success-soft` + `text-success` | Badges, positive metrics |
| Warning | `bg-warning-soft` + `text-warning-foreground` | Cautions |
| Info | `bg-info-soft` + `text-info` | Neutral info |
| Danger | `bg-danger-soft` + `text-danger` | Errors, destructive |
| Muted text | `text-muted-foreground` | Secondary text |
| Foreground | `text-foreground` | Primary text |
| Border | `border-border` | All dividers/borders |

**Never use hardcoded hex colors or arbitrary `bg-[#...]` / `text-[#...]`.**
**Never use indigo/blue Tailwind shades** — use the `brand` token.

## 2. Typography Scale (MANDATORY)

| Class | Size | Use |
|---|---|---|
| `text-2xl` | 24px | Page title (via PageHeader) |
| `text-xl` | 20px | Section heading |
| `text-lg` | 18px | Subsection / card title |
| `text-base` | 16px | Body text, inputs |
| `text-sm` | 14px | Labels, secondary text, table cells |
| `text-xs` | 12px | Metadata, badges, captions |

**FORBIDDEN:** `text-[9px]`, `text-[10px]`, `text-[11px]`, `text-[12px]` (use `text-xs`).
Replace every arbitrary small-font with `text-xs`. Use `.tabular-nums` for all
financial/numeric values. Use `.text-table-meta` only for justified dense
numeric table columns.

## 3. Shared Components (src/components/shared/)

- **`PageHeader`** — title (h1), description, actions, breadcrumbs. Put at the
  top of EVERY page. Import: `@/components/shared/page-header`.
- **`OrderStatusBadge`** / **`StatusIndicator`** — use for ALL status display.
  Import: `@/components/shared/status-indicator`. Never build ad-hoc status badges.
- **`EmptyState`** — for empty lists. Import: `@/components/shared/empty-state`.
- **`CardSkeleton` / `ListSkeleton` / `TableSkeleton` / `PageSkeleton`** — for
  loading states. Import: `@/components/shared/loading-skeleton`.

## 4. Layout Rules

- Shop routes (`/shop/*`): the `shop/layout.tsx` already wraps pages in
  `AppShell` (sidebar + topbar + footer). **Pages must NOT render their own
  sidebar, header, or footer.** Render content directly inside the page.
- Use `<div className="space-y-6">` as the page root container.
- Use `PageHeader` as the first child.
- Wrap content sections in shadcn `Card` (`CardHeader` + `CardContent`).
- Sticky footer is handled by AppShell — do not add footers in pages.

## 5. Component Sizing

- Buttons: use `size="sm"` for table/in-card actions, default for primary.
- Inputs: default height; `text-base` to prevent mobile zoom.
- Cards: `p-4` or `p-6` content padding; `gap-4` or `gap-6` spacing.
- Tables: wrap in `Card`, use shadcn `Table` primitives.
- Long lists: `max-h-96 overflow-y-auto` with custom scrollbar.

## 6. Responsive

- Mobile-first. Test 375px, 768px, 1280px.
- Grids: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 lg:grid-cols-4`.
- Hide secondary columns on mobile (`.hidden sm:table-cell`).
- Touch targets ≥ 44px.

## 7. Dark Mode

- Use semantic tokens only — they auto-adapt.
- Test both light and dark. No hardcoded whites/blacks.
- `bg-white`, `bg-black` → `bg-surface`, `bg-background`.

## 8. States

- **Loading**: skeleton components (not spinners for lists).
- **Empty**: `EmptyState` with icon + description + optional action.
- **Error**: `Card` with `text-danger` message + retry button.
- **Success**: `sonner` toast (`import { toast } from 'sonner'`).

## 9. PRESERVATION RULES (CRITICAL)

- **Do NOT touch** any API call, fetch, `api.request(...)`, endpoint URL.
- **Do NOT touch** pricing calculations, payment verification, webhook logic.
- **Do NOT touch** state management (useState/useEffect/useReducer).
- **Do NOT touch** form validation logic (zod schemas, etc.).
- **Do NOT change** any `src/app/api/**` route.
- **Do NOT run git commands** (no `git checkout`, `git stash`, `git commit`).
- **Do NOT** install new packages.
- Preserve all `aria-*`, `role`, accessibility attributes. Improve where
  missing (add `aria-label` to icon-only buttons).
- Keep all existing functionality working.

## 10. What to Change

- JSX structure and layout (cards, grids, spacing).
- CSS classes (use semantic tokens, normalize typography).
- Use shared components (PageHeader, OrderStatusBadge, EmptyState, skeletons).
- Add proper loading/empty/error states where missing.
- Improve responsive behavior.
- Ensure dark-mode correctness.

## 11. Card Pattern (reference)

```tsx
<Card className="bg-surface">
  <CardHeader className="pb-3">
    <CardTitle className="text-base font-semibold">Title</CardTitle>
    <CardDescription className="text-sm text-muted-foreground">
      Description
    </CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* content */}
  </CardContent>
</Card>
```

## 12. Metric Card Pattern (reference)

```tsx
<Card className="bg-surface">
  <CardContent className="p-5">
    <p className="text-sm text-muted-foreground">Revenue (today)</p>
    <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">₹1,234</p>
    <p className="mt-1 text-xs text-muted-foreground">3 orders</p>
  </CardContent>
</Card>
```
