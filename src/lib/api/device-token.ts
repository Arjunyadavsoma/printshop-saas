import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Device-token hashing — Phase C of the verification pass.
 *
 * PREVIOUS BEHAVIOR (Phase 0 and earlier): every call site hashed device
 * tokens with the hard-coded literal pepper 'print-agent-salt'. That string
 * ships in source and docs, so it is not a secret; this module replaces it
 * with an environment-provided pepper and a versioned hash format that
 * keeps every already-paired device working.
 *
 * HASH FORMATS (stored in PrintAgent.tokenHash / prevTokenHash):
 *   v2:<hex>  — HMAC-SHA256(DEVICE_TOKEN_PEPPER, token). Written by all NEW
 *               credential issuance: /companion/pair, /companion/token/rotate,
 *               /agents/register.
 *   <bare hex> — legacy HMAC-SHA256('print-agent-salt', token). Existing
 *               paired devices keep working untouched; they migrate to v2
 *               ONLY through the authenticated rotation flow
 *               (POST /api/v1/companion/token/rotate). Legacy verification
 *               is removed only once no bare-hex hashes remain — check with:
 *               SELECT count(*) FROM "PrintAgent" WHERE "tokenHash" NOT LIKE 'v2:%';
 *
 * PEPPER SOURCE:
 *   DEVICE_TOKEN_PEPPER (>= 16 chars) — required in production, validated at
 *   container build (see container.ts). In development the legacy pepper is
 *   used so existing dev databases keep working without setup.
 *
 * The pepper never reaches the browser (server-side container only), never
 * enters logs, and is not stored in the PrintEXE repository (the client only
 * ever holds the raw token).
 */
const LEGACY_PEPPER = 'print-agent-salt';
const V2_PREFIX = 'v2:';

/** The current pepper; fails fast in production when unset/too short. */
function currentPepper(): string {
  const fromEnv = process.env.DEVICE_TOKEN_PEPPER;
  if (fromEnv && fromEnv.trim().length >= 16) return fromEnv.trim();
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DEVICE_TOKEN_PEPPER must be set to at least 16 characters in production. ' +
      'Generate one with: openssl rand -hex 32. ' +
      'Existing device hashes (legacy format) keep verifying until each device rotates its token.',
    );
  }
  // Development / test fallback: identical to the pre-Phase-C behavior, so
  // existing dev databases and seeded agents keep authenticating.
  return LEGACY_PEPPER;
}

/**
 * Validate at startup. Called when the DI container is built so a
 * production deploy with missing configuration fails at boot, not on the
 * first device request.
 */
export function assertDeviceTokenPepperConfigured(): void {
  currentPepper();
}

/** Current-format hash (v2) of a raw device token. */
export function hashDeviceToken(token: string): string {
  return V2_PREFIX + createHmac('sha256', currentPepper()).update(token).digest('hex');
}

/**
 * Legacy-format hash (v1, pre-Phase-C) of a raw device token. Kept ONLY to
 * verify hashes stored before the versioned scheme existed — new code must
 * never write this format.
 */
export function legacyDeviceTokenHash(token: string): string {
  return createHmac('sha256', LEGACY_PEPPER).update(token).digest('hex');
}

/**
 * Does `token` verify against `storedHash`? Accepts both formats. Length-
 * guarded timing-safe comparison.
 */
export function deviceTokenMatches(token: string, storedHash: string): boolean {
  if (!storedHash) return false;
  const computed = storedHash.startsWith(V2_PREFIX)
    ? hashDeviceToken(token)
    : legacyDeviceTokenHash(token);
  const a = Buffer.from(computed);
  const b = Buffer.from(storedHash);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export const DEVICE_TOKEN_LEGACY_PEPPER_FOR_TESTS = LEGACY_PEPPER;
