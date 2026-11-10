import { vi } from 'vitest';

/**
 * Phase 5.3 — Test mock for the raw Prisma client (`@/lib/db`).
 *
 * IMPORTANT: This file MUST NOT statically import `@/lib/container` because
 * `@/lib/container` imports `@/lib/db` (which is mocked by this file). A
 * static import would create a circular dependency that deadlocks module
 * loading. Instead, `getContainer` is imported DYNAMICALLY inside the order
 * methods (at call time, not at module load time).
 *
 * See the class-level docstring in the lifecycle service for the full
 * architecture explanation.
 */

/**
 * Phase 5.3 — Test mock for the raw Prisma client (`@/lib/db`).
 *
 * The lifecycle service uses `db.$transaction(async (tx) => { ... })` where
 * `tx` has Prisma-style methods (`tx.paymentEvent.create`, `tx.order.updateMany`,
 * etc.). This mock provides those methods so tests can exercise the lifecycle
 * service without a real PostgreSQL connection.
 *
 * ## Data stores
 *
 * - **PaymentAttempt / PaymentEvent**: stored in internal Maps (within the
 *   mock). These tables are NOT managed by the repository pattern (they're
 *   accessed only via the raw Prisma client), so they have their own storage.
 * - **Order**: delegates to the InMemory adapter (`getContainer().db`).
 *   Orders are created via `repos.orders.create` (InMemory adapter), so the
 *   mock's `order.findUnique` / `order.updateMany` must read/write the SAME
 *   data the InMemory adapter holds.
 *
 * ## $transaction
 *
 * The mock's `$transaction(fn)` calls `fn(mock)` — a pass-through. There's
 * no real transaction isolation in tests, but the data is consistent (all
 * operations see the same Maps / InMemory adapter state). Real transaction
 * semantics (rollback, isolation) are tested separately via PGlite in
 * `payment-event-persistence.test.ts` and `lifecycle.service.test.ts`.
 *
 * ## vi.fn wrappers
 *
 * All methods are `vi.fn()` instances so tests can use:
 *   - `vi.mocked(db.paymentAttempt.create).mockRejectedValueOnce(...)` for
 *     per-test failure injection.
 *   - `vi.mocked(db.paymentAttempt.create).mockClear()` to reset call history.
 *
 * ## Reset
 *
 * Call `resetMockDb()` in `beforeEach` to clear the internal Maps + reset
 * `vi.fn` call history. This ensures test isolation.
 */

interface MockRow {
  id: string;
  [key: string]: unknown;
}

interface MockDb {
  $transaction: ReturnType<typeof vi.fn>;
  paymentAttempt: {
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  paymentEvent: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  order: {
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  fileCleanupTask?: {
    findMany: ReturnType<typeof vi.fn>;
  };
  __internal: {
    attempts: Map<string, MockRow>;
    events: Map<string, MockRow>;
  };
}

/** The mutable state — Maps that persist across calls within a test. */
const state = {
  attempts: new Map<string, MockRow>(),
  events: new Map<string, MockRow>(),
};

/** Helper: match a Prisma-style `where` filter against a row. */
function matches(row: MockRow, filter: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      const op = v as Record<string, unknown>;
      if ('in' in op && Array.isArray(op.in)) return op.in.includes(row[k]);
      if ('lt' in op) return row[k] != null && new Date(row[k] as string) < new Date(op.lt as string);
      if ('gt' in op) return row[k] != null && new Date(row[k] as string) > new Date(op.gt as string);
      return false;
    }
    return row[k] === v;
  });
}

/** Helper: apply a patch to a row (shallow merge). */
function applyPatch(row: MockRow, patch: Record<string, unknown>): MockRow {
  return { ...row, ...patch, updatedAt: new Date() };
}

function buildMock(): MockDb {
  const mock: MockDb = {
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>, _opts?: any) => {
      // Pass-through: the mock doesn't have real transaction isolation, but
      // all operations see consistent state (shared Maps + InMemory adapter).
      return fn(mock);
    }),
    paymentAttempt: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // Phase 6.3 — enforce the UNIQUE constraint on `merchantOrderId`
        // (mirrors the real PostgreSQL `@unique` on PaymentAttempt.merchantOrderId).
        // The checkout route's idempotency path relies on this P2002 to detect
        // concurrent INSERTs that slipped past the findFirst check.
        const merchantOrderId = data.merchantOrderId as string | undefined;
        if (merchantOrderId) {
          for (const row of state.attempts.values()) {
            if (row.merchantOrderId === merchantOrderId) {
              const err = new Error(
                `Unique constraint failed: PaymentAttempt(merchantOrderId)=(${merchantOrderId})`,
              );
              (err as { code?: string }).code = 'P2002';
              throw err;
            }
          }
        }
        const id = (data.id as string) ?? crypto.randomUUID();
        const row = { ...data, id } as MockRow;
        state.attempts.set(id, row);
        return row;
      }),
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // Try by id first, then by other unique fields (merchantOrderId).
        if (where.id) return state.attempts.get(where.id as string) ?? null;
        for (const row of state.attempts.values()) {
          if (matches(row, where)) return row;
        }
        return null;
      }),
      findMany: vi.fn(async ({ where, orderBy, take }: { where?: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'>; take?: number }) => {
        let rows = [...state.attempts.values()];
        if (where) rows = rows.filter((r) => matches(r, where));
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0] ?? [null, 'asc'];
          if (field) {
            rows.sort((a, b) => {
              const av = a[field] as unknown;
              const bv = b[field] as unknown;
              if (av instanceof Date && bv instanceof Date) {
                return dir === 'asc' ? av.getTime() - bv.getTime() : bv.getTime() - av.getTime();
              }
              return dir === 'asc'
                ? String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0
                : String(bv) < String(av) ? -1 : String(bv) > String(av) ? 1 : 0;
            });
          }
        }
        if (typeof take === 'number' && take > 0) rows = rows.slice(0, take);
        return rows;
      }),
      findFirst: vi.fn(async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: Record<string, 'asc' | 'desc'> }) => {
        // Phase 6.3 — first-row selector mirroring Prisma's findFirst API.
        // The checkout route uses this to look up an existing active attempt
        // before creating a new one (idempotency check).
        let rows = [...state.attempts.values()];
        if (where) rows = rows.filter((r) => matches(r, where));
        if (orderBy) {
          const [field, dir] = Object.entries(orderBy)[0] ?? [null, 'asc'];
          if (field) {
            rows.sort((a, b) => {
              const av = a[field] as unknown;
              const bv = b[field] as unknown;
              if (av instanceof Date && bv instanceof Date) {
                return dir === 'asc' ? av.getTime() - bv.getTime() : bv.getTime() - av.getTime();
              }
              return dir === 'asc'
                ? String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0
                : String(bv) < String(av) ? -1 : String(bv) > String(av) ? 1 : 0;
            });
          }
        }
        return rows[0] ?? null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const [id, row] of state.attempts) {
          if (matches(row, where)) {
            state.attempts.set(id, applyPatch(row, data));
            count++;
          }
        }
        return { count };
      }),
      update: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        for (const [id, row] of state.attempts) {
          if (matches(row, where)) {
            const updated = applyPatch(row, data);
            state.attempts.set(id, updated);
            return updated;
          }
        }
        return null;
      }),
    },
    paymentEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // Enforce the UNIQUE([provider, eventId]) constraint — mirrors the
        // real PostgreSQL partial unique index on PaymentEvent. The lifecycle
        // service relies on this 23505 error to trigger its dedup path.
        const provider = data.provider as string | undefined;
        const eventId = data.eventId as string | undefined;
        if (provider && eventId) {
          for (const row of state.events.values()) {
            if (row.provider === provider && row.eventId === eventId) {
              const err = new Error(
                `Unique constraint failed: PaymentEvent(provider, eventId)=(${provider}, ${eventId})`,
              );
              (err as { code?: string }).code = '23505';
              throw err;
            }
          }
        }
        const id = (data.id as string) ?? crypto.randomUUID();
        const row = { ...data, id, receivedAt: data.receivedAt ?? new Date() } as MockRow;
        state.events.set(id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.events.get(where.id);
        if (!row) return null;
        const updated = applyPatch(row, data);
        state.events.set(where.id, updated);
        return updated;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        let count = 0;
        for (const [id, row] of state.events) {
          if (matches(row, where)) {
            state.events.set(id, applyPatch(row, data));
            count++;
          }
        }
        return { count };
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        for (const row of state.events.values()) {
          if (matches(row, where)) return row;
        }
        return null;
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return state.events.get(where.id) ?? null;
      }),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const results: MockRow[] = [];
        for (const row of state.events.values()) {
          if (!where || matches(row, where)) results.push(row);
        }
        return results;
      }),
    },
    order: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        // Dynamic import to avoid circular dependency (see file header).
        const { getContainer } = await import('@/lib/container');
        return getContainer().db.findOne('order', where) as Promise<MockRow | null>;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const { getContainer } = await import('@/lib/container');
        const updated = await getContainer().db.update('order', where, data);
        return { count: updated.length };
      }),
    },
    __internal: state,
  };
  return mock;
}

/** The singleton mock instance (shared across all calls within a test file). */
let mockInstance: MockDb | null = null;

/** Get or create the mock db instance. */
export function getMockDb(): MockDb {
  if (!mockInstance) mockInstance = buildMock();
  return mockInstance;
}

/** Reset the mock's internal state + vi.fn call history. Call in beforeEach. */
export function resetMockDb(): void {
  state.attempts.clear();
  state.events.clear();
  if (mockInstance) {
    // Reset all vi.fn mocks (clear call history + reset implementations to defaults)
    mockInstance.paymentAttempt.create.mockClear();
    mockInstance.paymentAttempt.findUnique.mockClear();
    mockInstance.paymentAttempt.findMany.mockClear();
    mockInstance.paymentAttempt.findFirst.mockClear();
    mockInstance.paymentAttempt.updateMany.mockClear();
    mockInstance.paymentAttempt.update.mockClear();
    mockInstance.paymentEvent.create.mockClear();
    mockInstance.paymentEvent.update.mockClear();
    mockInstance.paymentEvent.updateMany.mockClear();
    mockInstance.paymentEvent.findFirst.mockClear();
    mockInstance.paymentEvent.findUnique.mockClear();
    mockInstance.paymentEvent.findMany.mockClear();
    mockInstance.order.findUnique.mockClear();
    mockInstance.order.updateMany.mockClear();
    mockInstance.$transaction.mockClear();
  }
}

/**
 * Seed a PaymentAttempt into the mock's internal Map.
 *
 * The lifecycle service calls `tx.paymentAttempt.findUnique({ where: { merchantOrderId } })`
 * inside the transaction. For the webhook tests, the PaymentAttempt must exist
 * in the mock's Map so the lifecycle service can find it + transition it.
 *
 * In production, the checkout route creates the PaymentAttempt before the
 * provider is contacted. In tests, call this helper to simulate that.
 */
export function seedPaymentAttempt(data: {
  id?: string;
  shopId: string;
  orderId: string;
  provider: string;
  merchantOrderId: string;
  amountPaise: number;
  currency?: string;
  status?: string;
  expiresAt?: Date;
}): void {
  const id = data.id ?? crypto.randomUUID();
  state.attempts.set(id, {
    id,
    shopId: data.shopId,
    orderId: data.orderId,
    provider: data.provider,
    merchantOrderId: data.merchantOrderId,
    providerTransactionId: null,
    amountPaise: data.amountPaise,
    currency: data.currency ?? 'INR',
    status: data.status ?? 'created',
    idempotencyKey: null,
    expiresAt: data.expiresAt ?? new Date(Date.now() + 600_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

