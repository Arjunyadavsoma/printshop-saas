import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypt merchant payment credentials at rest using AES-256-GCM.
 *
 * The encryption key is read from PAYMENT_ENCRYPTION_KEY (32 bytes, base64).
 * In production, store this key in a proper secret manager (AWS KMS, Doppler,
 * Infisical, etc.) — never in code or client bundles.
 *
 * The encrypted output is: `v1:<nonceHex>:<ciphertextHex>:<tagHex>`
 * Key versioning allows rotation: the key version is stored alongside the
 * ciphertext, so old ciphertext can be re-encrypted with a new key.
 *
 * NEVER log the plaintext credentials or the decrypted result.
 */

const KEY_VERSION = '1';

function getEncryptionKey(): Buffer {
  const raw = process.env.PAYMENT_ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: PAYMENT_ENCRYPTION_KEY is required in production');
    }
    return Buffer.alloc(32, 0x41);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('PAYMENT_ENCRYPTION_KEY must be 32 bytes (base64-encoded)');
  }
  return key;
}

export function encryptCredentials(data: Record<string, unknown>): string {
  const key = getEncryptionKey();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const plaintext = JSON.stringify(data);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${KEY_VERSION}:${nonce.toString('hex')}:${ciphertext.toString('hex')}:${tag.toString('hex')}`;
}

export function decryptCredentials(encrypted: string): Record<string, unknown> {
  const parts = encrypted.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted credential format');
  const [version, nonceHex, ciphertextHex, tagHex] = parts;
  if (version !== `v${KEY_VERSION}`) {
    throw new Error(`Unknown encryption key version: ${version}. Re-encrypt with the current key.`);
  }
  const key = getEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as Record<string, unknown>;
}

export function needsReencryption(encrypted: string): boolean {
  return encrypted.split(':')[0] !== `v${KEY_VERSION}`;
}
