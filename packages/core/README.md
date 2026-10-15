# `@platform/core`

Domain models, adapter interfaces, and the pure pricing engine for the
PrintShop SaaS. **Zero runtime dependencies on any concrete adapter** —
this package is the single source of truth for business rules.

## The adapter pattern, in one paragraph

Every external service the app needs — database, file storage, payments,
realtime, cache, queue, email, SMS, logging, auth — is declared as a
**TypeScript interface** here in `packages/core/src/interfaces/`. Concrete
implementations live in `packages/adapters/`. Business logic imports the
**interface only**; the runtime implementation is selected at boot by an env
var (`DATABASE_PROVIDER=supabase`, `STORAGE_PROVIDER=r2`, …). To add or swap
a provider, you write a new class that implements the interface and flip one
env var — no business-logic file is touched.

## What's in here

```
src/
  domain/           # enums + Zod schemas + aggregates (Shop, User, Order, …)
  interfaces/        # 9 adapter contracts — the ONLY thing business logic imports
    database.adapter.ts
    storage.adapter.ts
    payment.adapter.ts
    realtime.adapter.ts
    cache.adapter.ts
    queue.adapter.ts
    email.adapter.ts
    sms.adapter.ts
    logger.adapter.ts
    auth.adapter.ts
  pricing/           # the pure, side-effect-free pricing engine
    types.ts
    resolve-rate.ts        # base-rate lookup + half-up rounding
    breakdown.ts           # the intermediate numbers
    pricing-engine.ts      # priceFile() entry point + errors
    pricing-engine.test.ts # 35 unit tests
  errors/            # AppError hierarchy with stable codes
  index.ts           # barrel
```

## The pricing engine

`priceFile(input)` is the entry point. Rules (spec §9):

1. **Base rate** = `config[`${colorMode}_${paperSize}_per_page`]`
2. **Duplex discount** — if `duplex` AND `config.duplex_discount > 0`, that % off gross
3. **Bulk discount** — if `totalPages >= config.bulk_threshold` AND `bulk_discount_pct > 0`, that % off the post-duplex subtotal
4. **Minimum order** — if subtotal `< min_order_value`, round up (default) or reject (configurable)
5. **All math in integer paise**, round half-up at each step — never floats

```ts
import { priceFile, createDefaultPricingConfig } from '@platform/core';

const result = priceFile({
  pages: 10,
  copies: 3,
  colorMode: 'color',
  paperSize: 'a4',
  duplex: true,
  shopPricingConfig: createDefaultPricingConfig(),
});
// → { totalPaise: 16200, lineItems: [Print…, Duplex discount, Bulk discount] }
```

Run the tests:

```bash
cd packages/core && bunx vitest run      # 35 passing
```

## Why the in-memory concretes?

Each interface ships with at least two implementations in
`packages/adapters`:

1. A **free-tier production** implementation (Supabase, R2, Upstash, …) — wired in later phases.
2. An **in-memory / stub** implementation — used by every unit test so tests run with **zero network, zero cost, zero flakiness**.

That duality is the payoff: the same business logic runs identically against
`InMemoryDatabaseAdapter` in CI and `SupabaseDatabaseAdapter` in prod.

## Adding a new provider — the checklist

Say you want to add **Razorpay** as a payment provider:

1. Implement `RazorpayPaymentAdapter` in `packages/adapters/src/payment/`.
2. Add `'razorpay'` to `PaymentProvider` in `domain/enums.ts`.
3. Set `PAYMENT_PROVIDER=razorpay` in `.env`.

That's it. No business logic changes. No route changes. The repository layer
constructs the adapter from the env var at boot.
