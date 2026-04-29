/**
 * Sigil Protocol — typed error classes.
 *
 * Code Quality Rule 3: every async function must handle errors explicitly.
 * Use these classes so callers can branch on `instanceof` instead of string
 * matching error messages.
 */

export class SigilError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'SigilError';
    this.cause = cause;
  }
}

/** A 0G (Storage / Compute / Chain) call failed. */
export class ZeroGError extends SigilError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'ZeroGError';
  }
}

/** A KeeperHub API or MCP call failed. */
export class KeeperHubError extends SigilError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'KeeperHubError';
  }
}

/** A registry-level guard failed (auth, not found, soulbound, etc.). */
export class RegistryError extends SigilError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'RegistryError';
  }
}

/** A provenance-level guard failed (signature, nonce, replay). */
export class ProvenanceError extends SigilError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'ProvenanceError';
  }
}

/** A timeout exceeded the configured bound. */
export class TimeoutError extends SigilError {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Encryption / decryption failed (wrong key, malformed ciphertext, etc.). */
export class CryptoError extends SigilError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'CryptoError';
  }
}
