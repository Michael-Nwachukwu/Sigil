import { ethers } from 'hardhat';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

/// Build the canonical client-side passportId derivation:
///   keccak256(abi.encode(principal, agentAddress, blockNumber, nonce))
export function derivePassportId(
  principal: string,
  agentAddress: string,
  blockNumber: number | bigint,
  nonce: number | bigint,
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['address', 'address', 'uint256', 'uint256'],
      [principal, agentAddress, blockNumber, nonce],
    ),
  );
}

/// Sign the EIP-712 Notarization payload with the agent's wallet.
export async function signNotarization(params: {
  agent: HardhatEthersSigner;
  notaryAddress: string;
  chainId: number | bigint;
  passportId: string;
  outputHash: string;
  inputContextHash: string;
  modelFingerprintHash: string;
  nonce: number | bigint;
  timestamp: number | bigint;
}): Promise<string> {
  const domain = {
    name: 'SigilProvenanceNotary',
    version: '1',
    chainId: Number(params.chainId),
    verifyingContract: params.notaryAddress,
  };

  const types = {
    Notarization: [
      { name: 'passportId', type: 'bytes32' },
      { name: 'outputHash', type: 'bytes32' },
      { name: 'inputContextHash', type: 'bytes32' },
      { name: 'modelFingerprintHash', type: 'bytes32' },
      { name: 'nonce', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' },
    ],
  };

  const value = {
    passportId: params.passportId,
    outputHash: params.outputHash,
    inputContextHash: params.inputContextHash,
    modelFingerprintHash: params.modelFingerprintHash,
    nonce: params.nonce,
    timestamp: params.timestamp,
  };

  return params.agent.signTypedData(domain, types, value);
}

export const ATTESTATION = {
  DEFI_REBALANCE: 0,
  CODE_AUDIT: 1,
  RISK_ASSESSMENT: 2,
  DATA_ENRICHMENT: 3,
  GOVERNANCE_VOTE: 4,
  GENERIC_TASK: 5,
} as const;

export const ARTIFACT = {
  CODE_AUDIT: 0,
  CONTRACT_CLAUSE: 1,
  RISK_ASSESSMENT: 2,
  FINANCIAL_MODEL: 3,
  DUE_DILIGENCE: 4,
  GOVERNANCE_ANALYSIS: 5,
  GENERIC_REPORT: 6,
} as const;
