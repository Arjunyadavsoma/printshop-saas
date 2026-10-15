import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { encryptCredentials, decryptCredentials, needsReencryption } from './credential-encryption';

const TEST_KEY = Buffer.alloc(32, 0x41).toString('base64');

beforeEach(() => {
  process.env.PAYMENT_ENCRYPTION_KEY = TEST_KEY;
});
afterEach(() => {
  delete process.env.PAYMENT_ENCRYPTION_KEY;
});

describe('Credential encryption (AES-256-GCM)', () => {
  it('round-trips: encrypt → decrypt → original', () => {
    const creds = { saltKey: 'secret-salt', merchantId: 'MID123', merchantKey: 'MK456' };
    const enc = encryptCredentials(creds);
    expect(enc).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    const dec = decryptCredentials(enc);
    expect(dec).toEqual(creds);
  });

  it('produces different ciphertext for the same input (random nonce)', () => {
    const creds = { key: 'val' };
    const a = encryptCredentials(creds);
    const b = encryptCredentials(creds);
    expect(a).not.toBe(b);
  });

  it('throws on tampered ciphertext (auth tag mismatch)', () => {
    const enc = encryptCredentials({ key: 'val' });
    const parts = enc.split(':');
    // Flip one byte in the ciphertext.
    const tampered = parts[2]!.slice(0, -2) + (parts[2]!.slice(-2) === '00' ? '01' : '00');
    const tamperedEnc = `${parts[0]}:${parts[1]}:${tampered}:${parts[3]}`;
    expect(() => decryptCredentials(tamperedEnc)).toThrow();
  });

  it('throws on wrong key', () => {
    const enc = encryptCredentials({ key: 'val' });
    process.env.PAYMENT_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString('base64');
    expect(() => decryptCredentials(enc)).toThrow();
  });

  it('detects when reencryption is needed (wrong version)', () => {
    expect(needsReencryption('v1:abc:def:123')).toBe(false);
    expect(needsReencryption('v2:abc:def:123')).toBe(true);
  });

  it('throws in production without PAYMENT_ENCRYPTION_KEY', () => {
    delete process.env.PAYMENT_ENCRYPTION_KEY;
    const orig = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    expect(() => encryptCredentials({})).toThrow('FATAL');
    (process.env as Record<string, string>).NODE_ENV = orig;
  });
});
