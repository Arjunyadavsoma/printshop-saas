# PrintShop SaaS — Consumer Design System

> The visual and interaction system for **consumer-facing** surfaces
> only (home, shop discovery, shop detail, order flow, order tracking).
> Shopkeeper and admin portals have their own conventions documented
> elsewhere.
>
> This doc is the operational reference: tokens, typography, spacing,
> components, and the rules that keep the customer journey consistent.
> It complements (not replaces) `docs/DESIGN_SYSTEM.md`, which covers
> the whole product. Where the two disagree on a consumer-specific
> point, this doc wins for consumer pages.
>
> **Source of truth for tokens:** `src/app/globals.css` (`@theme inline`
> + `:root` + `.dark`). **Component primitives:** `src/components/ui/*`
> (shadcn, New York style). **Icons:** `lucide-react`.

---

## 1. Typography hierarchy

Geist Sans for everything; Geist Mono for tokens, amounts, and code.
Loaded via `next/font/google` in `src/app/layout.tsx`. No CDN font
imports. No custom font files.

| Role | Class | Size | Weight | Line height | Used in |
|---|---|---|---|---|---|
| Page H1 | `text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight` | 30–48px | 700 | `leading-tight` | Home hero (`page.tsx:174`) |
| Page H2 | `text-xl sm:text-2xl font-bold tracking-tight` | 20–24px | 700 | `leading-tight` | Section headings (`page.tsx:214,249`) |
| Card title | `text-lg sm:text-xl font-semibold` | 18–20px | 600 | `leading-tight` | `CardTitle` in shop detail, order flow |
| Card title (compact) | `text-base font-semibold` | 16px | 600 | `leading-tight` | `FileCard`, `ConfigureStep` file cards |
| Body | `text-sm text-foreground` | 14px | 400 | `leading-relaxed` | Paragraphs, descriptions |
| Body (large) | `text-base sm:text-lg text-muted-foreground leading-relaxed` | 16–18px | 400 | `leading-relaxed` | Hero subtitle (`page.tsx:177`) |
| Caption / metadata | `text-xs text-muted-foreground` | 12px | 400 | `leading-snug` | Helper text, "How it works" body |
| Tiny label | `text-[11px] uppercase tracking-wide text-muted-foreground` | 11px | 400 | `leading-snug` | Stat-card labels, file metadata |
| Micro | `text-[10px]` | 10px | 400 | `leading-none` | Stepper labels on mobile, page numbers in PDF preview |
| Currency (large) | `text-2xl font-bold text-foreground tabular-nums` | 24px | 700 | — | Estimated total (`orders/[id]/page.tsx:881`) |
| Currency (hero) | `text-3xl sm:text-4xl lg:text-5xl font-bold` | 30–48px | 700 | — | Pay-step amount (`orders/[id]/page.tsx:1152`) |
| Token (display) | `font-mono text-2xl sm:text-3xl sm:tracking-widest font-bold text-brand` | 24–30px | 700 | — | Track-step token (`orders/[id]/page.tsx:1277`) |
| Mono (small) | `font-mono text-[11px]` or `font-mono text-xs` | 11–12px | 400 | — | Order ID slice, UPI ID |

**Rules.**
- `tabular-nums` on every currency amount so columns align
  (already applied at `page.tsx:424,431`).
- `tracking-tight` on every heading ≥ `text-xl`.
- `leading-relaxed` for body paragraphs; `leading-tight` for headings;
  `leading-snug` for tight captions.
- 11px (`text-[11px]`) is the floor — never go smaller. 10px
  (`text-[10px]`) is reserved for non-essential micro-labels (stepper
  on mobile, PDF page numbers) and should be migrated to `text-xs`
  where possible.

---

## 2. Page widths and content density

| Container | max-width | Where used |
|---|---|---|
| `max-w-6xl` (1152px) | Wide | Home hero, shop discovery, "How it works" |
| `max-w-5xl` (896px) | Standard | Shop detail page |
| `max-w-4xl` (768px) | Narrow | Order flow (5-step wizard) |
| `max-w-2xl` (672px) | Form | (Not used in consumer flow currently) |

**Density rules.**
- Hero / marketing sections: `py-10 sm:py-14 lg:py-20` — generous
  vertical rhythm (`page.tsx:167`).
- Standard content sections: `py-10 sm:py-14` (`page.tsx:212,247`).
- Wizard / form sections: `py-6 sm:py-10` — tighter, less scroll
  (`orders/[id]/page.tsx:645`).
- Card padding: `p-4` (compact / file cards), `p-5` (shop cards on
  home), `p-6` (standard / shop-detail cards, sticky summary).

---

## 3. Spacing — Tailwind scale only

| Token | px | Usage in consumer flow |
|---|---|---|
| `gap-1` / `gap-1.5` | 4 / 6 | Tight icon-text gaps, badge internals |
| `gap-2` / `p-2` | 8 | Dense toolbars, PDF preview pagination dots |
| `gap-3` / `p-3` | 12 | Compact cards, file card content, stat tiles |
| `gap-4` / `p-4` | 16 | Standard card content, file cards, section gaps |
| `gap-6` / `p-6` | 24 | Standard card padding, sticky summary |
| `py-10` / `py-14` / `py-16` | 40 / 56 / 64 | Section vertical rhythm |

**Rules.**
- No off-scale values (`p-3.5`, `gap-7`, `mt-9`). The audit found none
  in the consumer flow — keep it that way.
- `gap-3` between file cards in a list (`orders/[id]/page.tsx:870`).
- `gap-4` between major cards in a section.
- `space-y-4` and `space-y-6` are used interchangeably with `gap-*` —
  pick `gap-*` + flex/grid layout where possible; reserve `space-y-*`
  for plain stacked divs.

---

## 4. Border radii

Defined in `globals.css` lines 57–60. Base `--radius: 0.625rem` (10px).

| Token | px | Class | Usage |
|---|---|---|---|
| `--radius-sm` | 6 | `rounded-sm` | Badges, chips |
| `--radius-md` | 8 | `rounded-md` | Inputs, buttons, small controls |
| `--radius-lg` | 10 | `rounded-lg` | Cards (default), stat tiles, alert boxes |
| `--radius-xl` | 14 | `rounded-xl` | Dropzones, large panels (`orders/[id]/page.tsx:828`) |

**Rules.**
- Cards: `rounded-lg` (the shadcn `Card` default).
- Inputs, buttons: inherit shadcn defaults (`rounded-md`).
- Dropzones, payment-option panels: `rounded-xl`.
- Badges: `rounded-sm` or full pill — both are used; prefer the shadcn
  default for `Badge` (`rounded-md`).

---

## 5. Surface and border colors

| Role | Token | Light OKLCH | Usage |
|---|---|---|---|
| Page background | `bg-background` | `oklch(1 0 0)` (white) | Root wrapper `<div className="bg-background">` |
| Foreground text | `text-foreground` | `oklch(0.145 0 0)` (near-black) | All body + heading text |
| Card surface | `bg-card` | `oklch(1 0 0)` (white) | `<Card>`, header bar, footer |
| Card foreground | `text-card-foreground` | `oklch(0.145 0 0)` | Default text inside cards |
| Muted surface | `bg-muted` | `oklch(0.97 0 0)` | Stat tiles, file size badges, table headers |
| Muted foreground | `text-muted-foreground` | `oklch(0.556 0 0)` | Captions, helper text, "Saved" labels |
| Border | `border-border` | `oklch(0.922 0 0)` | All card borders, dividers, table rows |
| Input border | `border-input` | `oklch(0.922 0 0)` | Form inputs |
| Destructive | `bg-destructive`, `text-destructive` | `oklch(0.577 0.245 27.325)` | Fatal-error cards, "Remove file" hover |

**Rules.**
- Every page root: `<div className="flex min-h-screen flex-col bg-background">`.
- Header / footer bars: `bg-card border-b border-border` (top) /
  `border-t border-border` (bottom).
- Soft stat tiles inside cards: `rounded-lg bg-muted/60 p-2.5` (home
  shop card) or `bg-muted/60 p-3` (shop detail).
- Soft alert boxes (info, success, warning, danger): `bg-{token}-soft`
  with `text-{token}` text and `border-{token}/30` border.

---

## 6. Brand + status colors (the PrintShop semantic palette)

Defined in `globals.css` lines 41–56 (`@theme inline` bridge) and
lines 97–112 (`:root` light) / 148–163 (`.dark`).

| Token | Light | Tailwind utility | Used for |
|---|---|---|---|
| `brand` | `oklch(0.646 0.222 41.116)` (amber-600 ≈ #d97706) | `bg-brand`, `text-brand`, `border-brand` | Primary CTAs, hero accents, "Visit shop" arrows |
| `brand-foreground` | white | `text-brand-foreground` | Text/icon on `bg-brand` |
| `brand-soft` | `oklch(0.95 0.05 75)` (warm cream) | `bg-brand-soft` | Hero panel, payment-amount box, "needs review" file card border |
| `success` | `oklch(0.62 0.17 152)` (emerald) | `bg-success`, `text-success` | Paid, ready, collected, completed, "Start order" |
| `success-foreground` | white | `text-success-foreground` | Text on `bg-success` |
| `success-soft` | `oklch(0.95 0.04 152)` | `bg-success-soft` | Success alert backgrounds, UPI-app payment card |
| `warning` | `oklch(0.72 0.18 70)` (amber-orange) | `bg-warning`, `text-warning` | In-progress, printing |
| `warning-soft` | `oklch(0.95 0.05 70)` | `bg-warning-soft` | Warning alert backgrounds |
| `info` | `oklch(0.62 0.14 230)` (sky) | `bg-info`, `text-info` | Informational, paid (calm) |
| `info-soft` | `oklch(0.95 0.04 230)` | `bg-info-soft` | Info alert backgrounds |
| `danger` | `oklch(0.58 0.22 25)` (rose-red) | `bg-danger`, `text-danger` | Cancelled, failed, fatal errors |
| `danger-soft` | `oklch(0.95 0.05 25)` | `bg-danger-soft` | Danger alert backgrounds |

**Hard rule (from project instructions + `docs/DESIGN_SYSTEM.md` §2.5):**
no indigo or blue. The brand is amber. The `info` token is sky-cyan,
not blue — acceptable because it carries semantic load (calm/verified),
not decorative.

**Known token-bypass violations** (see audit P0-05):
`src/components/portal/pdf-preview.tsx` uses raw `green-500`, `green-600`,
`amber-500`, `amber-700`, `red-500`, and a `bg-gradient-to-t from-black/70`
gradient. These must be migrated to `success`, `warning`, `danger`, and
a solid `bg-foreground/70` respectively.

---

## 7. Primary and secondary actions — button variants

shadcn `Button` variants: `default`, `secondary`, `outline`, `ghost`,
`destructive`, `link`. Sizes: `sm`, `default`, `lg`, `icon`.

| Action priority | Variant | Class additions | Example |
|---|---|---|---|
| Primary CTA (hero) | `default` + `size="lg"` | `bg-brand text-brand-foreground hover:bg-brand/90 min-h-[44px]` | "Find a shop" (`page.tsx:181`) |
| Primary CTA (step) | `default` + `size="sm"` | `min-h-[44px]` | "Configure files" (`orders/[id]/page.tsx:894`) |
| Secondary CTA | `outline` + `size="sm"` | `min-h-[44px]` | "Skip to checkout", "Back" |
| Tertiary / nav | `ghost` + `size="sm"` | `min-h-[44px]` | "Clear" search (`page.tsx:271`) |
| Icon-only | (custom) | `min-h-[44px] min-w-[44px] rounded-md` | Remove-file trash (`orders/[id]/page.tsx:1451`) |
| Destructive | `destructive` + `size="sm"` | — | (Not currently used in consumer flow — the trash button uses `text-destructive` on hover instead) |

**Rules.**
- Every primary CTA on mobile: `w-full sm:w-auto` + `min-h-[44px]`.
- Loading state: replace leading icon with `<Loader2 className="animate-spin" />`
  + append `…` to the label (e.g., "Starting…" `shops/[slug]/page.tsx:338`).
- Disabled: `disabled={busy || invalidCondition}`. The shadcn default
  applies `disabled:opacity-50 disabled:pointer-events-none`.
- Icon + label buttons: icon first, then label, separated by a space
  (the JSX uses `<Icon /> Label` with whitespace).
- Label-only buttons: no icon.

---

## 8. Focus states

Every interactive element must show a visible focus ring on
keyboard navigation (WCAG 2.2 SC 2.4.11 Focus Appearance, Level AA —
draft, but the principle holds under 2.4.7 Focus Visible).

| Element | Focus class |
|---|---|
| `Button` (shadcn) | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` (built into the component) |
| Shop card (custom `role="button"` div) | `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` (`page.tsx:401`) |
| Input / Select / Textarea (shadcn) | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` (built in) |
| ToggleGroup items | inherited from Radix |
| Native `<select>` in `ConfigureStep` | none — **missing** (audit P1-12) |
| PDF preview thumbnail `<div onClick>` | none — **missing** (audit P0-04) |

**Rule.** If you build a custom interactive element (not a shadcn
primitive), you must add `focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-ring focus-visible:ring-offset-2` and ensure the
element is in the tab order (`tabIndex={0}` for non-natively-focusable
elements, or convert to `<button>`).

---

## 9. Form fields

| Field type | Component | Notes |
|---|---|---|
| Text input | shadcn `Input` | Always paired with shadcn `Label` above. Label class: `text-xs` (compact) or `text-sm` (standard). |
| Number input | shadcn `Input type="number"` | With `min`/`max` attributes. Clamp in `onChange`. |
| Select | shadcn `Select` | **Inconsistency:** `ConfigureStep` uses a native `<select>` (`orders/[id]/page.tsx:966`) — migrate. |
| Toggle (binary enum) | shadcn `ToggleGroup type="single"` | Used for colour, paper, sides. Provides arrow-key navigation + `role="radiogroup"`. |
| Boolean switch | shadcn `Switch` | Used for duplex in `FileCard`. |
| File picker | native `<input type="file">` hidden + `<Button>` trigger | Never expose the native input directly. |

**Pattern.**
```tsx
<div>
  <Label htmlFor="copies" className="text-xs">Copies</Label>
  <Input id="copies" type="number" min={1} max={500} ... className="mt-1 h-11 sm:h-9" />
</div>
```

**Rules.**
- Every input has a `<Label>`.
- Mobile input height `h-11` (44px); desktop `sm:h-9` (36px). This
  trades desktop density for mobile tap-target compliance.
- Helper text below the input: `<p className="text-[11px]
  text-muted-foreground">`.
- Error text below the input: `<p className="text-xs text-destructive">`.

---

## 10. Cards

```tsx
<Card className="border-border shadow-sm">             // default
  <CardHeader>
    <CardTitle className="flex items-center gap-2 text-lg">
      <Icon className="h-5 w-5 text-brand" /> Title
    </CardTitle>
    <CardDescription>Subtitle</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">...</CardContent>
  <CardFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
    <Button variant="outline">Back</Button>
    <Button>Next</Button>
  </CardFooter>
</Card>
```

**Variants in the consumer flow.**
- **Standard card:** `border border-border shadow-sm rounded-lg`.
- **Interactive card (shop card):** adds `cursor-pointer transition-all
  hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md
  focus-visible:ring-2` (`page.tsx:398–401`).
- **Brand-accent card:** `border-brand/30` (start-order card
  `shops/[slug]/page.tsx:315`, pay-step card `orders/[id]/page.tsx:1141`).
- **Status card:** `bg-{token}-soft ring-1 ring-{token}/30`
  (track-step payment + order status cards, lines 1291, 1326).
- **Dashed card (empty state):** `border-dashed border-border`
  (`orders/[id]/page.tsx:862`, `page.tsx:316`).
- **Destructive card (fatal error):** `border-destructive/40
  bg-destructive/5` (`orders/[id]/page.tsx:653`).

---

## 11. Dialogs and drawers

shadcn `Dialog` and `AlertDialog` are available in
`src/components/ui/`. The consumer flow **does not currently use any
dialogs** — every interaction is inline. The remove-file action is
immediate (no confirm dialog). The "I've paid" action is immediate
(no confirm dialog).

**Rule for new dialogs.**
- Max width: `max-w-[95vw] sm:max-w-lg`.
- Always `aria-describedby` pointing at a description element.
- Destructive confirms: use `AlertDialog`, not `Dialog`.
- Radix handles focus trap + Esc-to-close — do not reimplement.
- Drawer (`src/components/ui/drawer.tsx`) for mobile-only bottom-sheet
  interactions; use sparingly — the consumer flow is already mobile-first
  inline.

---

## 12. Status indicators — badges

shadcn `Badge` variants: `default`, `secondary`, `destructive`, `outline`.

**Subscription tier badges** (`page.tsx:44–49`):
| Tier | Class |
|---|---|
| free | `bg-muted text-muted-foreground border-border` |
| starter | `bg-brand-soft text-brand border-brand/30` |
| pro | `bg-success-soft text-success border-success/30` |
| enterprise | `bg-info-soft text-info border-info/30` |

**File status badges** (`orders/[id]/page.tsx:1404–1415`):
| Status | Variant |
|---|---|
| pending | secondary |
| queued | secondary |
| printing | default |
| completed | default |
| failed | destructive |
| needs_review | outline |

**Order status colours** (canonical, from `docs/DESIGN_SYSTEM.md` §2.2):
| Status | Token |
|---|---|
| awaiting_payment | muted |
| paid | info |
| printing | warning |
| ready | success |
| collected | success (soft) |
| cancelled | danger |
| refunded | muted |

**Rule.** Never inline a status colour. Use the canonical badge from
`src/components/portal/status-badge.tsx` or `payment-badge.tsx` — the
consumer flow should import these rather than redefining the mapping
(though the order page currently inlines `FileStatusBadge` at line
1404 — acceptable because file status is distinct from order status).

---

## 13. Notifications (toast / sonner)

Sonner is mounted in `src/app/layout.tsx` via `<Toaster />` from
`src/components/ui/sonner.tsx`. The shopkeeper portal uses it heavily.
**The consumer flow does not currently call `toast.*` at all.** All
feedback is inline (alert boxes, status badges, button states).

**Rule for new toasts on consumer pages.**
- Use sparingly — inline feedback is preferred for the wizard flow.
- Reserve toasts for: "Receipt downloaded", "Order link copied",
  "Settings saved" (when the customer is mid-edit on a different card
  and the saved card is off-screen).
- `toast.success(...)`, `toast.error(...)`, `toast.loading(...)`.
- Keep copy under 60 characters; the toast is non-blocking.
- The legacy Radix toast (`src/components/ui/toast.tsx` +
  `toaster.tsx`) is dead code per `docs/DESIGN_SYSTEM.md` §7.9 — do not
  use.

---

## 14. Loading states

| Pattern | Component | Usage |
|---|---|---|
| Skeleton block | shadcn `Skeleton` (`<Skeleton className="h-N w-X" />`) | Initial page load, shop list, shop detail, order status |
| Inline spinner | `<Loader2 className="h-4 w-4 animate-spin" />` | Button loading, patching indicator on file cards (`orders/[id]/page.tsx:1450`) |
| Large spinner | `<Loader2 className="size-8 animate-spin text-brand" />` | PDF preview rendering (`pdf-preview.tsx:238`), track-step order status (line 1327) |
| Progress bar | shadcn `Progress` (`<Progress value={N} className="h-2" />`) | Upload progress per file (`orders/[id]/page.tsx:1465`) |
| Stepper | Custom `OrderStepper` (5 numbered circles + labels) | Order flow header (`orders/[id]/page.tsx:774–792`) |

**Rules.**
- Initial page load: skeleton blocks shaped like the real content
  (shop-card skeletons render 6 cards with the right internal layout —
  `page.tsx:284–298`).
- Button loading: replace leading icon with spinner, append `…` to
  label, set `disabled`.
- Skeleton shimmer: built into the shadcn `Skeleton` component
  (`animate-pulse bg-muted`).
- No full-screen spinners. The page shell + header + footer always
  render; only the main content area shows the skeleton.

---

## 15. Responsive breakpoints

Tailwind defaults: `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px.
The consumer flow uses `sm:` and `lg:` heavily, `md:` rarely, `xl:`
never.

| Breakpoint | What changes |
|---|---|
| `< sm` (mobile, < 640px) | Single-column grids, full-width buttons, `h-11` inputs, stepper labels `text-[10px]` |
| `sm` (≥ 640px) | 2-column grids, `sm:w-auto` buttons, `sm:h-9` inputs, stepper labels `text-xs` |
| `lg` (≥ 1024px) | 3-column shop grid, shop detail 2-column `[1.4fr_1fr]` layout, sticky start-order card (`lg:sticky lg:top-6`) |
| `xl` (≥ 1280px) | (Not used) |

**Rules.**
- Mobile-first: write the base class for mobile, then `sm:` / `lg:`
  overrides.
- Every grid collapses to 1 column on mobile. Never use a fixed
  `grid-cols-N` without responsive variants.
- Test at 360px (small Android), 390px (iPhone 14), 768px (iPad
  portrait), 1280px (laptop).

---

## 16. Icon conventions

Library: `lucide-react`. All icons imported as named exports.

**Sizing.**
| Class | px | Usage |
|---|---|---|
| `size-3` / `h-3 w-3` | 12 | Inside badges, micro-labels |
| `size-3.5` / `h-3.5 w-3.5` | 14 | Footer nav icons |
| `size-4` / `h-4 w-4` | 16 | Button icons, inline with text, table row icons |
| `size-5` / `h-5 w-5` | 20 | Card title icons, large inline icons |
| `size-8` / `h-8 w-8` | 32 | Empty-state icons, large status icons |
| `size-9` / `h-9 w-9` | 36 | Step-number circles |

Prefer the `size-N` shorthand (Tailwind v4) over `h-N w-N`. Both work;
`size-N` is more compact.

**Stroke width.** Default (1.5px in current Lucide). Do not override
`strokeWidth` unless you have a specific reason.

**Rules.**
- Decorative icon (next to a text label): always `aria-hidden="true"`.
  Example: `<UploadCloud className="size-4" aria-hidden="true" /> Browse
  files`.
- Icon-only button: always `aria-label`. Example:
  `<button aria-label="Remove file"><Trash2 .../></button>`.
- Never rely on the icon alone to convey meaning. There must be either
  a visible text label or an `aria-label`.
- Status icons (`CheckCircle2`, `AlertCircle`, `XCircle`, `Clock`,
  `Loader2`) appear next to a text label that carries the same
  semantics — the icon is reinforcement, not the sole channel.

**Common icons in the consumer flow.**
- `QrCode` — QR-powered branding, pay-step QR option.
- `UploadCloud` — upload dropzone, upload step title.
- `FileText` — file card icon, file row in tables.
- `Trash2` — remove file.
- `ArrowRight` / `ArrowLeft` — forward / back navigation.
- `CreditCard` — checkout step.
- `Smartphone` — UPI-app payment option, mobile trust indicator.
- `ShieldCheck` — privacy notice, 0% commission.
- `Loader2` (always `animate-spin`) — loading.
- `AlertCircle` — errors.
- `CheckCircle2` — success, stepper "done".
- `XCircle` — cancelled / destructive terminal.
- `RefreshCw` — manual refresh.
- `Download` — receipt download.
- `Home` — back-to-home.
- `MapPin`, `Store`, `Printer`, `Search` — discovery.

---

## 17. Aesthetic and restraint rules

1. **No decorative gradients.** The hero panel is a solid
   `bg-brand-soft`. No `bg-gradient-to-r from-amber-400 to-orange-500`.
   The one gradient in the codebase (`pdf-preview.tsx:328`,
   `bg-gradient-to-t from-black/70`) is a functional overlay on a PDF
   page-number label — flagged for migration to a solid
   `bg-foreground/70`.
2. **No emoji as icons.** Use Lucide. The codebase has zero emoji
   icons in the consumer flow — keep it that way.
3. **No "rocket / sparkles / zap" feature-card icons.** Feature cards
   on the home page use `UploadCloud`, `ShieldCheck`, `Smartphone` —
   functional, not aspirational.
4. **No purple-to-pink hero gradients.** Brand is amber. Accent
   semantic colours only.
5. **Consistent alignment.** All cards in a grid use the same padding,
   the same header layout (`CardTitle` + `CardDescription`), and the
   same content density. The shop cards on the home page and the file
   cards in the order flow follow the same shape.
6. **Card hover lift is subtle.** `-translate-y-0.5` (2px) +
   `shadow-md`. No `-translate-y-2` or scale transforms.
7. **Animations are 150ms or instant.** `transition-colors` for color
   changes, `transition-all` for transform + color. The
   `prefers-reduced-motion: reduce` media query in `globals.css`
   (lines 175–182) zeroes all animation/transition durations —
   preserve this.
8. **Shadows:** `shadow-sm` (default), `shadow-md` (hover), `shadow-lg`
   (dialogs). Never `shadow-2xl`.
9. **Borders are 1px** (`border` = 1px in Tailwind). Use `border-2` only
   for dropzones and selected-state emphasis.
10. **Tabular numbers** (`tabular-nums`) on every currency amount, file
    size, and counter — so columns align.

---

## 18. Component checklist for new consumer pages

Before merging a new consumer-facing component, verify:

- [ ] Uses shadcn primitives from `src/components/ui/` — no rebuilt
  equivalents.
- [ ] Every interactive element has a visible focus ring.
- [ ] Every interactive element meets 44×44px tap target on mobile.
- [ ] Every icon is either `aria-hidden="true"` (decorative) or paired
  with an `aria-label` (icon-only button).
- [ ] Every form input has a `<Label>`.
- [ ] Uses semantic tokens (`bg-brand`, `text-success`, etc.) — no raw
  `bg-green-500`, `text-amber-700`, `bg-blue-100`.
- [ ] Uses Tailwind scale only for spacing — no `p-3.5`, `gap-7`.
- [ ] Mobile-first responsive classes (`base → sm: → lg:`).
- [ ] Loading state (skeleton or spinner), error state (inline alert),
  empty state (dashed card with icon + heading + body).
- [ ] Sticky footer pattern (`min-h-screen flex flex-col` root +
  `mt-auto` footer).
- [ ] No decorative gradients, no emoji icons, no `shadow-2xl`.
- [ ] Currency amounts use `formatINRFromPaise` from `@platform/utils`
  and `tabular-nums`.
- [ ] Reduced-motion users see no animation (verified by toggling
  `prefers-reduced-motion` in devtools).
