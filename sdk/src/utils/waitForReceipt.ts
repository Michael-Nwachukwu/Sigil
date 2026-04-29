/**
 * Sigil Protocol — resilient receipt waiter.
 *
 * 0G Galileo's RPC nodes sometimes return `-32000 "no matching receipts
 * found: this may indicate potential data corruption"` for `eth_getTransactionReceipt`
 * while the tx is mined but the node hasn't caught up yet. ethers v6's
 * `tx.wait()` surfaces this as a fatal error instead of retrying. This
 * helper polls with backoff and treats that specific error (plus a generic
 * "could not coalesce" pattern) as transient.
 *
 * Real reverts (status === 0) and unrelated RPC errors still throw.
 */
import type {
  ContractTransactionResponse,
  JsonRpcProvider,
  TransactionReceipt,
  TransactionResponse,
} from 'ethers';
import { SigilError } from './errors';
import { logger } from './logger';

const TRANSIENT_PATTERNS = [
  'no matching receipts',
  'could not coalesce',
  'data corruption',
];

function isTransientReceiptError(err: unknown): boolean {
  if (!err) return false;
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : JSON.stringify(err);
  const lower = message.toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => lower.includes(p));
}

export interface WaitForReceiptOptions {
  /** Max wall-clock time to wait, ms. Default 90s. */
  timeoutMs?: number;
  /** Polling interval, ms. Default 1500ms. */
  pollMs?: number;
  /** Tag for logs — usually the operation name. */
  label?: string;
}

/**
 * Poll for a transaction receipt with backoff. Treats Galileo's flaky
 * "no matching receipts" -32000 as transient. Returns once `receipt.status`
 * is set; throws on revert (status !== 1).
 */
export async function waitForReceipt(
  provider: JsonRpcProvider,
  txHash: string,
  options: WaitForReceiptOptions = {},
): Promise<TransactionReceipt> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const pollMs = options.pollMs ?? 1500;
  const label = options.label ?? 'tx';
  const start = Date.now();
  let lastErr: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        if (receipt.status !== 1) {
          throw new SigilError(
            `${label} reverted (hash=${txHash}, status=${receipt.status})`,
          );
        }
        return receipt;
      }
    } catch (err) {
      if (!isTransientReceiptError(err)) {
        throw err;
      }
      lastErr = err;
      logger.debug(
        { txHash, label, err: (err as Error).message },
        'transient receipt error — retrying',
      );
    }
    await sleep(pollMs);
  }
  throw new SigilError(
    `waitForReceipt: ${label} ${txHash} not confirmed within ${timeoutMs}ms` +
      (lastErr ? ` (last error: ${(lastErr as Error).message})` : ''),
  );
}

/**
 * Drop-in replacement for `tx.wait()` that uses the resilient poller above
 * after the tx is dispatched. Returns the receipt or throws on revert.
 */
export async function awaitTx(
  tx: TransactionResponse | ContractTransactionResponse,
  provider: JsonRpcProvider,
  options: WaitForReceiptOptions = {},
): Promise<TransactionReceipt> {
  return waitForReceipt(provider, tx.hash, options);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
