# Architecture — the adapter pattern, with a worked example

## 1. The invariant

> Business logic imports **interfaces** from `@platform/core/interfaces`.
> It never imports a concrete class from `@platform/adapters`.

This is enforced structurally, not by convention:

```
packages/core      ← interfaces (no concrete deps)
packages/adapters  ← concretes (depend on core interfaces)
apps/*             ← compose a concrete at boot, inject it
```

`@platform/core` has no dependency on `@platform/adapters`. A dependency
graph walk would fail the build if it ever did. This is the load-bearing wall
of the whole architecture.

## 2. The shape of an interface

Every adapter interface is a small, capability-focused contract. The
`DatabaseAdapter` is representative:

```ts
export interface DatabaseAdapter {
  readonly provider: string;
  findOne<T>(table: string, filter: Filter, options?: DbCallOptions): Promise<T | null>;
  findMany<T>(table: string, filter: Filter, options?: FindManyOptions): Promise<T[]>;
  insert<T>(table: string, doc: Document, options?: DbCallOptions): Promise<T>;
  update<T>(table: string, filter: Filter, patch: Document, options?: DbCallOptions): Promise<T[]>;
  delete(table: string, filter: Filter, options?: DbCallOptions): Promise<number>;
  count(table: string, filter: Filter, options?: DbCallOptions): Promise<number>;
  transaction<T>(work: (tx: TxLike) => Promise<T>): Promise<T>;
  ping(): Promise<boolean>;
}
```

Note what is **not** here: no SQL, no Supabase client, no Drizzle. Those live
inside the concrete. The business layer talks CRUD-shaped sentences; the
concrete decides how to honour them.

## 3. The composition root

At boot, a tiny factory reads env vars and hands the business layer a
concrete instance typed as the interface:

```ts
// apps/api/src/container.ts (Phase 2)
import type { DatabaseAdapter } from '@platform/core/interfaces';
import { InMemoryDatabaseAdapter } from '@platform/adapters';
// import { SupabaseDatabaseAdapter } from '@platform/adapters';

export function createDatabase(): DatabaseAdapter {
  switch (process.env.DATABASE_PROVIDER) {
    case 'supabase': return new SupabaseDatabaseAdapter({ /* … */ });
    case 'postgres': return new PostgresDatabaseAdapter({ /* … */ });
    case 'memory':
    default:         return new InMemoryDatabaseAdapter();
  }
}
```

The repository layer depends on `DatabaseAdapter` (interface). It never knows
which concrete it got.

## 4. Worked example — swapping Supabase → self-hosted Postgres

**Situation.** Your shop count has grown past Supabase's free 500MB. You spin
up a €5/mo Hetzner box with Postgres 16.

**Step 1.** Implement the concrete (a new file, ~150 lines):

```ts
// packages/adapters/src/database/postgres.adapter.ts
import type { DatabaseAdapter, Document, Filter, TxLike } from '@platform/core/interfaces';
import { Pool } from 'pg';

export class PostgresDatabaseAdapter implements DatabaseAdapter {
  readonly provider = 'postgres';
  private pool = new Pool({ connectionString: this.config.url });
  constructor(private config: { url: string }) {}

  async findOne<T>(table: string, filter: Filter): Promise<T | null> {
    const { where, values } = buildWhere(filter);
    const res = await this.pool.query<T>(
      `SELECT * FROM "${table}" ${where} LIMIT 1`, values);
    return res.rows[0] ?? null;
  }
  // …findMany, insert, update, delete, count, transaction…
}
```

**Step 2.** Register it in the factory (one `case`):

```ts
case 'postgres':
  return new PostgresDatabaseAdapter({ url: process.env.DATABASE_URL_POSTGRES! });
```

**Step 3.** Flip the env var:

```diff
- DATABASE_PROVIDER=supabase
+ DATABASE_PROVIDER=postgres
+ DATABASE_URL_POSTGRES=postgres://user:pass@10.0.0.5:5432/printshop
```

**Step 4.** Re-deploy.

**What did NOT change?** The repository layer, the routes, the pricing engine,
the order state machine, the audit logger, the tests. None of them ever knew it
was Supabase. The migration is a **concrete + config** change, never a
business-logic change.

## 5. The same is true for every other adapter

| If you outgrow… | Swap to… | Files touched (business logic) |
| --- | --- | --- |
| Supabase 500MB | Hetzner Postgres | **0** |
| R2 10GB | AWS S3 | **0** |
| Upstash 500K cmd/mo | ElastiCache | **0** |
| Supabase Realtime 200 conc. | Socket.IO node | **0** |
| Resend 3K emails/mo | Postmark | **0** |
| UPI deep-link | PhonePe merchant | **0** |

The adapter interfaces are the API surface the business layer commits to.
Everything below is movable.

## 6. Multi-tenancy safety

Every query carries a `shopId`. The repository layer (Phase 2) is the
**only** place that touches the database, and it injects `shopId` from the
JWT into every `filter` — structurally preventing cross-tenant reads. No
raw query lives in a route handler.

## 7. Money

All currency is stored as **integer paise** (1 INR = 100 paise) in `Int`
columns. The pricing engine operates entirely in paise with half-up rounding.
There is no `float` money anywhere in `packages/core`.
