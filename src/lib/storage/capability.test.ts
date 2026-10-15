import { describe, expect, it } from 'vitest';
import { signCapability, verifyCapability, signedParams } from '@/lib/storage/capability';

describe('Storage capability signing', () => {
  const KEY = 'shops/11111111-1111-4111-8111-111111111111/orders/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333';

  it('verifies a valid, unexpired capability', () => {
    const params = signedParams(KEY, 'PUT', 300);
    expect(verifyCapability(params, 'PUT')).toBe(KEY);
  });

  it('rejects a GET capability when PUT was signed (method mismatch)', () => {
    const params = signedParams(KEY, 'PUT', 300);
    expect(verifyCapability(params, 'GET')).toBeNull();
  });

  it('rejects a tampered key (sig no longer matches)', () => {
    const params = signedParams(KEY, 'PUT', 300);
    params.set('key', 'shops/99999999-9999-9999-9999-999999999999/orders/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333');
    expect(verifyCapability(params, 'PUT')).toBeNull();
  });

  it('rejects an expired capability', () => {
    const exp = Math.floor(Date.now() / 1000) - 10; // expired 10s ago
    const sig = signCapability(KEY, 'PUT', exp);
    const params = new URLSearchParams({ key: KEY, exp: String(exp), sig });
    expect(verifyCapability(params, 'PUT')).toBeNull();
  });

  it('rejects a missing signature', () => {
    const params = new URLSearchParams({ key: KEY, exp: String(Math.floor(Date.now() / 1000) + 300) });
    expect(verifyCapability(params, 'PUT')).toBeNull();
  });

  it('rejects a malformed key (path traversal attempt)', () => {
    const badKey = '../../../etc/passwd';
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = signCapability(badKey, 'PUT', exp);
    const params = new URLSearchParams({ key: badKey, exp: String(exp), sig });
    expect(verifyCapability(params, 'PUT')).toBeNull();
  });

  it('rejects a key with the wrong format (no shopId/orderId/fileId)', () => {
    const badKey = 'shops/aaa/orders/bbb'; // missing fileId
    const exp = Math.floor(Date.now() / 1000) + 300;
    const sig = signCapability(badKey, 'PUT', exp);
    const params = new URLSearchParams({ key: badKey, exp: String(exp), sig });
    expect(verifyCapability(params, 'PUT')).toBeNull();
  });
});
