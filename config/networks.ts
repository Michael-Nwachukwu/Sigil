/**
 * Sigil Protocol — Network Configuration
 * ----------------------------------------------------------------------------
 * Single source of truth for chain IDs, RPC URLs, explorer URLs, and 0G
 * Compute model IDs. Anti-Hallucination Rule 6: never hardcode any of these
 * inline; always import from this file.
 *
 * All values verified against:
 *   - https://docs.0g.ai (testnet section)
 *   - https://docs.0g.ai/developer-hub/building-on-0g/compute-network/inference
 * during Phase 0 (2026-04-28).
 */

export type SigilNetworkName = 'galileo-testnet' | 'mainnet';

export interface SigilNetwork {
  readonly name: SigilNetworkName;
  readonly displayName: string;
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  readonly faucetUrl?: string;
  /**
   * 0G Compute model IDs available on this network. The first entry is the
   * default model for demo agents. Phase 0 verification confirmed only
   * `qwen-2.5-7b-instruct` and `qwen-image-edit-2511` are live on testnet.
   */
  readonly computeModels: readonly string[];
}

export const NETWORKS: Record<SigilNetworkName, SigilNetwork> = {
  'galileo-testnet': {
    name: 'galileo-testnet',
    displayName: '0G Galileo Testnet',
    chainId: 16602,
    rpcUrl: 'https://evmrpc-testnet.0g.ai',
    explorerUrl: 'https://chainscan-galileo.0g.ai',
    faucetUrl: 'https://faucet.0g.ai',
    computeModels: ['qwen-2.5-7b-instruct', 'qwen-image-edit-2511'] as const,
  },
  // Mainnet config kept here as a placeholder. We are NOT deploying to
  // mainnet for the hackathon; this block exists so the type system enforces
  // we don't accidentally hardcode mainnet values elsewhere.
  mainnet: {
    name: 'mainnet',
    displayName: '0G Mainnet',
    chainId: 0, // TODO: fill when 0G mainnet ships and chain ID is published
    rpcUrl: '',
    explorerUrl: '',
    computeModels: [] as const,
  },
} as const;

/**
 * Get a network by name. Throws if the network is unknown — preferred over
 * silent `undefined` returns so misconfigurations fail loudly.
 */
export function getNetwork(name: SigilNetworkName): SigilNetwork {
  const network = NETWORKS[name];
  if (!network) {
    throw new Error(`Unknown network: ${name}`);
  }
  return network;
}

/**
 * Default network for the hackathon submission. Override via env when needed.
 */
export const DEFAULT_NETWORK: SigilNetwork = NETWORKS['galileo-testnet'];

/**
 * Default model used by demo agents and SDK examples. Verified live on
 * testnet during Phase 0.
 */
export const DEFAULT_COMPUTE_MODEL = 'qwen-2.5-7b-instruct' as const;
