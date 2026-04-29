/**
 * Sigil Protocol — retry + timeout helpers.
 *
 * Code Quality Rule 4: every external call (0G, KeeperHub) MUST have a
 * timeout. Default: 30s.
 */

import { logger } from './logger';
import { SigilError, TimeoutError } from './errors';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

export interface WithRetryOptions {
  maxRetries?: number;
  timeoutMs?: number;
  /** Backoff base (ms). Total wait between attempts: base * attemptNumber. */
  backoffMs?: number;
}

/**
 * Wrap an async function with retry + timeout. Logs each failed attempt
 * via pino (Code Quality Rule 2). Throws a SigilError after all retries
 * exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  options: WithRetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoffMs = options.backoffMs ?? 1000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await withTimeout(fn(), timeoutMs, label);
    } catch (err) {
      lastError = err;
      logger.error({ label, attempt, err }, `${label} attempt failed`);
      if (attempt < maxRetries) {
        await sleep(backoffMs * attempt);
      }
    }
  }
  throw new SigilError(`${label} failed after ${maxRetries} attempts`, lastError);
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
