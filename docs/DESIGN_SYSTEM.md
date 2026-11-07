# PrintShop SaaS — Design System

> The single source of truth for the PrintShop visual identity: tokens,
> typography, spacing, components, patterns. Read this before styling
> any component. Pair with `docs/references/ENGINEERING_PLAYBOOK.md`
> (the rules) and `docs/REDESIGN_AUDIT.md` (the findings).

**Status:** v1.0 — established 2025-11-07. Tokens implemented in
`src/app/globals.css`. Migration of existing pages from raw Tailwind
palette classes to tokens is tracked in `docs/REDESIGN_PROGRESS.md`.

---

## 1. Brand identity

PrintShop is a QR-based print-shop management platform for the Indian
market. The visual identity communicates:

| Trait | How it's expressed |
|---|---|
| **Trust** | Solid colors, no gimmicks, clear typography, verifiable UPI payments |
| **Simplicity** | Mobile-first, one primary action per screen, progressive disclosure |
| **Speed** | Minimal chrome, fast LCP, no unnecessary animations |
| **Professional printing** | Clean cards, tabular data, operational dashboards |
| **Financial transparency** | Paise-based pricing always visible, 0% commission badge |
| **Operational reliability** | Status badges with consistent semantics, real-time updates |

**What we are NOT:** a generic AI-generated SaaS template. No gradient
heroes. No "three feature cards with a rocket icon." No purple-to-pink
gradients. No emoji in headings.

---

## 2. Color tokens

All colors are **OKLCH** (Tailwind CSS 4 native), defined in
`src/app/globals.css`. Light theme in `:root`, dark theme in `.dark`.

### 2.1 Brand

| Token | Light | Dark | Tailwind utility | Usage |
|---|---|---|---|---|
| `--brand` | `oklch(0.646 0.222 41.116)` (amber-600 ≈ #d97706) | `oklch(0.72 0.19 50)` | `bg-brand`, `text-brand`, `border-brand` | Primary CTAs, brand accents, active nav |
| `--brand-foreground` | `oklch(0.985 0 0)` (white) | `oklch(0.145 0 0)` | `text-brand-foreground` | Text on `bg-brand` |
| `--brand-soft` | `oklch(0.95 0.05 75)` (warm cream) | `oklch(0.3 0.06 50)` | `bg-brand-soft` | Hero backgrounds, subtle highlights |

**Rule:** the brand color is amber. It is NOT indigo or blue (per the
project's hard rule). All previous `bg-amber-600` / `text-amber-700` /
`border-amber-300` usages migrate to `bg-brand` / `text-brand` /
`border-brand`.

### 2.2 Semantic status

| Token | Light | Dark | Tailwind utility | Usage |
|---|---|---|---|---|
| `--success` | `oklch(0.62 0.17 152)` (emerald) | `oklch(0.7 0.17 152)` | `bg-success`, `text-success` | Paid, ready, collected, completed |
| `--success-foreground` | white | dark | `text-success-foreground` | Text on `bg-success` |
| `--success-soft` | `oklch(0.95 0.04 152)` | `oklch(0.3 0.06 152)` | `bg-success-soft` | Success badge backgrounds |
| `--warning` | `oklch(0.72 0.18 70)` (amber-orange) | `oklch(0.78 0.16 70)` | `bg-warning`, `text-warning` | In-progress, printing, pending payment |
| `--warning-foreground` | dark | dark | `text-warning-foreground` | Text on `bg-warning` (dark for contrast) |
| `--warning-soft` | `oklch(0.95 0.05 70)` | `oklch(0.3 0.06 70)` | `bg-warning-soft` | Warning badge backgrounds |
| `--info` | `oklch(0.62 0.14 230)` (sky/cyan) | `oklch(0.7 0.13 230)` | `bg-info`, `text-info` | Paid (calm), informational, links |
| `--info-foreground` | white | dark | `text-info-foreground` | Text on `bg-info` |
| `--info-soft` | `oklch(0.95 0.04 230)` | `oklch(0.3 0.05 230)` | `bg-info-soft` | Info badge backgrounds |
| `--danger` | `oklch(0.58 0.22 25)` (rose-red) | `oklch(0.68 0.2 25)` | `bg-danger`, `text-danger` | Cancelled, failed, disputed, destructive |
| `--danger-foreground` | white | white | `text-danger-foreground` | Text on `bg-danger` |
| `--danger-soft` | `oklch(0.95 0.05 25)` | `oklch(0.3 0.07 25)` | `bg-danger-soft` | Danger badge backgrounds |

**Status badge mapping** (canonical, in `src/components/portal/status-badge.tsx`):

| Order status | Token | Why |
|---|---|---|
| `awaiting_payment` | muted | Neutral, action needed |
| `paid` | info | Settled, calm |
| `printing` | warning | In-progress, attention |
| `ready` | success | Action: collect |
| `collected` | success (soft) | Terminal success |
| `cancelled` | danger | Terminal negative |
| `refunded` | muted | Terminal neutral |

### 2.3 Neutral

The shadcn defaults (`--background`, `--foreground`, `--card`, `--muted`,
`--border`, `--input`, `--ring`, `--primary`, `--secondary`, `--accent`,
`--popover`). All OKLCH grayscale. No changes from the base shadcn
`neutral` baseColor.

### 2.4 What was fixed

- **`--destructive-foreground` was referenced in `tailwind.config.ts` but
  never defined** — a real bug. Now defined as white (light) / white
  (dark) in both `:root` and `.dark`, and bridged via `@theme inline`.
- **`tailwind.config.ts` is a Tailwind v3 leftover** with `hsl(var(--*))`
  wrappers that wrap OKLCH values — broken and dead. Tailwind v4 reads
  tokens from `@theme inline` in `globals.css`. The config file is
  ignored at runtime but should be deleted or rewritten (tracked in
  progress doc).

### 2.5 Migration rule

**No raw Tailwind palette classes in app code.** Replace:

| Old (raw) | New (token) |
|---|---|
| `bg-amber-600` | `bg-brand` |
| `text-amber-700` | `text-brand` |
| `border-amber-300` | `border-brand/30` |
| `bg-amber-100/80` | `bg-brand-soft` |
| `from-amber-50` (gradient) | `bg-brand-soft` (solid) |
| `bg-emerald-100` | `bg-success-soft` |
| `text-emerald-800` | `text-success-foreground` |
| `bg-sky-100` | `bg-info-soft` |
| `text-sky-800` | `text-info-foreground` |
| `bg-rose-100` | `bg-danger-soft` |
| `text-rose-700` | `text-danger-foreground` |
| `bg-zinc-200` | `bg-muted` |
| `text-zinc-700` | `text-muted-foreground` |

---

## 3. Typography

| Role | Font | Class | Size | Weight |
|---|---|---|---|---|
| Body | Geist Sans | `font-sans` (default) | `text-sm` (14px) / `text-base` (16px) | `font-normal` (400) |
| Heading 1 | Geist Sans | `text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight` | 30–48px | 700 |
| Heading 2 | Geist Sans | `text-xl sm:text-2xl font-semibold tracking-tight` | 20–24px | 600 |
| Heading 3 | Geist Sans | `text-base sm:text-lg font-semibold` | 16–18px | 600 |
| Caption | Geist Sans | `text-xs text-muted-foreground` | 12px | 400 |
| Mono (tokens, amounts, codes) | Geist Mono | `font-mono` | varies | 400 |

**Line height:** `leading-tight` for headings, `leading-relaxed` for body.
**No custom fonts.** No Google Fonts CDN imports. Geist is loaded via
`next/font/google` in `src/app/layout.tsx`.

---

## 4. Spacing scale

Use the Tailwind scale. **No off-scale values** (`p-3.5`, `gap-7`).

| Token | px | Usage |
|---|---|---|
| `gap-2` / `p-2` | 8 | Dense toolbars, icon button padding |
| `gap-3` / `p-3` | 12 | Compact cards, list items |
| `gap-4` / `p-4` | 16 | Standard card content, form field gaps |
| `gap-6` / `p-6` | 24 | Standard card padding, section gaps |
| `gap-8` / `p-8` | 32 | Large section padding |
| `py-12` / `py-14` / `py-16` | 48–64 | Hero / section vertical rhythm |

**Section rhythm:** `py-12` mobile, `py-16` desktop for major sections.
`py-8` for minor sections.

---

## 5. Radius

| Token | px | Usage |
|---|---|---|
| `--radius-sm` | 6 | Badges, small chips |
| `--radius-md` | 8 | Inputs, buttons (default) |
| `--radius-lg` | 10 | Cards (default) |
| `--radius-xl` | 14 | Large cards, hero panels |

Base `--radius: 0.625rem` (10px). All derived in `@theme inline`.

---

## 6. Elevation / shadows

- `shadow-sm` — default for cards
- `shadow-md` — hover state on interactive cards
- `shadow-lg` — dialogs, popovers
- **No `shadow-2xl`.** Too heavy for a clean SaaS.

---

## 7. Components

### 7.1 Button

shadcn `Button` with variants: `default` (primary, `bg-brand`), `secondary`,
`outline`, `ghost`, `destructive`, `link`. Sizes: `sm`, `default`, `lg`,
`icon`.

**Touch target rule:** minimum `h-11` (44px) for primary actions on
mobile. Use `size="lg"` for hero CTAs. Icon buttons must be `h-11 w-11`
on mobile, `h-9 w-9` acceptable on desktop with `>= 24px` spacing.

### 7.2 Card

```
<Card className="p-6">          // standard
  <CardHeader>...</CardHeader>
  <CardContent>...</CardContent>
  <CardFooter>...</CardFooter>
</Card>
```

- **Padding:** `p-4` (compact), `p-6` (standard), `p-8` (hero).
- **Border:** `border border-border`.
- **Shadow:** `shadow-sm` default, `shadow-md` on hover for interactive.
- **Hover:** `hover:border-brand/40 hover:shadow-md transition-all`
  for clickable cards.

### 7.3 Badge

shadcn `Badge` with variants. For status badges, always use the shared
`@/components/portal/status-badge` or `@/components/portal/payment-badge`
— never inline a copy.

### 7.4 StatusBadge (shared)

`src/components/portal/status-badge.tsx` — the canonical order-status
badge. Uses semantic tokens. **4 admin pages currently inline their own
copy** (audit §3.2) — migrate them to import this.

### 7.5 PaymentBadge (shared, new)

`src/components/portal/payment-badge.tsx` — the canonical payment-status
badge. Consolidates the 2 inline copies. Uses semantic tokens.

### 7.6 Form

`react-hook-form` + `zod` via the shadcn `Form` wrappers. Every input has
a `<FormLabel>` and a `<FormMessage>`. Help text uses
`aria-describedby`.

### 7.7 Table

Always:
```tsx
<div className="overflow-x-auto">
  <Table>...</Table>
</div>
```
For mobile, consider a card-based layout instead of a table for < 768px.

### 7.8 Dialog

shadcn `Dialog` (or `AlertDialog` for destructive confirms). Always set
`aria-describedby`. Max width: `max-w-[95vw] sm:max-w-lg`. Radix handles
focus trap + Esc.

### 7.9 Toast

Sonner (`<Toaster />` in `src/app/layout.tsx`). `toast.success()`,
`toast.error()`, `toast.loading()`. Don't use the legacy Radix toast
(`components/ui/toast.tsx` + `toaster.tsx` — dead code, tracked for
removal).

---

## 8. Layout patterns

### 8.1 Sticky footer (MANDATORY)

```tsx
<body className="min-h-screen flex flex-col bg-background text-foreground">
  <AuthProvider>
    <Toaster />
    <PWARegister />
    {children}
  </AuthProvider>
  <footer className="mt-auto border-t border-border bg-card">...</footer>
</body>
```

- Short page → footer sticks to viewport bottom.
- Long page → footer pushed down naturally.
- Never overlay, never float, never `position: fixed`.

### 8.2 Page shell

```tsx
<div className="flex min-h-screen flex-col bg-background">
  <header>...</header>           // optional, page-specific
  <main className="flex-1">
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <h1>...</h1>
      ...
    </section>
  </main>
  <footer className="mt-auto">...</footer>
</div>
```

### 8.3 Container widths

| Container | max-width | Usage |
|---|---|---|
| `max-w-6xl` | 1152px | Standard page content |
| `max-w-4xl` | 896px | Forms, article-like content |
| `max-w-2xl` | 672px | Narrow forms, login |
| `max-w-7xl` | 1280px | Wide dashboards, tables |

### 8.4 Grid

- **Card grids:** `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`
- **Stat grids:** `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4`
- **Never** use fixed `grid-cols-4` that doesn't collapse on mobile.

---

## 9. Interaction states

| State | Style |
|---|---|
| Default | token colors as specified |
| Hover | `hover:bg-muted`, `hover:border-brand/40`, `hover:text-foreground` |
| Focus-visible | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| Active | `active:scale-[0.98]` for buttons (subtle) |
| Disabled | `disabled:opacity-50 disabled:pointer-events-none` |
| Loading | `Loader2` spinner + `disabled` |
| Selected | `aria-selected="true" data-[selected]:bg-brand/10` |

**Transitions:** `transition-colors` for color changes,
`transition-all` for transform + color. Duration: default (150ms).
**Reduced motion:** `globals.css` zeroes all transitions for
`prefers-reduced-motion: reduce`.

---

## 10. Responsive breakpoints

| Breakpoint | min-width | Target |
|---|---|---|
| (default) | 0 | Mobile portrait (320–639px) |
| `sm:` | 640px | Mobile landscape / small tablet |
| `md:` | 768px | Tablet |
| `lg:` | 1024px | Small desktop |
| `xl:` | 1280px | Standard desktop |
| `2xl:` | 1536px | Large desktop |

**Test at:** 320, 375, 430, 768, 1024, 1280, 1440, 1920.
**Primary customer viewport:** 375px (iPhone SE / typical Android).

---

## 11. Accessibility checklist

- [ ] One `<h1>` per page, flat hierarchy (h1 → h2 → h3)
- [ ] Every interactive element has an accessible name (`aria-label`
      for icon-only buttons)
- [ ] Visible focus ring on every focusable element
- [ ] Touch targets ≥ 44px (or ≥ 24px with spacing)
- [ ] Color contrast ≥ 4.5:1 for normal text, ≥ 3:1 for large text
- [ ] Decorative icons have `aria-hidden="true"`
- [ ] Form inputs have `<label>` or `aria-label` + `aria-describedby`
      for errors
- [ ] Dialogs trap focus + restore on close (Radix handles)
- [ ] Tables have `<caption>` or wrapper `aria-label`
- [ ] `prefers-reduced-motion` respected (globals.css handles)
- [ ] Skip link at top of each layout (`sr-only focus:not-sr-only`)
- [ ] No horizontal overflow at 375px

---

## 12. Iconography

`lucide-react` exclusively. Named imports only:
`import { Search, UploadCloud, ShieldCheck } from 'lucide-react'`.

**Sizes:** `size-4` (16px) inline text, `size-5` (20px) buttons/cards,
`size-8` (32px) feature icons, `size-12` (48px) hero icons.

**Decorative icons:** `<Icon aria-hidden className="size-4" />`.
**Interactive icons:** `<Button aria-label="Search"><Search
className="size-4" aria-hidden /></Button>`.

---

## 13. Money

- **All amounts in integer paise** (1 INR = 100 paise). No floats.
- **Display:** `formatINRFromPaise(paise)` from `@platform/utils` (or
  the re-export at `@/lib/utils`).
- **Alignment:** right-align monetary values in tables
  (`text-right tabular-nums`).
- **Currency symbol:** ₹ (Indian Rupee).
- **Minimum order:** always show with `formatINRFromPaise`.

---

## 14. Loading + empty + error states

### 14.1 Loading

- **List initial load:** `Skeleton` placeholders matching the final
  layout shape.
- **Action in progress:** `Loader2` spinner inside the button +
  `disabled`.
- **Page transition:** none (Next.js handles).

### 14.2 Empty

A card with:
- An icon (`size-8 text-muted-foreground`)
- A one-line headline ("No orders yet")
- A one-line explanation ("Orders will appear here once a customer
  places one.")
- A primary action ("Set up your shop QR" → link)

### 14.3 Error

An `Alert` with `variant="destructive"`:
- `AlertTitle` with the error headline
- `AlertDescription` with the detail
- A retry button if the operation is retryable

Never a blank page. Never a raw `<p>Error</p>`.

---

## 15. What NOT to do

- ❌ Raw Tailwind palette classes (`bg-amber-600`, `text-emerald-100`)
- ❌ Gradients (no `bg-gradient-to-*`)
- ❌ Indigo or blue (hard project rule)
- ❌ Inline `StatusBadge` / `PaymentBadge` / `truncate` / `formatDateTime`
- ❌ `'use client'` on a file that could be a Server Component
- ❌ Tables without `overflow-x-auto` wrappers
- ❌ Touch targets < 44px on mobile
- ❌ Heading hierarchy jumps (h1 → h3)
- ❌ Multiple `<h1>` per page
- ❌ Decorative icons without `aria-hidden`
- ❌ Mock data in production paths
- ❌ Hardcoded dashboard statistics
- ❌ Simulated successful payments

---

## 16. File map

| File | Purpose |
|---|---|
| `src/app/globals.css` | All tokens (:root + .dark + @theme inline bridge) |
| `src/app/layout.tsx` | Root layout: fonts, providers, sticky footer body class |
| `src/lib/utils.ts` | `cn`, `truncate`, `formatDateTime`, `formatDate`, `timeAgo`, `formatBytes`, `isToday`, `initials`, re-export of `formatINRFromPaise` |
| `src/components/portal/status-badge.tsx` | Canonical order-status badge (uses semantic tokens) |
| `src/components/portal/payment-badge.tsx` | Canonical payment-status badge (new, consolidates 2 inline copies) |
| `src/components/ui/*` | 49 shadcn primitives (new-york style, neutral baseColor) |
| `tailwind.config.ts` | ⚠️ Tailwind v3 leftover — dead code, tracked for removal |

---

## 17. Migration status

Tracked in `docs/REDESIGN_PROGRESS.md`. Summary:

- ✅ Tokens defined in `globals.css` (brand, success, warning, info,
  danger, destructive-foreground)
- ✅ `StatusBadge` migrated to semantic tokens
- ✅ `PaymentBadge` created (consolidates 2 inline copies)
- ✅ `lib/utils.ts` extended with `truncate`, `formatDateTime`,
  `formatDate`, `timeAgo`, `formatBytes`, `isToday`, `initials`
- ✅ Customer homepage `/` redesigned with tokens
- ⏳ Shop landing `/shops/[slug]` — pending
- ⏳ Customer order flow `/orders/[id]` — pending (1,568 lines, needs split)
- ⏳ Shopkeeper dashboard `/shop/*` — pending
- ⏳ Admin `/admin/*` — pending (dedupe StatusBadge, add h1s, fix touch targets)
- ⏳ `tailwind.config.ts` removal — pending (low risk, but verify build)
- ⏳ `next-themes` provider — pending (dark tokens exist but unreachable)
