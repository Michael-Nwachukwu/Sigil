/**
 * Sigil Protocol — passport-related helpers.
 */

import { AbiCoder, keccak256 } from 'ethers';
import type { Hex32, PassportId } from '../types/index';

const abi = AbiCoder.defaultAbiCoder();

/**
 * Compute the canonical PassportID:
 *   keccak256(abi.encode(principal, agentAddress, blockNumber, nonce))
 *
 * Per the Decisions section, this MUST be derived client-side and passed
 * into `register()` so the same value can namespace the encrypted manifest
 * in 0G Storage KV BEFORE the on-chain call lands.
 */
export function derivePassportId(params: {
  principal: string;
  agentAddress: string;
  blockNumber: number | bigint;
  nonce: number | bigint;
}): PassportId {
  const encoded = abi.encode(
    ['address', 'address', 'uint256', 'uint256'],
    [params.principal, params.agentAddress, params.blockNumber, params.nonce],
  );
  return keccak256(encoded) as PassportId;
}

/** 0G Storage KV key namespace for a passport's encrypted manifest. */
export function manifestKvKey(passportId: PassportId): string {
  return `sigil::${passportId.toLowerCase()}::manifest`;
}

/** 0G Storage KV key namespace for a passport's input-context payloads. */
export function inputContextKvKey(passportId: PassportId, outputHash: Hex32): string {
  return `sigil::${passportId.toLowerCase()}::input::${outputHash.toLowerCase()}`;
}

/** 0G Storage Log stream id for a passport. */
export function logStreamId(passportId: PassportId): string {
  return `sigil-log-${passportId.toLowerCase()}`;
}

/**
 * Encode a 0G Storage rootHash as the on-chain `metadataUri` string. We use a
 * scheme prefix so the protocol can support other backends later without
 * ambiguity. The rootHash itself is content-addressed — re-uploading the same
 * bytes always yields the same URI.
 */
export function encodeStorageUri(rootHash: string): string {
  if (!rootHash.startsWith('0x')) {
    throw new Error(`encodeStorageUri: rootHash must be 0x-prefixed (got "${rootHash}")`);
  }
  return `og-storage:${rootHash.toLowerCase()}`;
}

/** Inverse of `encodeStorageUri`. Returns null for unknown schemes. */
export function decodeStorageUri(uri: string): string | null {
  if (!uri.startsWith('og-storage:')) return null;
  const root = uri.slice('og-storage:'.length);
  return root.startsWith('0x') ? root : null;
}
