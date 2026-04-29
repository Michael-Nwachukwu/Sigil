/**
 * Sigil Protocol — 0G Storage adapter.
 *
 * Sigil uses 0G Storage as content-addressed storage: encrypted blobs are
 * uploaded and the returned `rootHash` is what the protocol references on
 * chain (in `PassportRecord.metadataUri` for permission manifests, in
 * `ProvenanceRecord.modelFingerprintHash` for sealed inference proofs, and
 * via the input-context URI for encrypted input contexts).
 *
 * Why not 0G KV: the canonical Galileo testnet KV node URL documented in the
 * 0G TS SDK README (`http://3.101.147.150:6789`) was unreachable during
 * Phase 1 verification (2026-04-29). The storage indexer + file flow is
 * fully reachable and gives us the same property we actually need
 * (decoupling on-chain identity from off-chain payload), without requiring
 * a separately reachable KV cluster.
 *
 * Anti-Hallucination Rule 3: every read/write hits real 0G Storage.
 */

import type { Signer } from 'ethers';
import { Indexer, MemData } from '@0gfoundation/0g-ts-sdk';
import { ZeroGError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface ZeroGStorageAdapterConfig {
  /** Indexer JSON-RPC URL, e.g. `https://indexer-storage-testnet-turbo.0g.ai`. */
  indexerUrl: string;
  /** EVM RPC for the storage flow contract, e.g. `https://evmrpc-testnet.0g.ai`. */
  evmRpc: string;
  /** Signer used to pay storage fees + submit upload txs. */
  signer: Signer;
  /** How many full replicas to require from the indexer. Default 1 (testnet). */
  expectedReplica?: number;
}

export interface UploadResult {
  /** 0G Storage merkle root hash (`0x…64hex`). Stored on-chain to reference the blob. */
  rootHash: string;
  /** Submission tx hash. */
  txHash: string;
}

export class ZeroGStorageAdapter {
  private readonly indexer: Indexer;
  private readonly evmRpc: string;
  private readonly signer: Signer;
  private readonly expectedReplica: number;

  constructor(config: ZeroGStorageAdapterConfig) {
    if (!config.indexerUrl) throw new ZeroGError('ZeroGStorageAdapter: indexerUrl required');
    if (!config.evmRpc) throw new ZeroGError('ZeroGStorageAdapter: evmRpc required');
    if (!config.signer) throw new ZeroGError('ZeroGStorageAdapter: signer required');
    this.indexer = new Indexer(config.indexerUrl);
    this.evmRpc = config.evmRpc;
    this.signer = config.signer;
    this.expectedReplica = config.expectedReplica ?? 1;
  }

  /**
   * Upload an in-memory blob and return its content-addressed rootHash.
   * The same bytes always produce the same rootHash, so re-uploading is a no-op.
   */
  async uploadBytes(bytes: Uint8Array): Promise<UploadResult> {
    if (!bytes || bytes.length === 0) {
      throw new ZeroGError('ZeroGStorageAdapter.uploadBytes: empty payload');
    }
    const file = new MemData(bytes);
    const [tx, err] = await this.indexer.upload(file, this.evmRpc, this.signer);
    if (err) {
      logger.error({ err }, 'ZeroGStorageAdapter.uploadBytes failed');
      throw new ZeroGError(`uploadBytes: ${err.message}`, err);
    }
    if (!tx) {
      throw new ZeroGError('uploadBytes: indexer.upload returned no tx');
    }
    // Indexer.upload's union return: single-file branch has `txHash`+`rootHash`.
    if ('rootHash' in tx && 'txHash' in tx) {
      return { rootHash: tx.rootHash, txHash: tx.txHash };
    }
    // Multi-segment branch — first entry is the canonical one for our payload.
    if ('rootHashes' in tx && 'txHashes' in tx) {
      return { rootHash: tx.rootHashes[0], txHash: tx.txHashes[0] };
    }
    throw new ZeroGError('uploadBytes: unexpected tx shape from indexer.upload');
  }

  /**
   * Fetch a blob by rootHash. Browser- and Node-safe (uses Blob, not fs).
   * `proof: false` — full merkle-proof verification is overkill for our small
   * encrypted payloads, and the AES-GCM auth tag already detects tampering.
   */
  async downloadBytes(rootHash: string): Promise<Uint8Array> {
    if (!rootHash || !rootHash.startsWith('0x')) {
      throw new ZeroGError(`downloadBytes: bad rootHash "${rootHash}"`);
    }
    const [blob, err] = await this.indexer.downloadToBlob(rootHash);
    if (err) {
      logger.error({ err, rootHash }, 'ZeroGStorageAdapter.downloadBytes failed');
      throw new ZeroGError(`downloadBytes: ${err.message}`, err);
    }
    if (!blob) {
      throw new ZeroGError(`downloadBytes: no blob returned for ${rootHash}`);
    }
    return new Uint8Array(await blob.arrayBuffer());
  }
}
