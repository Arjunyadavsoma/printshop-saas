# PrintShop — Release Compatibility Policy

> How the PrintShop platform versions its API, database, and desktop
> client to ensure old desktop clients don't silently corrupt data when
> the backend evolves.

**Status:** v1.0 — 2025-11-07.

---

## 1. Versioning model

PrintShop uses **three independent version tracks**:

| Track | Format | Current | Location |
|---|---|---|---|
| API | URL-prefixed (`/api/v1/`) | v1 | `src/app/api/v1/` |
| Database schema | Prisma migration version | (see `prisma/migrations/`) | `prisma/schema.prisma` |
| Desktop (PrintEXE) | SemVer (`MAJOR.MINOR.PATCH`) | 1.0.0 (target) | `PrintEXE/Directory.Build.props` |

---

## 2. API versioning

### 2.1 Rules

1. **Breaking changes require a new URL prefix** (`/api/v2/`).
2. **The current v1 API is frozen** — no breaking changes to request/response shapes.
3. **Additive changes are allowed in v1** (new fields, new endpoints, new optional params).
4. **Deprecation**: old fields/endpoints are marked deprecated in the API contract doc + response headers (`Deprecation: true`, `Sunset: <date>`), then removed in the next major version.

### 2.2 Breaking changes (require v2)

- Removing a field from a response
- Changing a field's type
- Changing a field's semantics
- Changing auth requirements
- Changing error codes
- Removing an endpoint

### 2.3 Non-breaking changes (allowed in v1)

- Adding a new field to a response
- Adding a new optional request param
- Adding a new endpoint
- Adding a new error code
- Changing internal implementation (no API surface change)

### 2.4 Version negotiation

The desktop client sends its version in every request:
```
X-PrintShop-Companion-Version: 1.2.0
```

The server logs this + can respond with:
- `200 OK` (normal)
- `200 OK` + `X-PrintShop-API-Warning: deprecated-field` (soft warning)
- `426 Upgrade Required` + `{"error":{"message":"Desktop version 1.0.0 is no longer supported. Minimum required: 1.2.0.","code":"VERSION_UNSUPPORTED","minVersion":"1.2.0","downloadUrl":"https://..."}}` (hard block)

---

## 3. Database schema versioning

### 3.1 Prisma migrations

- **Dev:** `prisma db push` (schema sync, no migration files)
- **Production:** `prisma migrate dev` (creates versioned migration files in `prisma/migrations/`)
- **Each migration is a file:** `prisma/migrations/{timestamp}_{name}/migration.sql`

### 3.2 Migration rules

1. **Additive changes are safe** (new tables, new columns with defaults, new indexes)
2. **Destructive changes require a multi-step migration:**
   - Step 1: add new column, start writing to both old + new
   - Step 2: backfill new column from old
   - Step 3: switch reads to new column
   - Step 4: remove old column (after a grace period)
3. **Never run `prisma db push --accept-data-loss` on production** (the `package.json` script exists for dev only)

### 3.3 Schema version in API response

The `/api/v1/health` endpoint includes:
```json
{ "data": { "status": "ok", "schemaVersion": "20251107", "apiVersion": "v1" } }
```

The desktop can check this + refuse to sync if the schema version is ahead of what it supports.

---

## 4. Desktop versioning

### 4.1 SemVer rules

- **MAJOR:** breaking API changes (desktop requires new backend)
- **MINOR:** new features (desktop works with old backend, but some features unavailable)
- **PATCH:** bug fixes (fully compatible)

### 4.2 Minimum supported version

The server enforces a minimum desktop version:
```typescript
const MIN_DESKTOP_VERSION = '1.0.0';  // bumped when old versions are blocked
```

When a desktop client connects:
1. Parse `X-PrintShop-Companion-Version` header
2. If version < MIN_DESKTOP_VERSION → return `426 Upgrade Required`
3. Log the version for telemetry

### 4.3 Auto-update (future)

- PrintEXE checks for updates on startup: `GET /api/v1/downloads/companion/latest`
- Response includes `{ version, downloadUrl, checksum, releaseNotes }`
- PrintEXE prompts the user to update
- **Auto-update is NOT silent** — the user must approve

---

## 5. Compatibility matrix

| Desktop version | API v1 | API v2 (future) | Schema 20251107 | Notes |
|---|---|---|---|---|
| 1.0.0 | ✅ | ❌ | ✅ | Initial release (after protocol adaptation) |
| 1.1.x | ✅ | ❌ | ✅ | Additive features (e.g., customer directory) |
| 1.2.x | ✅ | ❌ | ✅ | Invoice support |
| 2.0.0 | ⚠️ Deprecated | ✅ | ✅ | Requires API v2 (breaking changes) |

---

## 6. Upgrade + rollback strategy

### 6.1 Backend upgrade

1. Deploy new backend version to Vercel (auto on `git push origin main`)
2. Run any new Prisma migrations: `prisma migrate deploy`
3. Verify health: `GET /api/v1/ready`
4. Monitor logs for errors

**Rollback:** `git revert` + push. Vercel redeploys the previous version. If a migration was destructive, restore DB from backup.

### 6.2 Desktop upgrade

1. Build new MSI on Windows
2. Sign with code signing certificate
3. Publish to download URL
4. Bump `MIN_DESKTOP_VERSION` on the server (if needed)
5. Desktop clients see the update prompt on next launch

**Rollback:** uninstall new version + install old MSI. The old version continues to work with the backend (as long as it's >= MIN_DESKTOP_VERSION).

### 6.3 Database migration rollback

```bash
# Restore from pre-migration backup
psql "$DATABASE_URL" < backup-YYYYMMDD.sql
```

Only for destructive migrations. Additive migrations don't need rollback.

---

## 7. Deprecation policy

### 7.1 API field deprecation

1. **Announce:** add to `docs/API_CONTRACT.md` with `@deprecated` tag + sunset date
2. **Header:** server sends `Deprecation: true` + `Sunset: <RFC-1123-date>` on responses containing the deprecated field
3. **Grace period:** 90 days minimum
4. **Remove:** in the next API major version (v2)

### 7.2 Desktop feature deprecation

1. **Announce:** in release notes + in-app notification
2. **Grace period:** one minor version (e.g., deprecated in 1.1, removed in 1.2)
3. **Remove:** in the next desktop major version

---

## 8. Release process

### 8.1 Backend (SaaS)

1. Create a feature branch: `git checkout -b feature/{name}`
2. Develop + test locally (`bun run dev`, `bunx vitest run`, `npx tsc --noEmit`)
3. Push branch + create PR
4. CI runs: lint + tsc + vitest
5. Merge to `main`
6. Vercel auto-deploys to production
7. Verify: `GET /api/v1/ready` returns 200

### 8.2 Desktop (PrintEXE)

1. Develop on Windows machine
2. Test against local SaaS dev instance
3. Bump version in `Directory.Build.props`
4. Build MSI: `dotnet publish -c Release`
5. Sign the MSI
6. Upload to download URL
7. Update `docs/CHANGELOG.md`
8. Tag the release: `git tag v1.x.0`

### 8.3 Database

1. Test migration locally: `prisma migrate dev --name {name}`
2. Review the generated SQL
3. Apply to staging: `prisma migrate deploy`
4. Verify staging
5. Backup production DB
6. Apply to production: `prisma migrate deploy`
7. Verify: `GET /api/v1/health`

---

## 9. Breaking change communication

When a breaking change is unavoidable:

1. **Announce 90 days in advance** in:
   - `docs/API_CONTRACT.md` (deprecation notice)
   - GitHub release notes
   - In-app notification (desktop + web)
2. **Provide a migration guide** in `docs/MIGRATION_PLAN.md`
3. **Maintain backward compatibility** during the grace period (both old + new API shapes work)
4. **Enforce the breaking change** after the grace period:
   - Backend: return `410 Gone` for deprecated endpoints
   - Desktop: show "Update required" + block operation

---

## 10. Current version state

| Component | Version | Status |
|---|---|---|
| API | v1 | Stable (60 routes) |
| Schema | 20251107 (additive) | Sync models added, not yet pushed to DB |
| Web app | 0.2.1 (`package.json`) | Production-ready |
| PrintEXE | 0.0.0 (pre-release) | Not compiled |
| Bun/TS print-agent | 0.1.0 | Working |
| Realtime service | (no version) | Working |

**The desktop minimum supported version will be 1.0.0** (after protocol adaptation + Windows compilation).
