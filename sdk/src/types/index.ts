/**
 * Sigil Protocol — shared TypeScript types.
 *
 * Memory Conservation Rule 4: every shared type lives here. Import, never
 * redeclare. Mirrors the on-chain SigilTypes.sol layout but in TS-friendly
 * shapes.
 */

import type { BytesLike } from 'ethers';

// ---------------------------------------------------------------------------
// Enums (values match Solidity ordering)
// ---------------------------------------------------------------------------

export enum AttestationType {
  DEFI_REBALANCE = 0,
  CODE_AUDIT = 1,
  RISK_ASSESSMENT = 2,
  DATA_ENRICHMENT = 3,
  GOVERNANCE_VOTE = 4,
  GENERIC_TASK = 5,
}

export enum ArtifactType {
  CODE_AUDIT = 0,
  CONTRACT_CLAUSE = 1,
  RISK_ASSESSMENT = 2,
  FINANCIAL_MODEL = 3,
  DUE_DILIGENCE = 4,
  GOVERNANCE_ANALYSIS = 5,
  GENERIC_REPORT = 6,
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** 0x-prefixed 32-byte hex string. */
export type PassportId = `0x${string}`;
export type RecordId = `0x${string}`;
export type Hex32 = `0x${string}`;

// ---------------------------------------------------------------------------
// On-chain shapes
// ---------------------------------------------------------------------------

export interface PassportRecord {
  passportId: PassportId;
  tokenId: bigint;
  principal: string;
  agentAddress: string;
  createdAt: bigint;
  createdBlock: bigint;
  permissionManifestHash: Hex32;
  reputationScore: bigint;
  taskCount: bigint;
  failureCount: bigint;
  provenanceRecordCount: bigint;
  executionFingerprintCount: bigint;
  active: boolean;
}

export interface ProvenanceRecord {
  recordId: RecordId;
  passportId: PassportId;
  principal: string;
  agent: string;
  modelFingerprintHash: Hex32;
  modelId: string;
  inputContextHash: Hex32;
  inputContextSize: bigint;
  outputHash: Hex32;
  artifactType: ArtifactType;
  agentSignature: BytesLike;
  nonce: bigint;
  timestamp: bigint;
  blockNumber: bigint;
  executionFingerprintRef: Hex32;
}

// ---------------------------------------------------------------------------
// Off-chain shapes
// ---------------------------------------------------------------------------

/**
 * The encrypted permission manifest stored in 0G Storage KV. Plain-text shape
 * before encryption is `PermissionManifestPlain`; the bytes written to KV are
 * AES-256-GCM ciphertext of `JSON.stringify(plain)`.
 */
export interface PermissionManifestPlain {
  version: '1';
  agentDescription: string;
  whitelistedContracts: string[];
  maxTxValuePerWindow: Record<string, number>;
  authorizedApis: string[];
  allowedTokens: string[];
  timeWindowSeconds: number;
}

/** Sealed inference receipt from 0G Compute. */
export interface SealedInferenceReceipt {
  modelId: string;
  modelVersionHash: string;
  inputHash: string;
  outputHash: string;
  proof: string;
  timestamp: number;
}

export interface LogEntry {
  index: number;
  passportId: PassportId;
  type: 'fingerprint' | 'attestation' | 'provenance' | 'genesis';
  payload: unknown;
  timestamp: number;
}

export interface KeeperHubAuditEntry {
  txHash: string;
  submittedAt: number;
  confirmedAt: number;
  retryCount: number;
  gasUsed: bigint;
  executionPath: string[];
}

// ---------------------------------------------------------------------------
// SDK config
// ---------------------------------------------------------------------------

export interface SigilClientConfig {
  rpcUrl: string;
  chainId: number;
  registryAddress: string;
  notaryAddress: string;
  keeperHubApiKey?: string;
  /** Optional override; defaults are read from `config/networks.ts`. */
  storageRpcUrl?: string;
  computeRpcUrl?: string;
  computeDefaultModel?: string;
}
