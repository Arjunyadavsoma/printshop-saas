# Contributing

Thanks for helping build PrintShop SaaS. A few hard rules keep the architecture
load-bearing.

## The one rule that cannot bend

> **Business logic (`apps/*`, `packages/core`) must never import a concrete
> adapter.** It imports interfaces from `@platform/core/interfaces` only.

A PR that adds `import { SupabaseDatabaseAdapter } from '@platform/adapters'`
inside `packages/core` or a route handler is rejected. Concretes are
constructed at the composition root (`apps/api/src/container.ts`) and
injected. See [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Code quality

- 100% TypeScript, `strict`. No `any` — use `unknown` + narrowing.
- No file > 300 lines; no function > 50 lines. Split aggressively.
- Every public function has a JSDoc `@param` / `@returns`.
- Every module has a co-located `.test.ts`.
- Coverage targets: 80% overall, 100% for `pricing` and `payment`.
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`.
- Every PR adds a `CHANGELOG.md` entry.

## Money

All currency is integer paise. Never floats. Never `Number` for money in a
column. See `packages/utils/currency.ts`.

## Local dev

```bash
bun install
docker compose up -d          # optional: local Postgres/Redis/MinIO/Mailpit
cd packages/core && bunx vitest run && cd ../..
bun run dev
bun run lint
```

## Adding a provider

1. Implement the interface in `packages/adapters/src/<service>/`.
2. If the provider id is new, add it to the enum in `packages/core/src/domain/enums.ts`.
3. Register it in the composition-root factory.
4. Document the env var in `.env.example`.
5. Add an in-memory/stub variant alongside it if one doesn't exist.
