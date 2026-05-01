/**
 * Sigil Protocol — main SDK entry point.
 *
 * Wires up the sub-clients (`passport`, `provenance`) and adapters
 * (`storage`, `compute`, `keeperHub`) from a single principal-side or
 * agent-side signer.
 */

import type { JsonRpcSigner, Wallet } from 'ethers';
import { AgentPassportClient } from './passport/AgentPassport';
import { AutoAttestSidecar } from './passport/AutoAttest';
import { ProvenanceNotaryClient } from './provenance/ProvenanceNotary';
import { ZeroGStorageAdapter } from './adapters/ZeroGStorageAdapter';
import { ZeroGComputeAdapter } from './adapters/ZeroGComputeAdapter';
import { KeeperHubAdapter } from './adapters/KeeperHubAdapter';
import type { SigilClientConfig } from './types/index';

/**
 * Signer concrete enough for both `@0gfoundation/0g-ts-sdk` (storage flow tx)
 * and `@0glabs/0g-serving-broker` (ledger funding + billing headers). Either
 * an `ethers.Wallet` (preferred in Node/CLI) or a `JsonRpcSigner` (browser).
 */
export type SigilSigner = Wallet | JsonRpcSigner;

export interface SigilClientOptions extends SigilClientConfig {
  signer: SigilSigner;
  /** 0G Storage indexer URL. Defaults to Galileo turbo. */
  storageIndexerUrl?: string;
  /**
   * Opt-in auto-attest sidecar — DEMO ONLY. When set, every successful
   * `provenance.notarize()` is followed by a relay-signed
   * `appendAttestation` so the agent's reputation/taskCount move in real
   * time. Production keepers attach attestations out-of-band.
   */
  autoAttest?: {
    /** Wallet whose address has been added as a keeper relay on-chain. */
    relaySigner: SigilSigner;
    /** Mark every attestation passed (default true). */
    defaultPassed?: boolean;
  };
}

const DEFAULT_INDEXER_URL = 'https://indexer-storage-testnet-turbo.0g.ai';

export class SigilClient {
  public readonly passport: AgentPassportClient;
  public readonly provenance: ProvenanceNotaryClient;
  public readonly storage: ZeroGStorageAdapter;
  public readonly compute: ZeroGComputeAdapter;
  public readonly keeperHub: KeeperHubAdapter | undefined;

  constructor(options: SigilClientOptions) {
    this.storage = new ZeroGStorageAdapter({
      indexerUrl: options.storageIndexerUrl ?? DEFAULT_INDEXER_URL,
      evmRpc: options.rpcUrl,
      signer: options.signer,
    });
    this.compute = new ZeroGComputeAdapter({
      signer: options.signer,
      defaultModel: options.computeDefaultModel,
    });
    this.keeperHub = options.keeperHubApiKey
      ? new KeeperHubAdapter({ apiKey: options.keeperHubApiKey })
      : undefined;
    this.passport = new AgentPassportClient({
      signer: options.signer,
      registryAddress: options.registryAddress,
      storage: this.storage,
    });
    const autoAttest = options.autoAttest
      ? new AutoAttestSidecar({
          relaySigner: options.autoAttest.relaySigner,
          registryAddress: options.registryAddress,
          defaultPassed: options.autoAttest.defaultPassed,
        })
      : undefined;
    this.provenance = new ProvenanceNotaryClient({
      signer: options.signer,
      notaryAddress: options.notaryAddress,
      chainId: options.chainId,
      storage: this.storage,
      autoAttest,
    });
  }
}
