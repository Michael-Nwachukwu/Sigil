/**
 * Sigil Protocol — auto-attest sidecar.
 *
 * Production keepers attach `CapabilityAttestation`s out-of-band after
 * verifying an agent's work against a benchmark. For the demo we want
 * counters and reputation to move in real time, so the SDK ships an
 * opt-in sidecar that fires `SigilRegistry.appendAttestation()` immediately
 * after every successful `ProvenanceNotaryClient.notarize()`.
 *
 * IMPORTANT: this is a DEMO SIMULATOR. The sidecar marks every attestation
 * `passed = true` — there is no real verification of the artifact happening
 * here. Anyone using Sigil in production should disable this and wire a real
 * verification pipeline behind a keeper relay.
 *
 * The relay signer's address must already be registered on-chain via
 * `SigilRegistry.addRelay()` (owner-only). Without that, the
 * `onlyKeeperRelay` modifier reverts the call.
 */

import { Contract } from 'ethers';
import type { JsonRpcProvider, JsonRpcSigner, Wallet } from 'ethers';
import { awaitTx } from '../utils/waitForReceipt';
import { logger } from '../utils/logger';
import { SigilError } from '../utils/errors';
import { ArtifactType, AttestationType, type Hex32, type PassportId } from '../types/index';

const REGISTRY_ABI = [
  'function appendAttestation(bytes32 passportId, uint8 attestationType, bool passed, bytes32 dataHash) external',
] as const;

export interface AutoAttestSidecarConfig {
  /** Wallet whose address is registered as a keeper relay on SigilRegistry. */
  relaySigner: Wallet | JsonRpcSigner;
  registryAddress: string;
  /**
   * Default `passed` value when the caller doesn't override per-attestation.
   * Defaults to `true` for the demo. Set `false` to mark every attestation as
   * a failure (useful for testing reputation decay).
   */
  defaultPassed?: boolean;
}

export interface AttestationRecord {
  txHash: string;
  attestationType: AttestationType;
  passed: boolean;
  dataHash: Hex32;
  /** True for every attestation produced by this sidecar — see file header. */
  demoSimulated: true;
}

/**
 * Map a notarized artifact category onto the attestation enum that best
 * matches it, so the on-chain attestation history mirrors what the agent
 * actually does. `GENERIC_REPORT` (chat) → `GENERIC_TASK`.
 */
export function attestationForArtifact(t: ArtifactType): AttestationType {
  switch (t) {
    case ArtifactType.CODE_AUDIT:
      return AttestationType.CODE_AUDIT;
    case ArtifactType.RISK_ASSESSMENT:
    case ArtifactType.FINANCIAL_MODEL:
      return AttestationType.RISK_ASSESSMENT;
    case ArtifactType.GOVERNANCE_ANALYSIS:
      return AttestationType.GOVERNANCE_VOTE;
    case ArtifactType.DUE_DILIGENCE:
      return AttestationType.DATA_ENRICHMENT;
    case ArtifactType.CONTRACT_CLAUSE:
    case ArtifactType.GENERIC_REPORT:
    default:
      return AttestationType.GENERIC_TASK;
  }
}

export class AutoAttestSidecar {
  private readonly registry: Contract;
  private readonly defaultPassed: boolean;

  constructor(private readonly config: AutoAttestSidecarConfig) {
    this.registry = new Contract(config.registryAddress, REGISTRY_ABI, config.relaySigner);
    this.defaultPassed = config.defaultPassed ?? true;
  }

  async attest(params: {
    passportId: PassportId;
    attestationType: AttestationType;
    dataHash: Hex32;
    passed?: boolean;
  }): Promise<AttestationRecord> {
    const passed = params.passed ?? this.defaultPassed;
    const provider = this.config.relaySigner.provider as JsonRpcProvider | null;
    if (!provider) {
      throw new SigilError('AutoAttestSidecar: relay signer has no provider');
    }
    const tx = await this.registry.appendAttestation(
      params.passportId,
      params.attestationType,
      passed,
      params.dataHash,
    );
    const receipt = await awaitTx(tx, provider, {
      label: 'SigilRegistry.appendAttestation',
    });
    logger.info(
      {
        passportId: params.passportId,
        attestationType: AttestationType[params.attestationType],
        passed,
        dataHash: params.dataHash,
        txHash: receipt.hash,
        demoSimulated: true,
      },
      'auto-attest: appendAttestation confirmed',
    );
    return {
      txHash: receipt.hash,
      attestationType: params.attestationType,
      passed,
      dataHash: params.dataHash,
      demoSimulated: true,
    };
  }
}
