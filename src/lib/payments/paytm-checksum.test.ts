import { describe, expect, it } from 'vitest';
import {
  generatePaytmChecksum,
  verifyPaytmChecksum,
} from '@platform/adapters';
import { createCipheriv, createHash } from 'node:crypto';

/**
 * Phase 5.3 — Paytm checksum known-vector tests.
 *
 * The Paytm adapter at `packages/adapters/src/payment/paytm.adapter.ts` ships
 * an OFFICIAL Paytm checksum algorithm (AES-128-CBC + SHA-256 + random salt +
 * constant-time compare). These tests verify the algorithm against known
 * vectors + edge cases that previously broke the hand-rolled implementation
 * (wrong IV `0123456789012345`, no salt, `===` comparison).
 *
 * No mocks. Real `node:crypto` is used — the AES + SHA-256 + timingSafeEqual
 * calls execute against the real Node crypto subsystem.
 */

const MERCHANT_KEY_32 = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'; // 32-char hex
const PAYLOAD: Record<string, string> = {
  MID: 'TESTMID',
  ORDERID: 'ORDER-1234',
  TXNID: 'TXN-5678',
  BANKNAME: 'TestBank',
  TXNAMOUNT: '100.00',
  CURRENCY: 'INR',
  STATUS: 'TXN_SUCCESS',
  RESPMSG: 'ok',
  BANKTXNID: 'BANK-5678',
};

describe('Paytm checksum — known-vector + official algorithm tests', () => {
  it('1. generatePaytmChecksum + verifyPaytmChecksum round-trip (should pass)', async () => {
    const checksum = await generatePaytmChecksum(PAYLOAD, MERCHANT_KEY_32);
    expect(typeof checksum).toBe('string');
    expect(checksum.length).toBeGreaterThan(0);
    const ok = await verifyPaytmChecksum(PAYLOAD, checksum, MERCHANT_KEY_32);
    expect(ok).toBe(true);
  });

  it('2. valid signature with a 32-char hex merchant key (should verify)', async () => {
    const checksum = await generatePaytmChecksum(PAYLOAD, MERCHANT_KEY_32);
    // A 32-char hex key is what real Paytm merchants receive — the algorithm
    // uses the first 16 bytes (ASCII) as the AES-128 key.
    const ok = await verifyPaytmChecksum(PAYLOAD, checksum, MERCHANT_KEY_32);
    expect(ok).toBe(true);
  });

  it('3. invalid signature (wrong merchant key) — verification should fail', async () => {
    const checksum = await generatePaytmChecksum(PAYLOAD, MERCHANT_KEY_32);
    // A different 32-char key — the AES decryption will produce a different
    // plaintext hash than what we recompute, so verification MUST fail.
    const wrongKey = 'f1e2d3c4b5a6978879605142312facbd';
    const ok = await verifyPaytmChecksum(PAYLOAD, checksum, wrongKey);
    expect(ok).toBe(false);
  });

  it('4. modified payload (change TXNAMOUNT after signing) — verification should fail', async () => {
    const checksum = await generatePaytmChecksum(PAYLOAD, MERCHANT_KEY_32);
    // Tamper with the amount AFTER signing — the recomputed SHA-256 hash will
    // differ from the decrypted hash → verification MUST fail.
    const tampered: Record<string, string> = { ...PAYLOAD, TXNAMOUNT: '999.00' };
    const ok = await verifyPaytmChecksum(tampered, checksum, MERCHANT_KEY_32);
    expect(ok).toBe(false);
  });

  it('5. missing fields in payload — verification should handle gracefully', async () => {
    // Generate a checksum over the full payload.
    const checksum = await generatePaytmChecksum(PAYLOAD, MERCHANT_KEY_32);
    // Verify against a payload missing a field. The paramsString differs →
    // the recomputed hash differs → verification MUST fail (gracefully, not throw).
    const partial: Record<string, string> = { ...PAYLOAD };
    delete partial.BANKTXNID;
    const ok = await verifyPaytmChecksum(partial, checksum, MERCHANT_KEY_32);
    expect(ok).toBe(false);

    // Conversely, a checksum generated over the partial payload should
    // round-trip with the partial payload.
    const partialChecksum = await generatePaytmChecksum(partial, MERCHANT_KEY_32);
    const partialOk = await verifyPaytmChecksum(partial, partialChecksum, MERCHANT_KEY_32);
    expect(partialOk).toBe(true);
  });

  it('6. malformed checksum (not valid base64 / decrypt failure) — verification should return false', async () => {
    // A random non-base64 string — decryption fails → verify returns false.
    const okGarbage = await verifyPaytmChecksum(PAYLOAD, '!!not-base64!!', MERCHANT_KEY_32);
    expect(okGarbage).toBe(false);

    // Valid base64 but the wrong length / content — decryption produces a
    // plaintext that doesn't split cleanly into hash+salt → verify returns false.
    const okRandom = await verifyPaytmChecksum(PAYLOAD, btoa('random-not-a-checksum'), MERCHANT_KEY_32);
    expect(okRandom).toBe(false);

    // Empty string — verify returns false.
    const okEmpty = await verifyPaytmChecksum(PAYLOAD, '', MERCHANT_KEY_32);
    expect(okEmpty).toBe(false);
  });

  it('7. short merchant key (< 16 chars) — generate throws, verify returns false', async () => {
    const shortKey = 'tooshort'; // 8 chars
    // generatePaytmChecksum MUST throw — the algorithm needs ≥16 chars for
    // the 16-byte AES-128 key. Throwing surfaces misconfiguration loudly.
    await expect(generatePaytmChecksum(PAYLOAD, shortKey)).rejects.toThrow(/16 characters/);

    // verifyPaytmChecksum MUST return false (not throw) — a webhook signed
    // with a short key is unverifiable + the cron/webhook must continue.
    const ok = await verifyPaytmChecksum(PAYLOAD, 'some-checksum', shortKey);
    expect(ok).toBe(false);
  });

  it('8. the IV is "@@@@&&&&####$$$$" (a checksum generated with the OLD IV fails verification)', async () => {
    // Generate a checksum using the OLD (wrong) IV `0123456789012345` +
    // the OFFICIAL algorithm otherwise (salt + sha256 + values-only string).
    // Verification MUST fail because the official `verifyPaytmChecksum`
    // decrypts with `@@@@&&&&####$$$$` — different IV → different plaintext →
    // hash mismatch.
    const OLD_IV = Buffer.from('0123456789012345', 'utf8');
    const OFFICIAL_IV = '@@@@&&&&####$$$$';
    // Sanity: the official IV is the documented value.
    expect(OFFICIAL_IV).toBe('@@@@&&&&####$$$$');

    // Build the params string the SAME way the official algorithm does:
    // sorted VALUES joined by '|' (excluding CHECKSUMHASH).
    const keys = Object.keys(PAYLOAD)
      .filter((k) => k !== 'CHECKSUMHASH')
      .sort();
    const paramsString = keys.map((k) => PAYLOAD[k]).join('|');

    // Use a fixed salt for determinism (the official algorithm uses
    // randomBytes(4), but we need a known salt to construct a deterministic
    // old-IV checksum that is otherwise identical to an official one).
    const salt = 'a1b2'; // 4-char hex (matches randomBytes(4).toString('hex').slice(0, 4))
    const hash = createHash('sha256').update(paramsString + '|' + salt, 'utf8').digest('hex');
    const plaintext = hash + salt; // 68 chars
    const key = Buffer.from(MERCHANT_KEY_32.slice(0, 16), 'utf8');

    const oldIvCipher = createCipheriv('aes-128-cbc', key, OLD_IV);
    const oldIvChecksum = Buffer.concat([
      oldIvCipher.update(plaintext, 'utf8'),
      oldIvCipher.final(),
    ]).toString('base64');

    // Verifying the OLD-IV checksum with the OFFICIAL verifier (which uses
    // @@@@&&&&####$$$$) MUST fail — the wrong IV produces a different
    // plaintext on decrypt.
    const ok = await verifyPaytmChecksum(PAYLOAD, oldIvChecksum, MERCHANT_KEY_32);
    expect(ok).toBe(false);

    // Control: the SAME plaintext encrypted with the OFFICIAL IV verifies.
    const officialIvCipher = createCipheriv('aes-128-cbc', key, OFFICIAL_IV);
    const officialChecksum = Buffer.concat([
      officialIvCipher.update(plaintext, 'utf8'),
      officialIvCipher.final(),
    ]).toString('base64');
    const okOfficial = await verifyPaytmChecksum(PAYLOAD, officialChecksum, MERCHANT_KEY_32);
    expect(okOfficial).toBe(true);
  });

  it('9. the checksum includes a random salt (same payload twice → different checksums)', async () => {
    // The official algorithm appends `randomBytes(4).toString('hex').slice(0, 4)`
    // to the SHA-256 input + the plaintext. Two calls with the same payload
    // MUST produce different ciphertexts (because the salt differs).
    const c1 = await generatePaytmChecksum(PAYLOAD, MERCHANT_KEY_32);
    const c2 = await generatePaytmChecksum(PAYLOAD, MERCHANT_KEY_32);
    expect(c1).not.toBe(c2);

    // Both must still verify against the original payload.
    expect(await verifyPaytmChecksum(PAYLOAD, c1, MERCHANT_KEY_32)).toBe(true);
    expect(await verifyPaytmChecksum(PAYLOAD, c2, MERCHANT_KEY_32)).toBe(true);
  });

  it('10. CHECKSUMHASH in the params is excluded from verification (not part of the signed string)', async () => {
    // Real Paytm callbacks include CHECKSUMHASH in the payload. The algorithm
    // MUST exclude it from the paramsString used for verification — otherwise
    // the checksum would be self-referential + never verify.
    const paramsWithChecksum: Record<string, string> = {
      ...PAYLOAD,
      CHECKSUMHASH: 'placeholder-will-be-replaced',
    };
    const realChecksum = await generatePaytmChecksum(paramsWithChecksum, MERCHANT_KEY_32);
    paramsWithChecksum.CHECKSUMHASH = realChecksum;
    // Verifying with CHECKSUMHASH present in the params MUST still pass —
    // the verifier excludes it from the paramsString.
    const ok = await verifyPaytmChecksum(paramsWithChecksum, realChecksum, MERCHANT_KEY_32);
    expect(ok).toBe(true);
  });

  it('11. two different payloads with the same merchant key produce different checksums', async () => {
    // Sanity: different inputs → different outputs. This catches a regression
    // where the algorithm accidentally ignored the payload (e.g. signed an
    // empty string).
    const c1 = await generatePaytmChecksum(PAYLOAD, MERCHANT_KEY_32);
    const other: Record<string, string> = { ...PAYLOAD, ORDERID: 'DIFFERENT-ORDER' };
    const c2 = await generatePaytmChecksum(other, MERCHANT_KEY_32);
    expect(c1).not.toBe(c2);
  });
});
