/**
 * Sigil Protocol — encryption + signing helpers.
 *
 * Per the locked-in PROJECT_STATE.md decisions:
 *  - AES-256-GCM for permission-manifest + input-context encryption
 *  - HKDF-SHA256(principal_signature_over("sigil-key-derivation"+passportId))
 *    derives the 32-byte symmetric key
 *  - Ciphertext layout: [iv (12 bytes) || authTag (16 bytes) || ciphertext]
 *
 * Notes on the key derivation: the principal signs a deterministic message
 * tied to the passportId. The signature bytes are passed through HKDF to
 * stretch them into a uniform 256-bit AES key. The principal can re-derive
 * the same key any time by signing the same message; the agent never holds
 * this key.
 */

import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
import type { Signer } from 'ethers';
import { hexlify, getBytes } from 'ethers';
import { CryptoError } from './errors';

const KEY_DERIVATION_LABEL = 'sigil-key-derivation';
const KEY_LENGTH = 32; // AES-256
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export interface SealedPayload {
  /** Concatenated bytes: iv || authTag || ciphertext, hex-encoded. */
  ciphertextHex: string;
  /** keccak256 of the ciphertext bytes — anchored on-chain as manifestHash. */
  contentHash: string;
}

/**
 * Build the deterministic message the principal signs to seed key derivation.
 * Anyone with the principal's wallet can recompute the key for a given
 * passportId; nobody without it can.
 */
export function keyDerivationMessage(passportId: string): string {
  return `${KEY_DERIVATION_LABEL}:${passportId.toLowerCase()}`;
}

/**
 * Derive a 32-byte AES key from a principal signature. The signature is the
 * primary input; HKDF is used purely to stretch it to a uniform 256-bit key
 * with domain separation (`info` field).
 *
 * `passportId` doubles as the HKDF salt so that two passports owned by the
 * same principal don't share a key.
 */
export function deriveSymmetricKey(principalSignatureHex: string, passportId: string): Buffer {
  if (!principalSignatureHex || !passportId) {
    throw new CryptoError('deriveSymmetricKey: signature and passportId required');
  }
  const ikm = Buffer.from(getBytes(principalSignatureHex));
  const salt = Buffer.from(getBytes(passportId));
  const info = Buffer.from(KEY_DERIVATION_LABEL, 'utf8');
  const derived = hkdfSync('sha256', ikm, salt, info, KEY_LENGTH);
  return Buffer.from(derived);
}

/**
 * Convenience: ask a Signer to sign the deterministic key-derivation message,
 * then derive the AES key from the resulting signature. The signature is
 * deterministic (Ethereum signMessage uses RFC-6979) so calling this twice
 * with the same wallet + passportId yields the same key.
 */
export async function deriveSymmetricKeyWithSigner(
  signer: Signer,
  passportId: string,
): Promise<Buffer> {
  const message = keyDerivationMessage(passportId);
  const signature = await signer.signMessage(message);
  return deriveSymmetricKey(signature, passportId);
}

/** Encrypt plaintext bytes with the given symmetric key. */
export function encryptBytes(plaintext: Uint8Array, key: Buffer): SealedPayload {
  if (key.length !== KEY_LENGTH) {
    throw new CryptoError(`encryptBytes: key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  if (authTag.length !== TAG_LENGTH) {
    throw new CryptoError(`encryptBytes: unexpected authTag length ${authTag.length}`);
  }
  const sealed = Buffer.concat([iv, authTag, ciphertext]);

  // Lazy-import to avoid pulling ethers crypto into module init order.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { keccak256 } = require('ethers') as typeof import('ethers');

  return {
    ciphertextHex: hexlify(sealed),
    contentHash: keccak256(sealed),
  };
}

/** Decrypt the layout produced by `encryptBytes`. */
export function decryptBytes(ciphertextHex: string, key: Buffer): Uint8Array {
  if (key.length !== KEY_LENGTH) {
    throw new CryptoError(`decryptBytes: key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
  const sealed = Buffer.from(getBytes(ciphertextHex));
  if (sealed.length < IV_LENGTH + TAG_LENGTH) {
    throw new CryptoError('decryptBytes: ciphertext too short');
  }
  const iv = sealed.subarray(0, IV_LENGTH);
  const authTag = sealed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = sealed.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    throw new CryptoError('decryptBytes: authentication failed', err);
  }
}

/** UTF-8 convenience wrappers. */
export function encryptJson(value: unknown, key: Buffer): SealedPayload {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  return encryptBytes(bytes, key);
}

export function decryptJson<T = unknown>(ciphertextHex: string, key: Buffer): T {
  const bytes = decryptBytes(ciphertextHex, key);
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as T;
}
