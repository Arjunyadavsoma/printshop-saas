# PrintShop SaaS — Development Standards

> Project-level instructions for any AI coding agent (Claude Code, GLM-5.2,
> Cursor, etc.) working in this repository. These rules are **mandatory**
> and override any conflicting general guidance.

Repository: https://github.com/Arjunyadavsoma/printshop-saas
Production: https://printshop-saas-three.vercel.app
Working directory: `/home/z/my-project`

---

## 1. Mandatory workflow

1. **Inspect the repository before changing code.** Read `docs/REDESIGN_AUDIT.md`
   and `ARCHITECTURE.md` first. Every claim in the audit cites a `file:line`.
2. **Read relevant installed skills before implementation.** The available
   skills live in `/home/z/my-project/skills/` and are also exposed through
   the Z.ai Code `Skill` tool. The most relevant for this project:
   - `fullstack-dev` — Next.js 16 + React 19 + Tailwind 4 + shadcn/ui + Prisma
   - `agent-browser` — headless browser automation for visual QA
   - `neon-postgres` — Postgres guidance (project uses Supabase Postgres)
   - `image-generation` — generate placeholder/hero imagery
   - `charts` — Mermaid / ECharts / D3 diagrams
3. **Plan significant changes.** Use the `Plan` subagent for any change that
   touches > 3 files or > 200 lines.
4. **Preserve existing architecture.** The adapter pattern in `packages/core` +
   `packages/adapters` is the load-bearing wall. **Business logic imports
   interfaces only — never a concrete adapter.** See `ARCHITECTURE.md`.
5. **Use existing dependencies where practical.** Do not add a competing
   component library, state manager, or styling system. The stack is fixed:
   Next.js 16, React 19, TypeScript 5, Tailwind CSS 4, shadcn/ui (new-york),
   Prisma 6, Zustand, TanStack Query, socket.io, framer-motion, recharts.
6. **Implement real functionality.** No mock data in production paths. No
   hardcoded dashboard stats. No simulated successful payments. No fake
   "verified" states triggered by a button click.
7. **Run type checking independently.** `npx tsc --noEmit` must pass clean
   before any change is considered done. Do **not** rely on
   `next.config.ts: typescript.ignoreBuildErrors: true` as evidence of a
   successful build — that flag is stale (tsc passes clean) and the goal is
   to remove it. See `docs/REDESIGN_AUDIT.md` §10.
8. **Run linting.** `bun run lint`. Note: `eslint.config.mjs` disables most
   rules — passing lint is necessary but not sufficient.
9. **Run unit tests.** `bunx vitest run`. 25 test files, ~225 tests, all in
   `packages/` + `src/lib/`. No tests exist in `src/app/` yet — add them
   when you change app code.
10. **Run browser tests.** Use the `agent-browser` skill (or `@playwright/test`
    directly) to verify every changed route at desktop + mobile widths.
11. **Inspect screenshots.** A passing test is not proof of a working UI.
    Capture a screenshot, look at it, fix what's broken.
12. **Fix discovered issues.** Do not document a bug and move on — fix it
    in the same change.
13. **Verify the final build.** `bun run lint` + `npx tsc --noEmit` +
    `bunx vitest run` + agent-browser smoke test on every changed route.

---

## 2. Design rules

- **No generic AI-generated UI.** No "gradient hero with three feature cards
  and a CTA button" template. PrintShop is a commercial printing platform —
  the visual identity communicates trust, speed, and financial transparency.
- **No unnecessary gradients.** Solid colors, token-driven. The brand color
  is amber-600 (`oklch(0.646 0.222 41.116)` ≈ `#d97706`) — register it as
  `--brand` in `globals.css` and use it consistently.
- **No arbitrary colors.** Every color must come from a CSS custom property
  in `globals.css`. No raw `amber-600`, `emerald-100`, `sky-200` Tailwind
  classes in app code — use semantic tokens (`bg-brand`, `bg-success`,
  `text-warning`, etc.). See `docs/DESIGN_SYSTEM.md`.
- **Consistent spacing and typography.** Use the Tailwind spacing scale
  (`gap-4`, `p-6`) and the Geist font scale. No inline `style={{ padding: 13 }}`.
- **Professional SaaS design.** Cards with `p-6`, sections with `gap-6`,
  tables with `overflow-x-auto` wrappers, dialogs that fit on mobile.
- **Responsive mobile layouts.** Mobile-first. Test at 320px, 375px, 430px,
  768px, 1024px, 1440px. Touch targets ≥ 44px. Footer is sticky to bottom
  on short pages, pushed down naturally on long pages
  (`min-h-screen flex flex-col` + `mt-auto` on footer).
- **Accessible interactive components.** Every interactive element has a
  visible focus ring, an accessible name, and a ≥ 44px touch target.
  Decorative icons get `aria-hidden`. Heading hierarchy is flat (h1 → h2 → h3,
  never h1 → h3).
- **Meaningful loading and error states.** Skeletons for lists, spinners
  for actions, empty states with a next action, error states with a retry.
  Never show a blank screen.

---

## 3. Testing rules

- **Never claim a test passed without executing it.** Run `bunx vitest run`
  and paste the actual output into your final report.
- **Never replace real API responses with fake data to hide failures.** If
  an API is unreachable in the sandbox, say so. Mock only inside explicitly
  isolated tests, and keep signature-verification + lifecycle tests on the
  real code path.
- **Never weaken assertions to make tests pass.** If a test fails, the code
  is wrong — fix the code, not the test.
- **Test actual browser interactions.** Use `agent-browser` or
  `@playwright/test`. Click the real button, submit the real form, read the
  real DOM. Do not assert "the button exists therefore it works."
- **Capture and inspect screenshots.** A visual regression test that no one
  looks at is worthless. Save the PNG, open it, verify it.
- **Test multiple screen sizes.** 375px (mobile), 768px (tablet), 1280px
  (desktop) minimum. The customer journey is mobile-first — test it on a
  375px viewport every time.

---

## 4. Security rules

PrintShop is a multi-tenant SaaS handling real UPI payments. These rules
are non-negotiable.

- **Preserve multi-tenant isolation.** Every database query in
  `src/lib/repositories/*` must filter by `shopId` from the JWT principal.
  Never accept `shopId` from the request body or query string in a
  shopkeeper route.
- **Preserve role-based access.** `withAuth(handler, ['owner'])` for
  shopkeeper-only routes, `withAuth(handler, ['admin'])` for admin routes,
  `withOrderAccess(handler)` for customer order routes. **Defense-in-depth
  gap to close:** the 21 `/shops/me/*` routes call `withAuth` without
  `['owner']` — they accept any authenticated role. Add `['owner']`.
- **Preserve payment verification.** Payment success is determined by
  webhook signature verification (`src/lib/payments/phonepe-v2-webhook.ts`)
  or shopkeeper manual verification (`/shops/me/orders/[id]/verify-payment`).
  Never set `order.paymentStatus = 'paid'` from a client-side button.
- **Never expose secrets.** No `JWT_ACCESS_SECRET`, no `PAYMENT_ENCRYPTION_KEY`,
  no `SUPABASE_SERVICE_ROLE_KEY` in client code. The `z-ai-web-dev-sdk` is
  backend-only. Check every `process.env.*` reference — if it's in a
  `'use client'` file, it must be `NEXT_PUBLIC_*`.
- **Never execute destructive database commands without explicit
  authorization.** No `prisma migrate reset`, no `prisma db push
  --accept-data-loss`, no `DROP TABLE`, no `DELETE FROM` without a `WHERE`
  clause. The `package.json` script `"db:push": "prisma db push
  --accept-data-loss"` exists for initial schema setup only — do not run it
  on a populated production database.

---

## 5. File organization rules

- **Server Components by default.** Only add `'use client'` when the file
  uses hooks (`useState`, `useEffect`), browser APIs, or event handlers.
- **Client Components stay small.** Split any client component > 800 lines.
  The current `src/app/orders/[id]/page.tsx` (1,568 lines) and
  `src/components/portal/payment-provider-settings.tsx` (1,409 lines) are
  flagged for splitting.
- **Business logic in `packages/core`.** Never import a concrete adapter
  (`@platform/adapters`) from business logic (`packages/core`).
- **Routes in `src/app`.** API routes in `src/app/api/v1/*`. Page routes
  in `src/app/{shops,orders,shop,admin}/*`.
- **Shared UI in `src/components/ui`** (shadcn primitives) **and
  `src/components/portal`** (PrintShop-specific shared components). Do not
  inline a `StatusBadge` or `PaymentBadge` in a page — import the shared one.
- **Utils in `src/lib/utils.ts` or `packages/utils`.** Do not define
  `truncate` / `formatINR` / `timeAgo` inline in a page.

---

## 6. Existing documentation to read

| Document | Path | What it covers |
|---|---|---|
| Redesign audit | `docs/REDESIGN_AUDIT.md` | Deep file-by-file audit, every issue with `file:line` |
| UX audit (prior) | `docs/UX_AUDIT.md` | Pre-redesign baseline scores (7.0 → 7.5) |
| Production audit | `docs/PRODUCTION_AUDIT.md` | Security review |
| Architecture | `ARCHITECTURE.md` | Adapter pattern, money-as-paise, multi-tenancy |
| README | `README.md` | 7-phase build, adapter swap guide |
| Deploy | `DEPLOY.md` | Vercel + Render + Docker |
| AI dev environment | `docs/AI_DEVELOPMENT_ENVIRONMENT.md` | What tools are actually installed |
| Engineering playbook | `docs/references/ENGINEERING_PLAYBOOK.md` | Consolidated best practices |
| Design system | `docs/DESIGN_SYSTEM.md` | Tokens, components, patterns |
| Payment setup | `docs/payment-setup.md` | PhonePe / Paytm / UPI configuration |

---

## 7. Quick commands

```bash
bun run dev          # Start dev server (port 3000, logs to dev.log)
bun run lint         # ESLint
npx tsc --noEmit     # Independent type check (must pass clean)
bunx vitest run      # Unit + integration tests
bunx playwright test # E2E browser tests (when added)
bun run db:generate  # Prisma client regeneration
bun run db:push      # ⚠️ DESTRUCTIVE — initial schema setup only
```

---

## 8. Agent runtime note

This repository is developed with **GLM-5.2 inside Z.ai Code**, not Claude
Code. The external Claude Code-format skills referenced in some task prompts
(`anthropics/claude-code` frontend-design, `vercel-labs/agent-skills`,
`obra/superpowers`, `anthropics/skills` webapp-testing) are **not installed**
because they require Claude Code's skill loader and a `~/.claude/skills/`
directory that does not exist in this runtime. The equivalent capabilities
are provided by the built-in Z.ai skills in `/home/z/my-project/skills/`
(see `docs/AI_DEVELOPMENT_ENVIRONMENT.md` for the full compatibility matrix).
