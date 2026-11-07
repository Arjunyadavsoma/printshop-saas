# PrintShop SaaS — Agent Instructions

> This file mirrors `CLAUDE.md` for coding agents that look for `AGENTS.md`
> (e.g. Aider, Cursor, Continue). The authoritative instructions live in
> [`CLAUDE.md`](./CLAUDE.md). Read that first.

## TL;DR for any agent

1. **Read `docs/REDESIGN_AUDIT.md` before touching code.** Every issue cites a `file:line`.
2. **Stack is fixed:** Next.js 16, React 19, TS 5, Tailwind 4, shadcn/ui (new-york), Prisma 6, Zustand, TanStack Query, socket.io, framer-motion, recharts.
3. **Adapter pattern is sacred:** `packages/core` imports interfaces only — never `@platform/adapters`.
4. **Money is integer paise.** No floats. `formatINRFromPaise` from `@platform/utils`.
5. **Multi-tenant isolation:** every query filters by `shopId` from the JWT.
6. **Auth layers:** `withAuth(['owner'])` for shopkeeper routes, `withAuth(['admin'])` for admin, `withOrderAccess` for customer order routes.
7. **No mock data in production paths.** No hardcoded dashboard stats. No fake payment success.
8. **Verify before claiming done:** `npx tsc --noEmit` + `bun run lint` + `bunx vitest run` + agent-browser screenshot of every changed route.
9. **Never fabricate results.** If a check didn't run, say so.
10. **Never run destructive DB commands** (`prisma migrate reset`, `prisma db push --accept-data-loss`, `DROP TABLE`) without explicit authorization.

## Available skills (built-in, not Claude Code external)

Located at `/home/z/my-project/skills/` and exposed via the Z.ai Code `Skill` tool:

- `fullstack-dev` — Next.js 16 + React 19 + Tailwind 4 + shadcn/ui + Prisma (the primary skill for this project)
- `agent-browser` — Rust headless browser CLI for visual QA + E2E verification
- `neon-postgres` — Postgres guidance (project uses Supabase Postgres)
- `image-generation` — generate placeholder imagery
- `charts` — Mermaid / ECharts / D3 diagrams
- `pdf`, `docx`, `xlsx`, `pptx` — document generation
- `LLM`, `VLM`, `TTS`, `ASR` — z-ai-web-dev-sdk wrappers (backend only)
- `image-search` — find real images from the web
- `skill-creator` — create new skills

## Compatibility note

External Claude Code-format skills (frontend-design, UI UX Pro Max,
vercel-labs/agent-skills, obra/superpowers, anthropics/skills webapp-testing)
are **not installed** — they require Claude Code's skill loader. See
`docs/AI_DEVELOPMENT_ENVIRONMENT.md` for the full compatibility matrix and
the real alternatives in use.

## Installed browser tooling

- `@playwright/test@1.65.0` — real npm dependency (added 2025-11-07)
- Playwright Chromium 158.0.8127.18 — browser binary installed at
  `/home/z/.cache/ms-playwright/`
- `agent-browser` skill — Rust-based headless browser automation CLI

See `docs/AI_DEVELOPMENT_ENVIRONMENT.md` for verification results.
