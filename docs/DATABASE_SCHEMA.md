# PrintShop — Canonical Database Schema

> The authoritative data model for the PrintShop platform. Both the web
> SaaS and the PrintEXE Windows desktop client operate against this
> schema. The web app owns the database; the desktop syncs with it.

**Status:** v1.0 — 2025-11-07. Derived from `prisma/schema.prisma` (236 lines)
+ `prisma/pg-constraints.sql`. Verified against actual route usage.

---

## 1. Database

- **Engine:** PostgreSQL (via Supabase pooler on port 6543)
- **ORM:** Prisma 6.11 (`@prisma/client` + `@prisma/adapter-pg`)
- **Client:** `src/lib/db.ts` — singleton Prisma client (dev: `globalThis.prisma`)
- **Migrations:** `prisma db push` for dev; `prisma migrate dev` for production
- **Connection string:** `DATABASE_URL` env var (SSL required, `pgbouncer=true`)

---

## 2. Models (10 total)

### 2.1 Shop (the tenant root)

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | `String` | `uuid()` | PK |
| `name` | `String` | — | Display name |
| `slug` | `String` | `@unique` | URL slug, globally unique |
| `ownerUserId` | `String` | — | Denormalized (relation lives on User) |
| `upiId` | `String` | — | UPI VPA for payments |
| `paymentProvider` | `String` | — | `'googlepay'|'phonepe'|'paytm'|'razorpay'|'cashfree'` |
| `paymentCredentials` | `String` | — | AES-256-GCM encrypted JSON |
| `pricingConfig` | `String` | — | JSON `ShopPricingConfig` |
| `address`, `phone` | `String` | — | Contact info |
| `timezone` | `String` | `"Asia/Kolkata"` | IANA timezone |
| `isActive` | `Boolean` | `true` | Visible in public directory |
| `subscriptionTier` | `String` | `"free"` | `'free'|'starter'|'pro'|'enterprise'` |
| `subscriptionExpiresAt` | `DateTime?` | — | Tier expiry |
| `description`, `businessHours`, `logoUrl` | `String?` | — | Profile |
| `upiQrStorageKey` | `String?` | — | QR image storage key |
| `servicesJson` | `String?` | — | JSON service list |
| `paymentMethods` | `String` | `"both"` | `'upi'|'cash'|'both'|'split'` |
| `pamphletEnabled` | `Boolean` | `false` | Cover sheet option |
| `pamphletPricePaise` | `Int` | `0` | Cover sheet price |
| `pamphletName` | `String?` | — | Cover sheet label |
| `createdAt` | `DateTime` | `now()` | ✓ |
| `updatedAt` | `DateTime` | `@updatedAt` | ✓ |

**Relations:** `auditLogs`, `orders`, `agents`, `printJobs`, `subscription`, `users`, `paymentAttempts`
**Indexes:** `@@index([slug])`

### 2.2 User

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | `String` | `uuid()` | PK |
| `email` | `String` | `@unique` | Login email |
| `phone` | `String` | — | |
| `passwordHash` | `String` | — | PBKDF2-SHA256, 600k iterations |
| `role` | `String` | `"owner"` | `'owner'|'staff'|'admin'` |
| `shopId` | `String?` | — | FK → Shop (null for admin) |
| `createdAt`, `updatedAt` | `DateTime` | ✓ | |

**Indexes:** `@@index([shopId])`

### 2.3 Order

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | `String` | `uuid()` | PK |
| `shopId` | `String` | — | Tenant FK |
| `customerToken` | `String` | — | 6-char customer credential |
| `status` | `String` | `"awaiting_payment"` | See status machine below |
| `totalAmountPaise` | `Int` | — | Integer paise |
| `currency` | `String` | `"INR"` | |
| `paymentProvider` | `String?` | — | |
| `paymentTxnId` | `String?` | `@unique` | Webhook replay guard |
| `paymentUtr` | `String?` | — | UTR/RRN |
| `paidAt` | `DateTime?` | — | |
| `customerPhone` | `String?` | — | |
| `notes` | `String?` | — | Private shopkeeper notes |
| `tokenNumber` | `String?` | — | Per-shop sequential (e.g. "A104") |
| `createdAt`, `updatedAt` | `DateTime` | ✓ | |

**Unique:** `@@unique([shopId, tokenNumber])` (partial — via `pg-constraints.sql`)
**Indexes:** `@@index([shopId, status])`, `@@index([customerToken])`

**Order status machine:**
```
awaiting_payment → paid → printing → ready → collected
                                    ↓
                              needs_review (stale job)
                                    ↓
                              cancelled / refunded
```

### 2.4 PrintFile

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | `String` | `uuid()` | PK |
| `orderId` | `String` | — | FK → Order |
| `originalFilename` | `String` | — | |
| `storageKey` | `String` | — | Opaque object key (never a URL) |
| `mimeType` | `String` | — | |
| `sizeBytes` | `Int` | — | |
| `pageCount` | `Int?` | — | null = needs review |
| `copies` | `Int` | `1` | |
| `colorMode` | `String` | `"bw"` | `'bw'|'color'` |
| `pageRange` | `String?` | — | e.g. "1-5,8" |
| `paperSize` | `String` | `"a4"` | `'a4'|'a3'|'letter'|'legal'` |
| `duplex` | `Boolean` | `false` | |
| `pricePaise` | `Int` | `0` | Per-file price |
| `status` | `String` | `"pending"` | `'pending'|'queued'|'printing'|'completed'|'failed'|'needs_review'` |
| `printedAt` | `DateTime?` | — | |
| `createdAt`, `updatedAt` | `DateTime` | ✓ | |

**Tenant isolation:** inherits via `order.shopId`

### 2.5 PrintJob

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | `String` | `uuid()` | PK |
| `shopId` | `String` | — | Tenant FK |
| `fileId` | `String` | — | FK → PrintFile |
| `agentId` | `String?` | — | FK → PrintAgent (null until claimed) |
| `status` | `String` | `"queued"` | `'queued'|'assigned'|'printing'|'completed'|'failed'|'needs_review'` |
| `attempts` | `Int` | `0` | |
| `lastError` | `String?` | — | |
| `queuedAt` | `DateTime` | `now()` | |
| `startedAt`, `completedAt` | `DateTime?` | — | |
| `createdAt`, `updatedAt` | `DateTime` | ✓ | |

**Partial unique index (via `pg-constraints.sql`):**
```sql
CREATE UNIQUE INDEX "PrintJob_active_file_unique"
  ON "PrintJob" ("fileId")
  WHERE status IN ('queued', 'printing');
```
→ At most one ACTIVE print job per file (race-safe idempotency).

**Indexes:** `@@index([shopId, status])`, `@@index([agentId])`

### 2.6 PrintAgent

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | `String` | `uuid()` | PK |
| `shopId` | `String` | — | Tenant FK |
| `name` | `String` | — | Human label |
| `tokenHash` | `String` | — | HMAC-SHA256('print-agent-salt', token) |
| `lastSeenAt` | `DateTime?` | — | |
| `printerName` | `String?` | — | |
| `isOnline` | `Boolean` | `false` | |
| `version` | `String?` | — | Agent semver |
| `os` | `String?` | — | `process.platform` |
| `createdAt`, `updatedAt` | `DateTime` | ✓ | |

**Indexes:** `@@index([shopId, isOnline])`

### 2.7 Subscription (⚠️ vestigial — schema exists, code doesn't use it)

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | `String` | `uuid()` | PK |
| `shopId` | `String` | `@unique` | 1:1 with Shop |
| `tier` | `String` | `"free"` | |
| `status` | `String` | `"active"` | |
| `currentPeriodStart` | `DateTime` | — | |
| `currentPeriodEnd` | `DateTime` | — | |
| `provider` | `String` | `"internal"` | `'internal'|'razorpay'|'manual'` |
| `providerSubscriptionId` | `String?` | — | |
| `createdAt`, `updatedAt` | `DateTime` | ✓ | |

**⚠️ ZERO code references.** Tier is read from `Shop.subscriptionTier` instead. This model should either be wired into the subscription lifecycle or removed.

### 2.8 AuditLog

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | `String` | `uuid()` | PK |
| `shopId` | `String?` | — | Null for platform events |
| `userId` | `String?` | — | |
| `action` | `String` | — | e.g. `auth.login`, `order.create`, `webhook.phonepe.paid` |
| `entityType` | `String` | — | |
| `entityId` | `String` | — | |
| `metadata` | `String` | — | JSON |
| `ip` | `String?` | — | |
| `createdAt` | `DateTime` | `now()` | ✓ (no `updatedAt` — append-only) |

**Indexes:** `@@index([shopId, createdAt])`

### 2.9 PaymentAttempt (⚠️ vestigial — schema exists, not yet wired)

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | `String` | `uuid()` | PK |
| `shopId` | `String` | — | Tenant FK |
| `orderId` | `String` | — | |
| `provider` | `String` | — | |
| `merchantOrderId` | `String` | `@unique` | PSP reference |
| `providerTransactionId` | `String?` | — | |
| `amountPaise` | `Int` | — | |
| `currency` | `String` | `"INR"` | |
| `status` | `String` | `"created"` | `'created'|'pending'|'paid'|'failed'|'expired'` |
| `idempotencyKey` | `String?` | — | |
| `expiresAt` | `DateTime` | — | |
| `createdAt`, `updatedAt` | `DateTime` | ✓ | |

**⚠️ Schema exists but webhook pipeline still uses cache-only session lookup** (10-min TTL). TODO at `phonepe-v2-webhook.ts:215` confirms. This model should replace the cache lookup.

### 2.10 PaymentEvent (⚠️ vestigial — append-only event log)

| Field | Type | Default | Notes |
|---|---|---|---|
| `id` | `String` | `uuid()` | PK |
| `attemptId` | `String` | — | FK → PaymentAttempt |
| `provider` | `String` | — | |
| `eventId` | `String?` | — | PSP event ID (dedup) |
| `merchantOrderId` | `String?` | — | |
| `providerTransactionId` | `String?` | — | |
| `eventType` | `String` | — | `'webhook'|'status_check'|'reconciliation'` |
| `signatureValid` | `Boolean` | `false` | |
| `processingStatus` | `String` | `"received"` | `'received'|'processed'|'skipped'|'failed'` |
| `receivedAt` | `DateTime` | `now()` | ✓ (no `updatedAt`) |
| `processedAt` | `DateTime?` | — | |
| `errorMessage` | `String?` | — | |

**Unique:** `@@unique([provider, eventId])` — webhook dedup

---

## 3. Missing models (for unified platform)

The following models do NOT exist yet but are needed for the full platform vision:

| Model | Purpose | Phase |
|---|---|---|
| `Customer` | Customer directory (name, phone, email, history) | Phase 2 |
| `Product` | Product/service catalog | Phase 2 |
| `Quotation` | Pre-order quotes | Phase 2 |
| `Invoice` | Post-order invoices | Phase 2 |
| `InvoiceItem` | Invoice line items | Phase 2 |
| `Expense` | Business expenses | Phase 2 |
| `InventoryItem` | Stock tracking | Phase 2 |
| `Supplier` | Supplier directory | Phase 2 |
| `Employee` | Staff management | Phase 2 |
| `Attachment` | File attachments (beyond print files) | Phase 2 |
| `DeviceSyncState` | Per-device sync cursor | Phase 5 |
| `SyncEvent` | Change log for incremental sync | Phase 5 |

**Current state:** the schema covers the core print-order flow (Shop → Order → PrintFile → PrintJob → PrintAgent) but NOT the broader business modules (customers, invoices, expenses, inventory). These are Phase 2 work.

---

## 4. Constraints and indexes

### 4.1 From `prisma/schema.prisma`
- `Shop.slug` `@unique`
- `User.email` `@unique`
- `Order.paymentTxnId` `@unique`
- `Subscription.shopId` `@unique` (1:1)
- `PaymentAttempt.merchantOrderId` `@unique`
- `PaymentEvent` `@@unique([provider, eventId])`

### 4.2 From `prisma/pg-constraints.sql` (raw SQL, not in Prisma schema)
- `PrintJob_active_file_unique` — partial unique on `(fileId) WHERE status IN ('queued', 'printing')`
- `Order_shop_token_unique` — partial unique on `(shopId, tokenNumber) WHERE tokenNumber IS NOT NULL`

---

## 5. Money handling

- **All amounts in integer paise** (1 INR = 100 paise) in `Int` columns
- **No floating-point money** anywhere in `packages/core`
- **Pricing engine** (`packages/core/src/pricing/`): pure functions, paise in → paise out, half-up rounding
- **Display:** `formatINRFromPaise(paise)` from `@platform/utils`
- The desktop client must use the same formatter (or an equivalent that produces identical output)

---

## 6. Tenant isolation rules

1. Every per-shop model has `shopId`
2. The repository layer (`src/lib/repositories/*`) is the ONLY place that touches the DB
3. Every query injects `shopId` from the JWT principal or device token
4. No raw SQL in route handlers
5. The desktop's device token resolves to `PrintAgent.shopId` → same isolation

---

## 7. Migration strategy

- **Dev:** `bun run db:push` (Prisma db push — syncs schema to DB)
- **Production:** `prisma migrate dev` (versioned migrations)
- **One-time setup:** `POST /api/v1/setup-database` runs raw SQL to create tables + partial indexes
- **⚠️ NEVER:** `prisma db push --accept-data-loss` on a populated production DB
- **Additive changes:** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` is safe
- **Breaking changes:** require a migration with data backfill

---

## 8. Entity relationship diagram

```
Shop (tenant root)
 ├─ User (owner/staff, shopId FK)
 ├─ Order (shopId FK)
 │   ├─ PrintFile (orderId FK)
 │   │   └─ PrintJob (fileId FK, shopId FK)
 │   │       └─ PrintAgent (agentId FK, shopId FK)
 │   └─ PaymentAttempt (orderId FK, shopId FK)
 │       └─ PaymentEvent (attemptId FK)
 ├─ PrintAgent (shopId FK)
 ├─ Subscription (shopId FK, 1:1)
 └─ AuditLog (shopId FK, nullable)

Admin User (shopId = null) — platform-wide
```
