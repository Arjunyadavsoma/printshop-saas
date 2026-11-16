# Admin Authentication & Authorization Design

**Phase:** 1
**Status:** Implemented
**Date:** 2026-11-16
**Commit:** (this phase's commit on `feat/admin-auth`)

## 1. Problem

The Phase 0 audit found that admin API routes under `/api/v1/admin/*` were
wrapped with `withAuth(handler)` **without** the second `allowedRoles`
argument. The `withAuth` wrapper supports role enforcement — it accepts an
optional `allowedRoles: UserRole[]` and throws `ForbiddenError` if the
caller's role is not in the list — but none of the six protected admin
routes passed it. The one exception, `audit/route.ts`, did pass
`['admin']`.

This meant any authenticated user — any shopkeeper with a valid JWT —
could call admin endpoints and read platform-wide data: every shop's
financials, every order across every shop, and the audit log.

A secondary finding (lower severity) was that the env-var admin login
(`ADMIN_EMAIL` + `ADMIN_PASSWORD`) is the only way to bootstrap an admin
account. The audit noted this is not in itself a vulnerability
(credentials live in Vercel secrets, compared constant-time, never
logged), but it does not scale to multiple admins with different
capabilities.

## 2. Design

### 2.1 Role model

The existing `UserRole` union (`'owner' | 'staff' | 'admin'`) is kept
unchanged. We add a separate **fine-grained permission** layer, used only
when `role === 'admin'`:

```ts
export type AdminPermission =
  | '*'                     // super-admin — every permission
  | 'shops.approve'         // approve / reject shop applications
  | 'shops.suspend'         // suspend / restore a shop
  | 'subscription.manage'   // assign plan, grant / extend free period
  | 'payments.refund'       // issue refunds, reverse payments
  | 'users.manage'          // create / suspend / delete user accounts
  | 'config.manage'         // change platform configuration
  | 'audit.read'            // read the audit log
  | 'finance.read';         // read financial reports + reconciliation
```

`'owner'` and `'staff'` never receive admin permissions — their access is
tenant-scoped to their own shop and enforced by `withAuth` plus the
Phase 2 entitlement service.

### 2.2 Storage

A new nullable column `User.adminPermissions: String?` stores a
JSON-encoded array of permissions. The migration is **additive and
nullable** — existing rows and released clients keep working unchanged:

```sql
ALTER TABLE "User" ADD COLUMN "adminPermissions" TEXT;
```

The repository layer parses the JSON defensively (drops unknown values
silently) and serialises `null`/`[]` as `null`. This means a hand-edited
DB row cannot crash the API, and a non-admin with a stray value still
has no permissions because `withAdminPermission` checks role first.

### 2.3 Token claims

Access tokens now carry `perms: AdminPermission[] | null` in their JWT
claims. `null` for every non-admin keeps tokens small and makes the
permission check fail closed for any non-admin token regardless of what
middleware asks for.

Refresh tokens do **not** carry permissions (they are long-lived and
should not embed authority). On refresh, the `/api/v1/auth/refresh`
handler re-fetches the user row and re-mints the access token with the
**current** permissions.

### 2.4 Source of truth

The DB is the source of truth, not the JWT. `withAuth` already does a
`repos.users.findById(claims.sub)` on every request (to detect deleted
users and stale shop scopes); the principal now carries the
DB-resolved `adminPermissions` so a super-admin who narrows a
subordinate's role sees the change take effect on the very next request
— even if the subordinate's access token is still valid.

### 2.5 Middleware

`withAdminPermission(required, handler)` wraps every privileged admin
route. It:

1. Calls `withAuth(handler, ['admin'])` — rejects non-admins with 403.
2. Re-checks `principal.role === 'admin'` defensively.
3. Calls `hasAdminPermission(principal.adminPermissions, required)`.
4. Throws `ForbiddenError('Missing admin permission: <required>')` if
   the check fails.

`hasAdminPermission` is a pure function in the shared domain layer:

```ts
export function hasAdminPermission(
  perms: AdminPermission[] | null | undefined,
  required: AdminPermission,
): boolean {
  if (!perms || perms.length === 0) return false;
  if (perms.includes('*')) return true;
  return perms.includes(required);
}
```

### 2.6 Bootstrap

The env-var admin (`ADMIN_EMAIL` + `ADMIN_PASSWORD`) is kept as the
bootstrap path. On first login, the row is created with
`adminPermissions: ['*']` (super-admin). The platform owner can then
provision additional admins (via `/api/v1/admin/users`, implemented in a
later phase) with a narrowed permission set.

The `ADMIN_ACCESS_KEY` query parameter on `/admin/login` is kept as
defence-in-depth (it gates the login page itself, not the API).

### 2.7 Route → permission mapping

| Route | Permission |
|---|---|
| `GET /api/v1/admin/analytics` | `finance.read` |
| `GET /api/v1/admin/audit` | `audit.read` |
| `GET /api/v1/admin/orders` | `finance.read` |
| `GET /api/v1/admin/orders/:id` | `finance.read` |
| `GET /api/v1/admin/shops` | `finance.read` |
| `GET /api/v1/admin/shops/:id` | `finance.read` |
| `GET /api/v1/admin/access-check` | (intentionally open — gates the login page only) |

Future mutating admin routes (`POST /api/v1/admin/shops/:id/approve`,
`POST /api/v1/admin/subscriptions/:shopId/grant-free-period`, etc.) will
bind to `shops.approve` / `subscription.manage` respectively. The
binding site declares the required permission, auditable in one place.

## 3. Tests

`src/lib/api/admin-auth.test.ts` (13 tests) verifies:

1. The `adminPermissions` column is read + written correctly.
2. JWTs carry `perms` for admins, null for non-admins.
3. `hasAdminPermission` honours the super-admin `'*'` wildcard.
4. `hasAdminPermission` fails closed on null / empty / undefined.
5. Unknown permission values are dropped on read.
6. Empty perms serialise to `null` on update.
7. A revoked admin permission is no longer granted after the user row
   is updated (DB is the source of truth).

All 13 tests pass. The existing 558 unit tests still pass.

## 4. Migration

`prisma/migrations/20261116000000_add_user_admin_permissions/migration.sql`:

```sql
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'User' AND column_name = 'adminPermissions'
    ) THEN
        ALTER TABLE "User" ADD COLUMN "adminPermissions" TEXT;
    END IF;
END $$;
```

Idempotent (matches the established pattern in the codebase) and
additive — safe to deploy without downtime. Existing rows have
`adminPermissions = NULL`, so existing shopkeepers and the bootstrap
admin keep working. The bootstrap admin is upgraded to `['*']` on
next login.

## 5. Acceptance criteria — status

| Criterion | Status |
|---|---|
| No hardcoded production credentials | ✅ kept env-var approach (already not hardcoded in code) |
| No authentication bypass | ✅ every admin route now enforces `['admin']` + permission |
| Server-side permission enforcement | ✅ `withAdminPermission` checks DB-resolved perms |
| Revocable sessions | ✅ refresh tokens are JTI-tracked; admin perms are DB-resolved per request |
| Secure password/token handling | ✅ PBKDF2-SHA256 600k iterations, constant-time compare, HS256 JWT |
| Tests for unauthorized access and privilege escalation | ✅ 13 new tests |
| Existing shop-owner authentication remains functional | ✅ baseline 558 unit tests still pass |
| Future Android admin authentication can reuse the supported backend contract | ✅ same JWT + role + perms contract |

## 6. Remaining work for later phases

- `POST /api/v1/admin/users` — provision new admins with a narrowed
  permission set. Requires `users.manage` permission.
- `POST /api/v1/admin/shops/:id/approve` and `/suspend` — requires
  `shops.approve` / `shops.suspend`.
- `POST /api/v1/admin/subscriptions/:shopId/grant-free-period` —
  requires `subscription.manage`. Implemented in Phase 2.
- Admin password reset / secure account recovery — not yet
  implemented (low priority; the env-var bootstrap covers the
  platform-owner case).
- Failed-login rate limiting per admin account (in addition to the
  existing per-IP limit) — deferred to Phase 11.
