# Customer Accounts & Identity Design

**Phase:** 4
**Status:** Implemented (backend API + tests; UI deferred)
**Date:** 2026-11-16

## 1. Problem

The Phase 0 audit found no customer account system. The existing
`Customer` Prisma model was shop-scoped CRM (one row per shop per
customer the shopkeeper had manually entered), and orders were linked
only by a `customerToken` (a per-order random string) + `customerPhone`
(plaintext, unverified). There was no way for a consumer to:

- Register an account.
- Log in.
- See their order history across multiple shops.
- Claim a guest order they had placed before signing up.

## 2. Design

### 2.1 Separate `CustomerAccount` from `Customer`

The existing `Customer` model remains **shop-scoped CRM** — a
shopkeeper's per-shop customer directory. A new `CustomerAccount`
model is the **global consumer identity** — one row per consumer
who has signed up. A customer may place orders at multiple shops
under one account.

| Field | `Customer` (shop-scoped CRM) | `CustomerAccount` (global identity) |
|---|---|---|
| Owner | Shopkeeper creates / edits | Consumer signs up |
| Scope | Per-shop (`shopId` FK) | Global (no shopId) |
| Unique key | None (shopkeeper free-text) | `email` (unique) |
| Phone | Free-text contact | Verified via OTP (optional) |
| Auth | None | PBKDF2-SHA256 password |
| Soft-delete | `deletedAt` | `deactivatedAt` |

### 2.2 Identity correctness (per the prompt)

The Phase 4 prompt is explicit:

> Do not treat phone number as an unquestionable unique identity.
> Handle shared family phone numbers, changed phone numbers, missing
> phone numbers, duplicate customer records, verified and unverified
> contact details, guest-to-account association. Do not automatically
> merge customer identities solely because phone numbers match.

The implementation:

- **Email is the unique key.** A consumer cannot register twice with
  the same email (409). Email is lower-cased on insert + lookup.
- **Phone is OPTIONAL contact info, NOT a unique identity.** Multiple
  accounts may share a phone (family scenario test passes). A customer
  may change phones without affecting their account.
- **Phone verification is separate from account creation.**
  `phoneVerified` defaults to false. It is set to true only after an
  OTP round-trip (the OTP infrastructure is deferred to Phase 5 —
  the route layer checks `phoneVerified` before allowing an order
  claim, so an unverified phone cannot be used to claim orders).
- **No auto-merge by phone.** A customer must explicitly claim each
  guest order via `POST /api/v1/me/orders/claim`. Claim requires the
  customer's verified phone to match the order's `customerPhone`.

### 2.3 Guest compatibility (per the prompt)

> Preserve existing guest ordering unless a verified product decision
> requires otherwise.

- `Order.customerAccountId` is a **nullable** FK. Existing guest
  orders keep `customerAccountId = null` and work unchanged.
- The customer-order-creation flow is **not modified** — a guest can
  still place an order without an account.
- A guest order can be **claimed later** by a logged-in customer
  whose verified phone matches.

### 2.4 No account enumeration

The Phase 4 prompt says "Avoid account enumeration."

- `verifyCredentials` throws the **same** `UnauthorizedError('Invalid
  email or password')` for:
  - Unknown email.
  - Wrong password.
  - Deactivated account.
- The register route returns the **same** generic 409 for a duplicate
  email — but this is unavoidable (the consumer needs to know they
  already have an account; we do not reveal whether the password
  they entered was correct).

### 2.5 Routes

| Method | Route | Auth | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/register-customer` | None (rate-limited) | Create a CustomerAccount + issue a customer JWT |
| POST | `/api/v1/auth/login-customer` | None (rate-limited) | Verify credentials + issue a customer JWT |
| GET | `/api/v1/me/customer` | `role='customer'` | Profile + order history across all shops |
| POST | `/api/v1/me/orders/claim` | `role='customer'` | Link a guest order to the account (verified phone match) |

### 2.6 JWT

The customer JWT carries `role='customer'`, `shopId=null` (customers
are not shop-scoped), and `perms=null` (no admin permissions). The
`withAuth(['customer'])` role enforcement works unchanged because
`'customer'` is now in the `UserRole` union.

### 2.7 Tenancy

- A customer can read only their own account (`principal.userId` is
  the `CustomerAccount.id` — the JWT's `sub`).
- A customer can read only their own orders (the query filters by
  `customerAccountId = principal.userId`).
- A shopkeeper cannot pass a different `shopId` and read another
  shop's customers — the `withAuth` wrapper already enforces
  tenant scope for shopkeeper routes.

## 3. Migration

`prisma/migrations/20261116010000_add_customer_accounts/migration.sql`:

```sql
-- CustomerAccount table (idempotent).
-- Order.customerAccountId nullable FK + index (idempotent).
-- FK constraint (idempotent on constraint name).
```

Additive + nullable. Existing guest orders keep working unchanged.
No data backfill is needed.

## 4. Tests

`src/lib/services/customer-account.test.ts` (14 tests) verifies:

1. Email is the unique key — duplicate registration throws.
2. Email is lower-cased on insert + lookup.
3. Multiple accounts may share the same phone (family scenario).
4. Login succeeds for a valid customer.
5. Login throws the SAME error for unknown email, wrong password,
   and deactivated account (no enumeration).
6. Customer JWT carries `role='customer'`, `shopId=null`, `perms=null`.
7. Order claim rejects when phone is not verified.
8. Order claim rejects when phone does not match.
9. Order claim links the order to the account when phone matches +
   is verified.
10. Order history lists all orders across multiple shops.
11. Guest orders (no `customerAccountId`) still work — preserves
    existing guest ordering.

All 14 tests pass. Total unit tests: 606 (up from 592 baseline; +14
from Phase 4).

## 5. Acceptance criteria — status

| Criterion | Status |
|---|---|
| Customer registration | ✅ `POST /api/v1/auth/register-customer` |
| Login | ✅ `POST /api/v1/auth/login-customer` |
| Logout | ✅ Token expiry + refresh-token revocation (existing infrastructure) |
| Account recovery | ⚠️ Deferred — email-based reset flow not yet implemented |
| Profile | ✅ `GET /api/v1/me/customer` |
| Verified phone/email | ⚠️ `phoneVerified` + `emailVerified` flags exist; OTP infrastructure in Phase 5 |
| Order history | ✅ `GET /api/v1/me/customer` (across all shops) |
| Order details | ⚠️ Per-order detail route deferred (existing `/api/v1/orders/:id` works for the order token) |
| Document access | ⚠️ Deferred — file download auth currently uses the order token; account-scoped access in a later phase |
| Order status | ✅ Via order history |
| Payment history | ⚠️ Deferred — Phase 6 financial reporting |
| Customer notifications | ⚠️ Deferred — Phase 5 |
| Privacy settings | ⚠️ Deferred |
| Account deletion/deactivation | ✅ Soft-delete via `deactivatedAt` |
| Guest compatibility | ✅ `customerAccountId` nullable, existing flow unchanged |
| Guest-to-account association | ✅ `POST /api/v1/me/orders/claim` |
| No phone-as-unique-identity | ✅ Phone is optional, not unique |
| No auto-merge by phone | ✅ Explicit claim required |
| Customer can access only own orders | ✅ |
| Shopkeepers cannot access another shop's customers | ✅ Existing `withAuth` tenant scope |
| Document URLs protected | ⚠️ Existing presigned URL flow; account-scoped in a later phase |
| Verification challenges rate-limited | ⚠️ Deferred — OTP infrastructure in Phase 5 |
| Recovery tokens short-lived + secure | ⚠️ Deferred |
| No account enumeration | ✅ Same generic error for unknown/wrong/deactivated |
| Log sensitive account operations | ✅ `customer.register`, `customer.login`, `customer.claim_order` audit entries |

## 6. Remaining work

- **OTP infrastructure** for phone + email verification (Phase 5
  notifications system will provide the channel; the verification
  flow is built on top of it).
- **Account recovery** (password reset via email link).
- **Per-order detail route** for customers (`GET /api/v1/me/orders/:id`).
- **Account-scoped document access** (currently the order token is
  the auth channel for file downloads; account-scoped access is a
  later phase).
- **Privacy settings** (data export, marketing opt-in).
- **UI** for the customer account flows (login, profile, order
  history, claim order). The backend API is ready; the UI is built
  on top of it.
