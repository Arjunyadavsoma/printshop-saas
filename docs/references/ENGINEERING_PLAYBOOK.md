# PrintShop SaaS — Engineering Playbook

> Consolidated best-practice reference for frontend design, React 19,
> Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui, accessibility,
> responsive design, performance, and security. This document captures
> the same guidance that the external Claude Code-format skills
> (`frontend-design`, `UI UX Pro Max`, `web-design-guidelines`, React
> Best Practices, Composition Patterns, `obra/superpowers`) would have
> provided — adapted to the PrintShop stack and verified against the
> actual codebase.

**Read this before implementing any redesign.** Pair it with
`docs/DESIGN_SYSTEM.md` (the token + component spec) and
`docs/REDESIGN_AUDIT.md` (the file:line findings).

---

## §1. Frontend Design & Web Design Guidelines

### 1.1 Visual hierarchy

- **One H1 per page.** Every page must have exactly one `<h1>`. The
  customer app currently violates this — `src/app/admin/page.tsx` and
  several admin pages have no `<h1>` at all (see audit §5).
- **Flat heading hierarchy.** h1 → h2 → h3. Never h1 → h3. Never skip a
  level.
- **Strong page headings.** Page title = `<h1 className="text-2xl
  font-semibold tracking-tight sm:text-3xl">`. Section title = `<h2
  className="text-lg font-semibold">`. Card title = `<CardTitle>`.
- **Section grouping.** Group related content in `<section
  className="space-y-4">` with a heading + content. Don't pile cards
  into an unstructured flex row.
- **Consistent spacing scale.** `gap-2` (8px), `gap-4` (16px), `gap-6`
  (24px), `gap-8` (32px). No `gap-3`, `gap-5`, `gap-7`. Card padding:
  `p-4` for compact, `p-6` for standard. Section spacing: `py-8` mobile,
  `py-12` desktop.
- **Controlled contrast.** Body text uses `text-foreground`. Muted text
  uses `text-muted-foreground`. Never `text-zinc-500` or `text-gray-600`
  directly — use the token.

### 1.2 Design tokens (the PrintShop system)

The full spec is in `docs/DESIGN_SYSTEM.md`. Summary:

- **Color system:** OKLCH (Tailwind v4 native) in `src/app/globals.css`.
- **Brand:** `--brand: oklch(0.646 0.222 41.116)` (amber-600 equivalent).
- **Semantic:** `--success` (emerald), `--warning` (amber), `--info`
  (sky), `--danger` (rose). All defined as tokens, never raw Tailwind
  palette classes.
- **Neutral:** `--background`, `--foreground`, `--card`, `--muted`,
  `--border`, `--input`, `--ring` — all OKLCH grayscale.
- **Radius:** `--radius: 0.625rem` (10px) base. `--radius-sm/md/lg/xl`
  derived.
- **No raw color classes.** Replace `bg-amber-600` → `bg-brand`,
  `text-emerald-700` → `text-success`, `bg-rose-100` → `bg-danger/10`.

### 1.3 Typography

- **Sans:** Geist Sans (loaded in `src/app/layout.tsx` via
  `next/font/google`).
- **Mono:** Geist Mono (for codes, tokens, amounts).
- **Scale:** `text-sm` (14px) default body, `text-xs` (12px) captions,
  `text-base` (16px) emphasized body, `text-lg`/`text-xl`/`text-2xl`/
  `text-3xl` headings.
- **Line height:** `leading-relaxed` for body, `leading-tight` for
  headings.
- **Font weight:** `font-medium` (500) for emphasis, `font-semibold` (600)
  for headings, `font-bold` (700) sparingly for CTAs.

### 1.4 Component conventions

- **Cards:** `<Card className="p-6">` with `<CardHeader>`,
  `<CardContent>`, `<CardFooter>`. Don't apply padding directly to
  `CardContent` if you use `CardHeader` — shadcn's `Card` already
  handles internal spacing.
- **Buttons:** Use the `Button` variants — `default`, `secondary`,
  `outline`, `ghost`, `destructive`, `link`. Sizes: `sm`, `default`,
  `lg`, `icon`. Don't invent new variants.
- **Badges:** Use the `Badge` variants — `default`, `secondary`,
  `outline`, `destructive`. For status badges, use the shared
  `@/components/portal/status-badge` (not an inline copy).
- **Forms:** `react-hook-form` + `zod` via `@hookform/resolvers/zod`.
  Use the `Form`, `FormField`, `FormItem`, `FormControl`, `FormLabel`,
  `FormMessage` wrappers from `@/components/ui/form`.
- **Tables:** Always wrap in `<div className="overflow-x-auto">` for
  mobile. Use `Table`, `TableHeader`, `TableBody`, `TableRow`,
  `TableHead`, `TableCell`.
- **Dialogs:** Use `Dialog` (or `AlertDialog` for destructive confirms).
  Always set `aria-describedby`. Focus is auto-managed by Radix.

### 1.5 Interaction design

- **Hover states:** `hover:bg-muted`, `hover:text-foreground`,
  `transition-colors`. Subtle, not flashy.
- **Focus states:** `focus-visible:ring-2 focus-visible:ring-ring
  focus-visible:ring-offset-2`. Never `outline-none` without a
  replacement ring.
- **Loading:** `Skeleton` for initial list loads, `Loader2` (spinning)
  for button submits, `Progress` for long operations.
- **Empty states:** A card with an icon, a one-line explanation, and a
  primary action. Never a blank page.
- **Error states:** `Alert` with `AlertTitle` + `AlertDescription` +
  a retry button. Never a raw `<p>` saying "Error".
- **Success feedback:** `toast.success()` from Sonner. Never a
  full-screen success modal for a minor action.
- **Confirmation dialogs:** `AlertDialog` for destructive actions
  (cancel order, delete file, revoke agent token).
- **Transitions:** Respect `prefers-reduced-motion` (already handled
  in `globals.css:124-131`). Don't add `animate-spin` to non-spinning
  elements.

---

## §2. React Best Practices (React 19)

### 2.1 Server Components by default

- A file with NO `'use client'` directive is a Server Component. It runs
  on the server, can be `async`, can access the filesystem/database
  directly, and ships zero JS to the client.
- **Add `'use client'` only when the file needs:** `useState`,
  `useEffect`, `useRef`, `useReducer`, browser APIs (`window`,
  `localStorage`, `IntersectionObserver`), event handlers (`onClick`,
  `onChange`), or `useSearchParams`/`useRouter`/`usePathname`.
- **Current PrintShop problem:** every page is `'use client'` (audit
  §7). The customer homepage (`src/app/page.tsx`) fetches the shop list
  client-side via `useApiClient` — this could be a Server Component
  that fetches via `fetch()` with revalidation, shipping zero JS for the
  initial render.

### 2.2 Data fetching

- **Server Components:** `async function Page() { const data = await
  db.shop.findMany(...); return <JSX/>; }`. No `useEffect`, no loading
  state for the initial render.
- **Client Components:** `useApiClient().request()` (the PrintShop
  pattern) or TanStack Query for cached/refetching data.
- **Parallelize independent requests:** `const [a, b] = await
  Promise.all([fetchA(), fetchB()]);` not sequential awaits.
- **Avoid waterfalls:** don't fetch A, then fetch B based on A's result,
  if you can fetch both in one round-trip. Add a new API endpoint if
  needed.

### 2.3 Component composition

- **Small components.** A component should do one thing. If a file
  exceeds 400 lines, split it. The 1,568-line `src/app/orders/[id]/page.tsx`
  and 1,409-line `payment-provider-settings.tsx` are flagged for
  splitting (audit §4.6).
- **Props down, events up.** Parent owns state, children are pure.
  Use `useApiClient` at the top of the feature, pass data down as props.
- **Context for cross-cutting state.** `AuthProvider` is the right
  pattern. Don't create a Context for one component's state.
- **`useMemo`/`useCallback` only for expensive values.** Don't wrap
  every function. React 19's compiler (when enabled) handles most memo
  automatically.

### 2.4 Hooks rules

- **Top-level only.** Never call hooks inside conditions, loops, or
  callbacks.
- **Dependency arrays.** `useEffect` deps must include every reactive
  value. The disabled `react-hooks/exhaustive-deps` lint rule (audit
  §1) means bugs slip through — be manual and careful.
- **Cleanup.** Every `useEffect` that subscribes (polling, sockets,
  listeners) must return a cleanup. The customer order page polls every
  30s — verify the interval is cleared on unmount.

### 2.5 React 19 specifics

- **`use()` hook:** for unwrapping promises in client components. Prefer
  Server Components + `async/await` for new code.
- **Actions:** `<form action={serverAction}>` is the new form submission
  pattern. PrintShop uses API routes (not server actions) per the
  project rules — stick with API routes.
- **`useActionState`:** for form state with pending/error. Use it for
  the registration wizard.
- **No `defaultProps`:** destructure props with defaults in the
  signature: `function Button({ size = 'md' }: Props)`.

---

## §3. Composition Patterns

### 3.1 Layout composition

- **Root layout** (`src/app/layout.tsx`): fonts, `<AuthProvider>`,
  `<Toaster />`, `<PWARegister />`. Nothing else.
- **Route group layouts:** `src/app/shop/layout.tsx` (auth gate +
  sidebar), `src/app/admin/layout.tsx` (admin auth gate + sidebar).
  Customer routes have no group layout — they're standalone.
- **Sticky footer:** root layout uses `min-h-screen flex flex-col` on
  `<body>`, footer gets `mt-auto`. This is a hard UI rule.

### 3.2 Component slots

- shadcn `Card` uses the slot pattern: `<Card><CardHeader/><CardContent/>
  <CardFooter/></Card>`. Each slot is a separate component that composes.
- Build PrintShop components the same way: `<OrderCard>
  <OrderCardHeader/><OrderCardFiles/><OrderCardActions/></OrderCard>`.

### 3.3 Compound components

- For components with multiple coordinated parts (like `Tabs`,
  `Select`, `DropdownMenu`), use the compound pattern via Context.
  shadcn already does this — follow its lead.

### 3.4 Render props / function-as-child

- Avoid for new code. Prefer passing data as props and letting the
  child render. Render props break memoization.

### 3.5 Higher-order components

- Avoid. Use hooks instead. `withAuth`/`withOrderAccess` in this
  codebase are server-side route wrappers, not React HOCs.

---

## §4. TypeScript Best Practices

### 4.1 Strict mode

- `tsconfig.json: strict: true`. **But `noImplicitAny: false`** (audit
  §1) — this is too permissive. Don't rely on it; annotate every
  parameter and return type explicitly.
- **No `any`.** Use `unknown` + a type guard, or a proper `interface`.
  The disabled `@typescript-eslint/no-explicit-any` lint rule means
  `any` won't be caught — be disciplined.

### 4.2 Type definitions

- **Interfaces for object shapes:** `interface Shop { id: string; ... }`.
- **Type aliases for unions/functions:** `type OrderStatus =
  'pending' | 'paid' | 'printing' | 'ready' | 'collected' | 'cancelled'`.
- **`type` vs `interface`:** use `interface` for extensible object
  shapes, `type` for unions and intersections. Don't mix them for the
  same concept.
- **Enums:** avoid. Use union types or `as const` objects.

### 4.3 Generics

- **Constrain them:** `<T extends { id: string }>` not bare `<T>`.
- **Infer where possible:** let TypeScript infer, don't annotate every
  generic call site.

### 4.4 Null handling

- **No non-null assertion (`!`).** The disabled
  `@typescript-eslint/no-non-null-assertion` rule means it won't be
  caught — avoid it manually. Use `if (x === null) return null;` then
  narrow.
- **Optional chaining:** `shop?.pricingConfig?.bwA4PerPage ?? 0`.

### 4.5 The `ignoreBuildErrors` flag

- `next.config.ts:7` has `typescript.ignoreBuildErrors: true`. The audit
  (§10) confirmed `npx tsc --noEmit` passes clean — so the flag is
  stale. **The goal is to remove it** once we've verified the build
  passes. Do NOT remove it yet without a green `next build` (which we
  can't run in this sandbox per project rules — `bun run build` is
  forbidden).

---

## §5. Tailwind CSS 4 + shadcn/ui

### 5.1 Tailwind v4 — the new model

- **No `tailwind.config.ts` needed.** v4 reads tokens from CSS via
  `@theme inline` in `globals.css`. The existing `tailwind.config.ts`
  is a v3 leftover with `hsl(var(--token))` wrappers that wrap OKLCH
  values — broken and dead. **Do not add new config there.** Add new
  tokens to `globals.css` `:root` + `.dark` + the `@theme inline` bridge.
- **`@theme inline`** maps CSS variables to Tailwind utility names:
  `--color-brand: var(--brand)` → enables `bg-brand`, `text-brand`,
  `border-brand`, etc.
- **`@custom-variant dark (&:is(.dark *))`** — class-based dark mode.
  The `.dark` class must be applied to `<html>` by a theme provider.
  Currently no provider exists (audit §1) — the dark tokens are
  unreachable. Either add `next-themes` or remove the dark block.

### 5.2 shadcn/ui (new-york style)

- **Style:** `new-york` (sharper, smaller). Set in `components.json`.
- **baseColor:** `neutral` (OKLCH grayscale).
- **49 components installed** at `src/components/ui/`. 22 are dead code
  (audit §3.1). Don't delete them yet (out of scope) but don't use the
  dead ones in new code.
- **Adding a component:** `bunx shadcn@latest add <name>`. Don't hand-
  write a component that shadcn already provides.
- **Customizing:** edit the file in `src/components/ui/`. It's your code
  now. Don't fork it into a new file.

### 5.3 Utility patterns

- **`cn()`** from `@/lib/utils` for conditional classes.
- **`cva()`** (class-variance-authority) for component variants. Already
  used in `button.tsx`, `badge.tsx`.
- **No `@apply` in components.** Use it only in `globals.css` base
  layer.

### 5.4 Responsive design (MANDATORY)

- **Mobile-first.** Write the mobile style first, then enhance with
  `sm:`, `md:`, `lg:`, `xl:`, `2xl:`.
- **Breakpoints:** `sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px,
  `2xl` 1536px.
- **Touch targets ≥ 44px.** `h-11 w-11` minimum for icon buttons. The
  admin Refresh buttons at `h-8 w-8` (audit §5) violate this.
- **Tables:** always `<div className="overflow-x-auto"><Table>...</Table></div>`.
- **Dialogs:** `max-w-[95vw]` on mobile, `max-w-lg` on desktop.
- **Grids:** `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` for card
  grids. Don't use fixed `grid-cols-4` that doesn't collapse.
- **Test at:** 320px, 375px, 430px, 768px, 1024px, 1280px, 1440px,
  1920px. The customer journey is mobile-first — 375px is the primary
  viewport.

### 5.5 Sticky footer (MANDATORY)

Root layout:
```tsx
<body className="min-h-screen flex flex-col bg-background text-foreground">
  <AuthProvider><Toaster/><PWARegister/>{children}</AuthProvider>
  <footer className="mt-auto border-t ...">...</footer>
</body>
```
On short pages, footer sticks to the bottom. On long pages, it's pushed
down naturally. Never overlay, never float.

---

## §6. Accessibility (WCAG 2.2 AA target)

### 6.1 Semantic HTML

- `<main>`, `<header>`, `<nav>`, `<section>`, `<article>`, `<footer>`,
  `<aside>`. Not `<div>` for everything.
- **One `<h1>` per page.** Flat hierarchy (h1 → h2 → h3).
- **Lists:** `<ul>`/`<ol>` + `<li>`, not `<div>` + `<div>`.
- **Tables:** `<table>` for tabular data, with `<caption>` or
  `aria-label` on the wrapper.

### 6.2 ARIA

- **Labels:** every interactive element needs an accessible name. For
  icon-only buttons: `<Button aria-label="Refresh">` or
  `<Button><Search aria-hidden className="size-4"/><span
  className="sr-only">Search</span></Button>`.
- **Decorative icons:** `<Icon aria-hidden className="size-4"/>`.
- **`aria-describedby`:** for inputs with help text or error text.
  `<FormMessage>` from shadcn handles this.
- **`role`:** only add when the semantic element isn't available.
  Radix components (`Dialog`, `Menu`, `Tabs`) handle roles automatically.

### 6.3 Keyboard navigation

- **Tab order:** follows DOM order. Don't fight it with `tabIndex`.
- **Visible focus:** `focus-visible:ring-2 focus-visible:ring-ring
  focus-visible:ring-offset-2`. Never `outline: none` without a
  replacement.
- **Skip link:** `<a href="#main"
  className="sr-only focus:not-sr-only">Skip to content</a>` at the top
  of each layout.
- **Modal focus trap:** Radix `Dialog` handles this. Don't build a
  custom modal.
- **Esc to close:** Radix handles. Don't add your own `keydown` listener.

### 6.4 Color contrast (WCAG 2.2 AA)

- **Normal text:** ≥ 4.5:1 contrast ratio.
- **Large text (≥ 18px or ≥ 14px bold):** ≥ 3:1.
- **UI components + icons:** ≥ 3:1.
- The current `text-muted-foreground` (`oklch(0.556 0 0)` ≈ #8e8e8e on
  white) is ~4.07:1 — slightly under AA for normal text. Use it only
  for ≥ 18px text or for non-essential captions. For body text, use
  `text-foreground`.

### 6.5 Touch targets (WCAG 2.2 SC 2.5.8 — new in 2.2)

- **Minimum 24×24 CSS pixels** for every interactive element, EXCEPT
  when there's adequate spacing (≥ 24px between targets allows 18×18).
- **PrintShop rule:** aim for 44×44 (the older 2.5.5 AAA standard) for
  primary actions, 24×24 minimum for dense toolbars.

### 6.6 Reduced motion

- `globals.css:124-131` already disables animations for
  `prefers-reduced-motion: reduce`. Don't override it.
- Don't add `animate-pulse` to non-loading elements. Don't auto-play
  video.

### 6.7 Screen reader testing

- Test with VoiceOver (Mac) or NVDA (Windows) on at least one page per
  portal. The `agent-browser` skill can capture the accessibility tree
  for inspection.

---

## §7. Performance

### 7.1 Core Web Vitals targets

- **LCP (Largest Contentful Paint):** < 2.5s. Hero image or largest
  text block.
- **INP (Interaction to Next Paint):** < 200ms. Button clicks, form
  submits.
- **CLS (Cumulative Layout Shift):** < 0.1. Reserve space for images,
  don't inject banners that push content.

### 7.2 Bundle size

- **Server Components by default** — ship zero JS for static content.
- **Lazy-load heavy client features:** `const PdfPreview = dynamic(() =>
  import('@/components/portal/pdf-preview'), { ssr: false, loading: ()
  => <Skeleton className="h-48"/> });`
- **`recharts` is heavy (~300 KB).** Don't import it eagerly in a
  dashboard that doesn't show charts on first paint. Use `dynamic()`.
- **`pdfjs-dist`** (~1 MB) — already dynamic-imported in `pdf-preview.tsx`
  (good).
- **Icons:** `lucide-react` is tree-shakeable, but only if you import
  named: `import { Search } from 'lucide-react'` (good), not
  `import * as Icons` (bad).

### 7.3 Images

- `next/image` for all images. Set `width`/`height` (or use `fill` with
  a sized parent) to prevent CLS.
- `priority` only on the LCP image.
- Don't use `next/image` for icons — use `lucide-react`.

### 7.4 Fonts

- `next/font/google` (Geist Sans + Mono) — already loaded with
  `subsets: ['latin']`. Good.
- Don't add another font family. Don't `@import` fonts from Google
  Fonts CDN (it's render-blocking).

### 7.5 Polling

- **Pause on tab hidden:** `if (document.hidden) return;` at the top of
  every polling callback. The current 6 polling intervals (audit §4.5)
  don't do this — fix it.
- **Backoff:** don't poll every 5s forever. Back off to 30s after the
  first minute.
- **Abort on unmount:** `useEffect(() => { const id = setInterval(...);
  return () => clearInterval(id); }, [])`.

### 7.6 Caching

- **Server Components:** `fetch(url, { next: { revalidate: 60 } })` for
  ISR. Don't cache customer-specific data (it's per-shop).
- **Client Components:** TanStack Query with `staleTime: 30_000` for
  dashboard data.
- **No client-side localStorage for API data.** Only for auth tokens
  (already done in `auth-context.tsx`).

---

## §8. Security (PrintShop-specific)

### 8.1 Multi-tenant isolation

- **Every query filters by `shopId` from the JWT principal.** The
  repository layer (`src/lib/repositories/*`) is the only place that
  touches the DB. Never accept `shopId` from the request body.
- **Defense-in-depth gap (audit §8):** the 21 `/shops/me/*` routes call
  `withAuth` without `['owner']`. They accept any authenticated role.
  Add `['owner']` to every shopkeeper route.

### 8.2 Auth layers

| Route type | Guard | Where |
|---|---|---|
| Customer order (`/api/v1/orders/:id/*`) | `withOrderAccess` | `src/lib/api/with-order-access.ts` |
| Shopkeeper (`/api/v1/shops/me/*`) | `withAuth(handler, ['owner'])` | `src/lib/api/with-auth.ts` |
| Admin (`/api/v1/admin/*`) | `withAuth(handler, ['admin'])` | `src/lib/api/with-auth.ts` |
| Print agent (`/api/v1/agents/*`) | `withDeviceAuth` | `src/lib/api/with-auth.ts` |
| Public (`/api/v1/shops`, `/api/v1/shops/:slug`) | `withRateLimit` | `src/lib/api/with-auth.ts` |

### 8.3 Payment security

- **Payment success is determined server-side only:** webhook signature
  verification (`phonepe-v2-webhook.ts`) or shopkeeper manual
  verification (`/shops/me/orders/:id/verify-payment`).
- **Never** set `paymentStatus = 'paid'` from client code.
- **Idempotency:** `PaymentAttempt` table + idempotency keys prevent
  double-processing. Don't bypass.
- **Paise, not rupees:** all amounts in `Int` paise. No floats. No
  `Number(amount).toFixed(2)`.

### 8.4 Secrets

- **Client code (`'use client'`):** only `process.env.NEXT_PUBLIC_*`.
- **Server code:** `process.env.JWT_ACCESS_SECRET`,
  `PAYMENT_ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, etc.
- **`.env` is gitignored.** `.env.example` is the template.
- **Never log secrets.** The JSON logger (`src/lib/logger/`) doesn't
  redact — be careful what you pass to `logRequest`.

### 8.5 Destructive operations

- **Never run:** `prisma migrate reset`, `prisma db push
  --accept-data-loss` (the `package.json` script is for initial setup
  only), `DROP TABLE`, `DELETE FROM` without `WHERE`.
- **The 4 ALTER TABLE statements** the user needs to run on Supabase
  (adding `paymentMethods`, `pamphletEnabled`, `pamphletPricePaise`,
  `pamphletName` to the `Shop` table) — these are additive and safe,
  but require Supabase dashboard access. The `setup-database` endpoint
  at `src/app/api/v1/setup-database/route.ts` runs them via
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.

---

## §9. Testing

### 9.1 Unit + integration (Vitest)

- **Run:** `bunx vitest run`
- **25 test files, ~225 tests** in `packages/` + `src/lib/`. All pass
  (verified this session).
- **Zero tests in `src/app/`.** Add tests for any new app code.
- **Test the pricing engine, payment signature verification, order
  state machine, auth guards, repository layer.** Don't test UI
  rendering in Vitest — use Playwright for that.

### 9.2 E2E (Playwright — newly installed)

- **Run:** `bunx playwright test`
- **Test the golden paths:** customer upload→pay→track, shopkeeper
  login→dashboard→order detail→verify payment, admin login→orders→
  shops.
- **Use test accounts.** Don't use real customer data or real payment
  credentials.
- **Mock payment providers only inside isolated tests.** Keep the
  signature-verification tests on the real code path.

### 9.3 Visual QA (agent-browser)

- Use the `agent-browser` skill to capture screenshots at 375px (mobile)
  and 1280px (desktop) for every redesigned page.
- **Inspect the screenshot.** Don't just save it — look at it. Check
  spacing, alignment, overflow, contrast.
- **Check console errors.** `agent-browser` captures them. Fix every
  one.

### 9.4 Test-driven development

- **Write the test first** for bug fixes: reproduce the bug with a
  failing test, then fix the code.
- **For new features:** write the test alongside the implementation,
  not after.
- **Never weaken an assertion to make a test pass.** If the test fails,
  the code is wrong.

---

## §10. Debugging

### 10.1 Systematic debugging

1. **Reproduce.** Get a reliable repro before touching anything.
2. **Isolate.** Strip the failing code down to the smallest case that
   still fails.
3. **Hypothesize.** Form a theory about the cause.
4. **Test the hypothesis.** Add a log, a breakpoint, or a one-line
   experiment.
5. **Fix the root cause.** Not the symptom. If you're patching a
   symptom, you're introducing tech debt.
6. **Verify the fix.** Run the test, reproduce the original scenario,
   confirm it's gone.
7. **Look for siblings.** The same bug probably exists elsewhere —
   grep for the pattern.

### 10.2 Tools

- **`dev.log`:** `tail -50 /home/z/my-project/dev.log` for server-side
  errors.
- **Browser console:** `agent-browser` captures console errors +
  network failures.
- **`tsc --noEmit`:** type errors (run independently of Next build).
- **`bunx vitest run`:** test failures with file:line.

### 10.3 Common PrintShop pitfalls

- **`'use client'` on everything:** makes the bundle huge and breaks
  SSR. Move data fetching to Server Components where possible.
- **Polling without cleanup:** memory leak + stale data. Always
  `clearInterval` in the `useEffect` cleanup.
- **`api.ready` not awaited:** the first API call fires before the
  auth token is loaded from localStorage. Check `if (!api.ready) return;`
  in the effect.
- **`formatINRFromPaise(undefined)`:** crashes. Guard with `?? 0`.
- **`shop?.pricingConfig?.bwA4PerPage` undefined:** the pricing engine
  throws. Validate the config before calling `priceFile`.

---

## §11. Code review checklist

Before marking any change done:

- [ ] `npx tsc --noEmit` passes clean
- [ ] `bun run lint` passes (even if advisory)
- [ ] `bunx vitest run` passes (existing tests + any new ones)
- [ ] `agent-browser` screenshot of every changed route at 375px + 1280px
- [ ] No new `any` types
- [ ] No new `!` non-null assertions
- [ ] No raw color classes (`amber-600`, `emerald-100`) — use tokens
- [ ] No inline `StatusBadge`/`PaymentBadge`/`truncate` — use shared
- [ ] No `'use client'` on a file that could be a Server Component
- [ ] Every interactive element has an accessible name + visible focus
- [ ] Touch targets ≥ 44px (or ≥ 24px with spacing)
- [ ] Tables wrapped in `overflow-x-auto`
- [ ] Polling pauses on `document.hidden` + cleans up on unmount
- [ ] No secrets in client code
- [ ] No mock data in production paths
- [ ] Multi-tenant filter (`shopId`) on every DB query
- [ ] Auth guard (`withAuth`/`withOrderAccess`) on every API route

---

## §12. References

- Next.js 16 docs: https://nextjs.org/docs
- React 19 docs: https://react.dev/reference
- Tailwind CSS 4 docs: https://tailwindcss.com/docs
- shadcn/ui docs: https://ui.shadcn.com/docs
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Playwright docs: https://playwright.dev/docs
- Prisma docs: https://www.prisma.io/docs
- Zod docs: https://zod.dev
- Vercel deployment: https://vercel.com/docs
