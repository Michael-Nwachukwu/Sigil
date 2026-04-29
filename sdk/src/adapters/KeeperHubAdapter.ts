/**
 * Sigil Protocol — KeeperHub adapter.
 *
 * The agent signs notarization txs LOCALLY (so on-chain
 * `isAuthorizedSigner(passportId, msg.sender)` resolves to the registered
 * agent). This adapter is the broadcast + audit-trail boundary on top of that.
 *
 * Phase 2 status — hybrid implementation:
 *   1. **Direct broadcast (default)**: hands the agent-signed raw tx to a
 *      JsonRpcProvider, awaits the receipt, and synthesizes a structured
 *      `KeeperHubAuditEntry` from the receipt + submission timing. This is
 *      a real on-chain call (Anti-Hallucination Rule 3), just without
 *      KeeperHub's MEV-protected private-mempool routing.
 *   2. **KeeperHub broadcast (opt-in)**: if `apiBaseUrl` + `broadcastPath`
 *      are configured, the adapter POSTs the signed tx to KeeperHub's
 *      relayer instead. Disabled by default — the public KeeperHub REST
 *      docs (https://docs.keeperhub.com) returned 403 during Phase 2
 *      verification (2026-04-29), so we don't ship a hardcoded path that
 *      might be wrong. The flag flips once the API shape is confirmed.
 *
 * Either path produces the same `KeeperHubAuditEntry` shape so callers
 * (ProvenanceNotary fingerprinting, mostly) don't branch.
 */

import type { JsonRpcProvider, TransactionReceipt } from 'ethers';
import type { KeeperHubAuditEntry } from '../types/index';
import { KeeperHubError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface KeeperHubAdapterConfig {
  /** API key, kept for the day the KeeperHub REST path is wired in. */
  apiKey: string;
  /** Optional override base URL, e.g. `https://app.keeperhub.com`. */
  apiBaseUrl?: string;
  /**
   * Optional path under `apiBaseUrl` for raw-tx broadcast. If unset, the
   * adapter uses direct provider broadcast (still real on-chain).
   */
  broadcastPath?: string;
  /** Default tx-confirmation timeout (ms). */
  confirmationTimeoutMs?: number;
}

export interface BroadcastParams {
  /** Pre-signed raw transaction hex (`0x...`). Agent's signature embedded. */
  signedTx: string;
  /** PassportID of the producing agent — for the audit-trail entry. */
  passportId: string;
  /** Provider to broadcast through (or to confirm a KeeperHub-routed tx). */
  provider: JsonRpcProvider;
  /** Reserved — not used by direct broadcast; honored by the KeeperHub path. */
  maxRetries?: number;
}

export interface BroadcastResult {
  txHash: string;
  receipt: TransactionReceipt;
  auditTrail: KeeperHubAuditEntry;
}

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 60_000;

export class KeeperHubAdapter {
  private readonly apiKey: string;
  private readonly apiBaseUrl: string;
  private readonly broadcastPath: string | undefined;
  private readonly confirmationTimeoutMs: number;

  constructor(config: KeeperHubAdapterConfig) {
    if (!config.apiKey) {
      throw new KeeperHubError('KeeperHubAdapter: apiKey required');
    }
    this.apiKey = config.apiKey;
    this.apiBaseUrl = config.apiBaseUrl ?? 'https://app.keeperhub.com';
    this.broadcastPath = config.broadcastPath;
    this.confirmationTimeoutMs = config.confirmationTimeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
  }

  /** Whether the adapter will route through KeeperHub vs. direct broadcast. */
  get usesKeeperHubBroadcast(): boolean {
    return !!this.broadcastPath;
  }

  async broadcastSigned(params: BroadcastParams): Promise<BroadcastResult> {
    if (!params.signedTx?.startsWith('0x')) {
      throw new KeeperHubError(
        `broadcastSigned: signedTx must be 0x-prefixed (got "${String(params.signedTx).slice(0, 10)}...")`,
      );
    }
    if (!params.provider) {
      throw new KeeperHubError('broadcastSigned: provider required');
    }
    return this.broadcastPath
      ? this.broadcastViaKeeperHub(params)
      : this.broadcastDirect(params);
  }

  private async broadcastDirect(params: BroadcastParams): Promise<BroadcastResult> {
    const submittedAt = Date.now();
    const tx = await params.provider.broadcastTransaction(params.signedTx);
    logger.info(
      { txHash: tx.hash, passportId: params.passportId, route: 'direct' },
      'KeeperHub: broadcast (direct provider)',
    );
    const receipt = await tx.wait(1, this.confirmationTimeoutMs);
    if (!receipt) {
      throw new KeeperHubError(
        `broadcastSigned: tx ${tx.hash} not confirmed within ${this.confirmationTimeoutMs}ms`,
      );
    }
    if (receipt.status !== 1) {
      throw new KeeperHubError(
        `broadcastSigned: tx ${tx.hash} reverted (status=${receipt.status})`,
      );
    }
    const confirmedAt = Date.now();
    return {
      txHash: receipt.hash,
      receipt,
      auditTrail: {
        txHash: receipt.hash,
        submittedAt,
        confirmedAt,
        retryCount: 0,
        gasUsed: receipt.gasUsed,
        executionPath: ['sigil-sdk', 'json-rpc-provider'],
      },
    };
  }

  private async broadcastViaKeeperHub(params: BroadcastParams): Promise<BroadcastResult> {
    if (!this.broadcastPath) {
      throw new KeeperHubError(
        'broadcastViaKeeperHub: broadcastPath unset — should be unreachable',
      );
    }
    const url = `${this.apiBaseUrl.replace(/\/+$/, '')}${this.broadcastPath}`;
    const submittedAt = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ signedTx: params.signedTx, passportId: params.passportId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new KeeperHubError(
        `KeeperHub broadcast HTTP ${res.status}: ${text.slice(0, 500)}`,
      );
    }
    const body = (await res.json()) as { txHash?: string };
    if (!body.txHash) {
      throw new KeeperHubError(
        `KeeperHub broadcast returned no txHash: ${JSON.stringify(body).slice(0, 300)}`,
      );
    }
    const txHash = body.txHash;
    logger.info(
      { txHash, passportId: params.passportId, route: 'keeperhub' },
      'KeeperHub: broadcast (keeperhub relayer)',
    );
    const receipt = await waitForReceipt(params.provider, txHash, this.confirmationTimeoutMs);
    if (receipt.status !== 1) {
      throw new KeeperHubError(`KeeperHub-routed tx ${txHash} reverted (status=${receipt.status})`);
    }
    const confirmedAt = Date.now();
    return {
      txHash,
      receipt,
      auditTrail: {
        txHash,
        submittedAt,
        confirmedAt,
        retryCount: 0,
        gasUsed: receipt.gasUsed,
        executionPath: ['sigil-sdk', 'keeperhub-relayer', 'json-rpc-provider'],
      },
    };
  }

  /**
   * Look up an audit entry for a previously broadcast tx. With the direct
   * path this just rebuilds it from the on-chain receipt; with the KeeperHub
   * path it would call the docs-gated audit endpoint (deferred — see file
   * header).
   */
  async getAuditTrail(
    txHash: string,
    provider: JsonRpcProvider,
  ): Promise<KeeperHubAuditEntry> {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      throw new KeeperHubError(`getAuditTrail: no receipt for ${txHash}`);
    }
    const block = await provider.getBlock(receipt.blockNumber);
    const confirmedAt = block ? Number(block.timestamp) * 1000 : Date.now();
    return {
      txHash,
      submittedAt: confirmedAt,
      confirmedAt,
      retryCount: 0,
      gasUsed: receipt.gasUsed,
      executionPath: this.usesKeeperHubBroadcast
        ? ['keeperhub-relayer', 'json-rpc-provider']
        : ['json-rpc-provider'],
    };
  }
}

async function waitForReceipt(
  provider: JsonRpcProvider,
  txHash: string,
  timeoutMs: number,
): Promise<TransactionReceipt> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await provider.getTransactionReceipt(txHash);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new KeeperHubError(`waitForReceipt: ${txHash} not confirmed within ${timeoutMs}ms`);
}
