/**
 * Sigil Protocol — pino logger.
 *
 * Code Quality Rule 2: NEVER use console.* in SDK code. Always use this
 * logger. `redactSensitiveFields` strips known-sensitive keys before they
 * make it into log output (Security Rule: never log private keys / raw
 * permission manifests).
 */

import pino, { type Logger } from 'pino';

const REDACT_PATHS = [
  'agentPrivateKey',
  'privateKey',
  'PRIVATE_KEY',
  '*.agentPrivateKey',
  '*.privateKey',
  '*.PRIVATE_KEY',
  'permissionManifest',
  'permissionManifestPlain',
  'manifest',
  '*.permissionManifest',
  '*.permissionManifestPlain',
  '*.manifest',
  'mnemonic',
  '*.mnemonic',
];

export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
});

export type { Logger };

/**
 * Recursively scrub known-sensitive fields from a payload before passing it
 * to a non-pino sink (e.g., HTTP responses, audit-trail records). Returns a
 * shallow copy.
 */
export function redactSensitiveFields<T>(payload: T): T {
  if (payload === null || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => redactSensitiveFields(item)) as unknown as T;
  }
  const SENSITIVE_KEYS = new Set([
    'agentPrivateKey',
    'privateKey',
    'PRIVATE_KEY',
    'permissionManifest',
    'permissionManifestPlain',
    'manifest',
    'mnemonic',
    'seed',
  ]);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = redactSensitiveFields(value);
    }
  }
  return out as T;
}
