import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { repos } from '@/lib/repositories';
import { ok, fail, toAppError } from '@/lib/api/envelope';
import { withRateLimit } from '@/lib/api/with-auth';
import { NotFoundError } from '@platform/core/errors';
import { generateOrderToken, generateShopOrderTokenNumber } from '@platform/utils';

const CreateOrderSchema = z.object({
  customerPhone: z.string().max(20).optional(),
  notes: z.string().max(500).optional(),
});

/**
 * POST /api/v1/shops/:slug/orders — create a draft order (no auth).
 *
 * Returns two tokens:
 *   - customerToken: short unambiguous string (BGBCM5) — used by the
 *     customer to track their order anonymously.
 *   - tokenNumber: per-shop sequential number (A104) — used by the
 *     shopkeeper to call orders aloud ("order A104 is ready").
 *
 * ── Race-safe allocation strategy ──────────────────────────────────
 * The tokenNumber is allocated via `repos.orders.createWithUniqueToken`,
 * which:
 *   1. Computes a candidate from `countByShop() + 1 + attempt`.
 *   2. INSERTs with that candidate. The database's UNIQUE constraint on
 *      (shopId, tokenNumber) — applied as a partial unique index in
 *      prisma/pg-constraints.sql and as `@@unique` in schema.prisma —
 *      rejects any concurrent double-allocation with P2002/23505.
 *   3. On a unique-violation, regenerates the candidate (count + 1 +
 *      next-attempt) and retries. The retry uses a fresh order id, so
 *      a partially-applied INSERT cannot create a duplicate order.
 *   4. After 8 attempts, falls back to NULL tokenNumber — the shopkeeper
 *      references the order by customerToken instead. No order is ever
 *      lost because of a token allocation failure.
 *
 * The customerToken uses a separate collision-retry loop (5 attempts)
 * before the create — it's a 6-char random string from a 31-bit alphabet,
 * so collisions are vanishingly rare. There is no DB UNIQUE constraint on
 * customerToken (the spec doesn't require it), so the collision check is
 * application-level only.
 *
 * Payment side effects (webhook → mark paid) happen LATER, are gated by
 * the order's status transition guard (`canTransitionOrder`), and are
 * independently idempotent via the `paymentTxnId` UNIQUE constraint.
 * Retries here cannot double-charge.
 */
export const POST = withRateLimit<{ slug: string }>('create-order', 20, 60, async (req, ctx) => {
  try {
    const { slug } = await ctx.params;
    const shop = await repos.shops.findBySlug(slug);
    if (!shop || !shop.isActive) throw new NotFoundError('Shop not found');

    const body = CreateOrderSchema.parse(await req.json());

    // ── Pre-flight collision check for customerToken (best-effort; the
    // authoritative guard against duplicates is the random 31-bit space
    // itself — ~2.4 billion tokens). The check-then-insert here is a
    // fast path that avoids a wasteful INSERT when a collision is likely. ──
    let customerToken = generateOrderToken();
    for (let i = 0; i < 5; i++) {
      const existing = await repos.orders.listByShop(shop.id, { limit: 1 }).then((os) =>
        os.find((o) => o.customerToken === customerToken),
      );
      if (!existing) break;
      customerToken = generateOrderToken();
    }

    // ── Race-safe order creation with per-shop sequential tokenNumber. ──
    // The repository handles the count-then-insert + retry-on-P2002 loop.
    // `tokenCandidate(count, attempt)` returns the candidate token for the
    // given order count + retry attempt. The +attempt ensures that on retry
    // we try the next slot (not the same one that just collided).
    const order = await repos.orders.createWithUniqueToken(
      shop.id,
      {
        customerToken,
        customerPhone: body.customerPhone ?? null,
        notes: body.notes ?? null,
      },
      (count, attempt) => generateShopOrderTokenNumber(count + 1 + attempt),
    );

    await repos.audit.log({
      shopId: shop.id,
      userId: null,
      action: 'order.create',
      entityType: 'order',
      entityId: order.id,
      metadata: { tokenNumber: order.tokenNumber },
      ip: req.headers.get('x-forwarded-for') ?? null,
    });

    return ok({
      orderId: order.id,
      customerToken: order.customerToken,
      tokenNumber: order.tokenNumber,
      status: order.status,
      shop: { name: shop.name, slug: shop.slug },
    });
  } catch (cause) {
    return fail(toAppError(cause));
  }
});
