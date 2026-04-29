/**
 * Sigil Protocol — provenance helpers (EIP-712).
 *
 * The on-chain ProvenanceNotary expects:
 *   domain    = { name: 'SigilProvenanceNotary', version: '1',
 *                 chainId, verifyingContract }
 *   typehash  = keccak256(
 *                "Notarization(bytes32 passportId,bytes32 outputHash,
 *                              bytes32 inputContextHash,bytes32 modelFingerprintHash,
 *                              uint256 nonce,uint256 timestamp)")
 *
 * The agent (NOT the principal) signs this typed data. The contract verifies
 * the recovered address equals msg.sender and equals the registered agent
 * address for the passport.
 */

import type { Signer, TypedDataDomain, TypedDataField } from 'ethers';
import type { Hex32, PassportId } from '../types/index';

export const NOTARIZATION_DOMAIN_NAME = 'SigilProvenanceNotary';
export const NOTARIZATION_DOMAIN_VERSION = '1';

export const NOTARIZATION_TYPES: Record<string, TypedDataField[]> = {
  Notarization: [
    { name: 'passportId', type: 'bytes32' },
    { name: 'outputHash', type: 'bytes32' },
    { name: 'inputContextHash', type: 'bytes32' },
    { name: 'modelFingerprintHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

export interface NotarizationTypedValue {
  passportId: PassportId;
  outputHash: Hex32;
  inputContextHash: Hex32;
  modelFingerprintHash: Hex32;
  nonce: bigint;
  timestamp: bigint;
}

export function buildDomain(chainId: number, notaryAddress: string): TypedDataDomain {
  return {
    name: NOTARIZATION_DOMAIN_NAME,
    version: NOTARIZATION_DOMAIN_VERSION,
    chainId,
    verifyingContract: notaryAddress,
  };
}

/** Sign a Notarization payload with an agent wallet. */
export async function signNotarization(params: {
  agent: Signer;
  chainId: number;
  notaryAddress: string;
  value: NotarizationTypedValue;
}): Promise<string> {
  const domain = buildDomain(params.chainId, params.notaryAddress);
  return params.agent.signTypedData(domain, NOTARIZATION_TYPES, params.value);
}
