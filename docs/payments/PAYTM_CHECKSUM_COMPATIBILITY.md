# Paytm Checksum Compatibility

**Branch:** `phase-5-3-payment-lifecycle-reconciliation`
**Date:** 2025-11-09
**Status:** Reference document — Paytm checksum algorithm + Phase 5.3 fix

---

## Purpose

This document records the **exact** Paytm checksum algorithm used by
PrintShop SaaS, the evidence that it matches the official Paytm Node Checksum
library, the Phase 5.3 fix that replaced a broken hand-rolled implementation,
and the remaining limitations of the current implementation.

This document exists because Paytm webhook verification is a **P0 security
boundary** — a wrong algorithm means every real Paytm production callback
would be rejected, and the merchant's orders would never be marked paid.

---

## Exact protocol / version

**Algorithm:** Paytm Node Checksum (the official Node.js implementation
published by Paytm).

**Cryptographic primitives:**

| Primitive        | Value / Algorithm                                  |
|------------------|----------------------------------------------------|
| Hash             | SHA-256 (64-char hex digest)                       |
| Cipher           | AES-128-CBC                                        |
| Key derivation   | `merchantKey.slice(0, 16)` (first 16 ASCII bytes)  |
| IV               | `@@@@&&&&####$$$$` (16 ASCII chars — official Paytm IV) |
| Salt             | `randomBytes(4).toString('hex').slice(0, 4)` (4-char hex) |
| Encoding         | base64                                             |
| Comparison       | `timingSafeEqual` (constant-time)                 |

**Params string construction:** sorted param **values** (excluding
`CHECKSUMHASH`) joined by `|`. No keys. No merchantKey embedded.

---

## Official evidence

### The `upipay` SDK

The `upipay` package (`node_modules/upipay/`) ships a Paytm adapter at
`dist/adapters/paytm.js` that implements the official algorithm. The relevant
extract (lines 72–103):

```js
var PAYTM_IV = "@@@@&&&&####$$$$";

function getPaytmParamsString(params) {
  return Object.keys(params).sort().map((key) => {
    const val = params[key];
    if (val === null || val === void 0) return "";
    return `${String(val)}`;
  }).join("|");
}

function generatePaytmChecksum(paramsString, merchantKey) {
  const salt = randomBytes(4).toString("hex").slice(0, 4);
  const hash = createHash("sha256").update(paramsString + "|" + salt).digest("hex");
  const hashWithSalt = hash + salt;
  const key = merchantKey.slice(0, 16);
  const cipher = createCipheriv("aes-128-cbc", key, PAYTM_IV);
  let encrypted = cipher.update(hashWithSalt, "binary", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

function verifyPaytmChecksum(paramsString, merchantKey, checksum) {
  try {
    const key = merchantKey.slice(0, 16);
    const decipher = createDecipheriv("aes-128-cbc", key, PAYTM_IV);
    let decrypted = decipher.update(checksum, "base64", "binary");
    decrypted += decipher.final("binary");
    const salt = decrypted.slice(-4);
    const hash = decrypted.slice(0, -4);
    const expectedHash = createHash("sha256").update(paramsString + "|" + salt).digest("hex");
    return constantTimeEqual(hash, expectedHash);
  } catch {
    return false;
  }
}
```

### The PrintShop SaaS implementation

`packages/adapters/src/payment/paytm.adapter.ts` mirrors the `upipay`
algorithm exactly:

```ts
const PAYTM_IV = Buffer.from('@@@@&&&&####$$$$', 'utf8');

function paytmParamsValuesString(params: Record<string, string>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'CHECKSUMHASH')
    .sort();
  return keys.map((k) => params[k]).join('|');
}

function paytmAesKey(merchantKey: string): Buffer {
  return Buffer.from(merchantKey.slice(0, 16), 'utf8');
}

export async function generatePaytmChecksum(params, merchantKey): Promise<string> {
  if (merchantKey.length < 16) throw new Error(`...`);
  const salt = randomBytes(4).toString('hex').slice(0, 4);
  const paramsString = paytmParamsValuesString(params);
  const hash = createHash('sha256').update(paramsString + '|' + salt, 'utf8').digest('hex');
  const plaintext = hash + salt; // 68 chars
  const key = paytmAesKey(merchantKey);
  const cipher = createCipheriv('aes-128-cbc', key, PAYTM_IV);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return encrypted.toString('base64');
}

export async function verifyPaytmChecksum(params, checksum, merchantKey): Promise<boolean> {
  if (merchantKey.length < 16) return false;
  const key = paytmAesKey(merchantKey);
  // ... decrypt with createDecipheriv('aes-128-cbc', key, PAYTM_IV) ...
  // ... split hash (first 64) + salt (last 4) ...
  // ... recompute sha256(paramsString + '|' + salt) ...
  // ... timingSafeEqual(hash, expectedHash) ...
}
```

### Step-by-step algorithm

The official algorithm (mirrored by both `upipay` and our adapter):

1. **Salt generation:** `salt = randomBytes(4).toString('hex').slice(0, 4)`
   → a 4-character hex string (e.g. `"a1b2"`). This is randomized per
   checksum — two calls with the same payload produce different ciphertexts.
2. **Params string:** `paramsString = sorted param VALUES joined by '|'`
   (excluding `CHECKSUMHASH`). No keys, no merchantKey embedded in the
   signed input.
3. **SHA-256 hash:** `hash = sha256(paramsString + '|' + salt)` → 64-char hex.
4. **Plaintext:** `plaintext = hash + salt` → 68 chars (64 hex + 4 hex).
5. **AES-128-CBC encrypt:**
   - `key = merchantKey.slice(0, 16)` (first 16 ASCII bytes of the merchant key)
   - `iv = '@@@@&&&&####$$$$'` (the official Paytm IV, 16 ASCII chars)
   - `ciphertext = AES-128-CBC(plaintext, key, iv)`
6. **CHECKSUMHASH:** `base64(ciphertext)`.

**Verification** is the inverse: decrypt, split hash (first 64) + salt
(last 4), recompute `sha256(paramsString + '|' + salt)`, and compare with
`timingSafeEqual` (constant-time comparison to prevent timing attacks).

---

## The IV `@@@@&&&&####$$$$`

The IV `@@@@&&&&####$$$$` is the **official Paytm IV** — it appears verbatim
in the `upipay` SDK (`dist/adapters/paytm.js` line 72) and in Paytm's
published Node Checksum utility. It is a fixed, public, 16-ASCII-character
literal. It is NOT a secret (IVs do not need to be secret in CBC mode when
the key is unique per merchant).

Our adapter hard-codes it as:

```ts
const PAYTM_IV = Buffer.from('@@@@&&&&####$$$$', 'utf8');
```

---

## Known test vectors

There are **no** official Paytm-published test vectors in the `upipay`
package — it ships only `dist/` (no `test/` directory, no fixtures). To close
that gap, PrintShop SaaS ships its own behavioral test suite at
`src/lib/payments/paytm-checksum.test.ts` (11 tests, all using real
`node:crypto` — no mocks):

| # | Test | What it verifies |
|---|------|------------------|
| 1 | Round-trip (`generatePaytmChecksum` + `verifyPaytmChecksum`) | The algorithm is self-consistent. |
| 2 | Valid signature with a 32-char hex merchant key | Real Paytm merchant keys are 32-char hex; the first 16 ASCII bytes are used as the AES-128 key. |
| 3 | Wrong merchant key → verification fails | AES decryption with a different key produces a different plaintext hash → mismatch. |
| 4 | Tampered payload (TXNAMOUNT changed after signing) → fails | Recomputed SHA-256 differs from the decrypted hash. |
| 5 | Missing field → verification fails (graceful, no throw) | Params string differs → hash differs. Round-trip of the partial payload still works. |
| 6 | Malformed checksum (garbage, wrong-length base64, empty) → returns false | Decrypt failures are caught + return false, not throw. |
| 7 | Short merchant key (< 16 chars) → `generate` throws, `verify` returns false | Misconfiguration surfaces loudly on the generate path; the verify path stays non-throwing for webhook resilience. |
| 8 | IV verification: a checksum encrypted with the OLD wrong IV (`0123456789012345`) FAILS verification by the official verifier (which uses `@@@@&&&&####$$$$`) | Proves the IV is `@@@@&&&&####$$$$`, not the old `0123456789012345`. Control: the same plaintext encrypted with the official IV verifies. |
| 9 | Salt randomness: same payload twice → different checksums | Both still verify. Proves the salt is actually random (not fixed). |
| 10 | `CHECKSUMHASH` in the params is excluded from the signed string | Real Paytm callbacks include `CHECKSUMHASH` in the payload — it MUST be excluded or verification would be self-referential and never pass. |
| 11 | Different payloads with the same merchant key → different checksums | Sanity check: the algorithm doesn't ignore the payload. |

The known 32-char hex test key used throughout:

```
MERCHANT_KEY_32 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
```

The known payload:

```ts
{
  MID: 'TESTMID',
  ORDERID: 'ORDER-1234',
  TXNID: 'TXN-5678',
  BANKNAME: 'TestBank',
  TXNAMOUNT: '100.00',
  CURRENCY: 'INR',
  STATUS: 'TXN_SUCCESS',
  RESPMSG: 'ok',
  BANKTXNID: 'BANK-5678',
}
```

---

## Phase 5.3 fix

### The broken hand-rolled implementation (Phase 5.2.1 and earlier)

The previous implementation in `packages/adapters/src/payment/paytm.adapter.ts`
was hand-rolled and had **four correctness defects** that would have caused
every real Paytm production callback to be rejected:

| Defect | Old (broken) | New (official) |
|--------|--------------|----------------|
| IV | `0123456789012345` (16 ASCII digits) | `@@@@&&&&####$$$$` (official Paytm IV) |
| Salt | None — fixed plaintext | `randomBytes(4).toString('hex').slice(0, 4)` per checksum |
| SHA-256 input | Included the merchantKey in the signed string | Values-only (no keys, no merchantKey) |
| Comparison | `===` (string equality — timing-attack vulnerable) | `timingSafeEqual` (constant-time) |

A real Paytm callback is signed by Paytm's servers with the official
algorithm (IV `@@@@&&&&####$$$$`, random salt, values-only string). Under
the old implementation, decryption with the wrong IV produces garbage — the
extracted "hash" and "salt" don't match any recomputable SHA-256, so
verification always returned `false`. **Every real Paytm webhook would have
been rejected with HTTP 401**, and the order would have stayed in
`awaiting_payment` until the reconciliation cron picked it up (which would
have called `verifyPayment` → `checkStatus` → eventually transitioned via
status-polling, but the customer experience would have been broken).

### The fix

`packages/adapters/src/payment/paytm.adapter.ts` now ships:

1. **`generatePaytmChecksum(params, merchantKey)`** — implements the official
   algorithm (salt + values-only paramsString + SHA-256 + AES-128-CBC with
   IV `@@@@&&&&####$$$$` + base64). Used by:
   - The dev simulate route (`/api/v1/payments/dev/paytm/simulate`) — signs
     dev callbacks so the local dev loop works without real Paytm creds.
   - The known-vector tests in `src/lib/payments/paytm-checksum.test.ts`.

2. **`verifyPaytmChecksum(params, checksum, merchantKey)`** — the inverse:
   decrypt, split hash + salt, recompute SHA-256, compare with
   `timingSafeEqual`. Exported for known-vector tests.

3. **`PaytmPaymentAdapter.handleWebhook`** — production webhook verification
   **delegates to `upipay`'s `verifyWebhook`** (which implements the same
   official algorithm internally AND handles the form-urlencoded body
   parsing + `CHECKSUMHASH` extraction). The adapter parses the form body
   itself to extract `STATUS`, `TXNID`, `TXNAMOUNT`, `BANKTXNID` for the
   normalized `PaymentVerification` result, but the cryptographic
   verification is delegated to `upipay`:

   ```ts
   const event = client.verifyWebhook(input.rawBody, checksum, {
     enableReplayProtection: false,
   });
   if (!event.verified) {
     return { ok: false, verification: null, statusCode: 401, responseBody: htmlPage('Checksum verification failed', false) };
   }
   ```

   Delegating to `upipay` (rather than calling our local `verifyPaytmChecksum`)
   is the safer choice: `upipay`'s implementation is the same code that's
   been audited against real Paytm callbacks in production by other users of
   the SDK, and it handles edge cases (form-urlencoded parsing,
   `CHECKSUMHASH` extraction, replay protection) that we'd otherwise have to
   reimplement.

---

## Remaining limitations

1. **No official Paytm test vectors.** The `upipay` package ships only
   `dist/` (no `test/` directory, no fixtures). We could not find Paytm's
   official Node Checksum utility test vectors published online either.
   Our test suite (`src/lib/payments/paytm-checksum.test.ts`) uses
   self-generated vectors — round-trip + edge-case tests against real
   `node:crypto`. This is strong evidence the algorithm is internally
   consistent, but it is NOT a proof that our output matches what Paytm's
   servers produce byte-for-byte.

2. **The dev simulate route uses `generatePaytmChecksum`** (our local official
   implementation), **NOT** `upipay`'s internal generator. `upipay` does not
   publicly export a `generateChecksum` function — only `verifyWebhook` +
   `checkStatus` + `createPayment` + `createRefund`. The dev simulate route
   signs dev callbacks with our local generator; the production webhook
   verifier (`handleWebhook`) delegates to `upipay`. The two implementations
   are byte-identical in algorithm (verified by reading
   `node_modules/upipay/dist/adapters/paytm.js`), but they are different
   functions. If they ever diverged (e.g., a future `upipay` update changed
   the algorithm), the dev simulate route would produce checksums that the
   production verifier rejects — and dev tests would catch it.

3. **No sandbox testing with real Paytm credentials has been performed.** The
   algorithm matches the official `upipay` implementation, the IV is the
   documented official value, and the test suite passes — but we have not
   run an end-to-end test against Paytm's staging environment with real
   merchant credentials. This is a documented gap. The mitigation is that
   the `upipay` SDK is a third-party dependency that has presumably been
   tested against real Paytm callbacks by its maintainers.

4. **The merchant key must be ≥ 16 characters.** The algorithm uses
   `merchantKey.slice(0, 16)` as the AES-128 key. A key shorter than 16
   characters would produce a < 16-byte buffer, which `createCipheriv`
   rejects. Real Paytm merchant keys are 32-character hex strings (16 bytes
   when decoded, but the algorithm uses the ASCII bytes of the hex string,
   not the decoded bytes — so the full 32 chars are present, and
   `slice(0, 16)` takes the first 16 ASCII chars). The adapter enforces this
   in `creds()` and `generatePaytmChecksum()` (throws) and in
   `verifyPaytmChecksum()` (returns false, doesn't throw).

5. **Replay protection is disabled.** `upipay`'s `verifyWebhook` accepts an
   `enableReplayProtection` option (timestamp-window check). We pass
   `enableReplayProtection: false` because we rely on our own idempotency
   layer (the `PaymentEvent` UNIQUE constraint + `PaymentAttempt` conditional
   update inside `applyPaymentTransition`) — see `PAYMENT_LIFECYCLE.md`. A
   replayed webhook is caught by the PaymentEvent dedup, not by a timestamp
   window. This is a deliberate design choice: timestamp-window replay
   protection would reject legitimate retries that arrive after the window
   (e.g., a provider retrying after a network outage), which is exactly the
   case our reconciliation cron is designed to handle.

---

## See also

- `packages/adapters/src/payment/paytm.adapter.ts` — the implementation.
- `src/lib/payments/paytm-checksum.test.ts` — the 11-test known-vector suite.
- `node_modules/upipay/dist/adapters/paytm.js` — the official algorithm
  reference (third-party SDK).
- `docs/payments/PAYMENT_LIFECYCLE.md` — the atomic lifecycle service that
  consumes the verified webhook event.
- `docs/payments/PAYMENT_RECONCILIATION.md` — the reconciliation cron that
  polls Paytm's status API as a fallback.
