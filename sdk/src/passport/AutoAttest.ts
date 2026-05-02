/**
 * Sigil Protocol — auto-attest sidecar.
 *
 * Two modes:
 *
 * 1. **Direct mode** (used by chat.ts): a local relay wallet signs
 *    `appendFingerprint` + `appendAttestation` directly. Requires
 *    `SIGIL_KEEPER_RELAY_PRIVATE_KEY` and the address registered on-chain
 *    via `SigilRegistry.addRelay()`.
 *
 * 2. **KeeperHub workflow mode** (blocked by KeeperHub infra issue on 0G):
 *    posts to KeeperHub's REST API to execute the "Sigil Attest" workflow.
 *    The trigger was fixed (Webhook → Manual), input resolves correctly, and
 *    the workflow fires. However the `web3/write-contract` step times out
 *    after 5 minutes with "Step did not record completion" — the Para MPC
 *    wallet nonce stays 0, meaning no tx was ever submitted to 0G Galileo.
 *    0G Galileo is listed as a supported network in KeeperHub's dashboard
 *    but their write-contract step handler appears to not handle 0G's
 *    RPC/block-time characteristics correctly. Filed with KeeperHub support.
 *    When fixed on their side, re-enable this mode in chat.ts — no SDK
 *    changes required. Until then, use direct mode for live demos.
 *
 * In both modes the sidecar marks every attestation `passed = true` — there
 * is no real off-chain verification happening. This is the demo simulator.
 * Production systems should replace this with a real keeper pipeline.
 */

import { Contract, keccak256, AbiCoder } from 'ethers';
import type { JsonRpcProvider, JsonRpcSigner, Wallet } from 'ethers';
import { awaitTx } from '../utils/waitForReceipt';
import { logger } from '../utils/logger';
import { SigilError } from '../utils/errors';
import { ArtifactType, AttestationType, type Hex32, type PassportId } from '../types/index';

const REGISTRY_ABI = [
  'function appendFingerprint(bytes32 passportId, bytes32 fingerprintHash, bytes32 executionTxHash) external',
  'function appendAttestation(bytes32 passportId, uint8 attestationType, bool passed, bytes32 dataHash) external',
] as const;

const abi = AbiCoder.defaultAbiCoder();

// ---------------------------------------------------------------------------
// KeeperHub REST API helpers
// ---------------------------------------------------------------------------

interface KeeperHubExecution {
  id: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
  // KeeperHub returns either "steps" or "nodeStatuses" depending on endpoint
  steps?: Array<{
    nodeId: string;
    label: string;
    status: string;
    output?: Record<string, unknown>;
  }>;
  nodeStatuses?: Array<{
    nodeId: string;
    label: string;
    status: string;
    output?: Record<string, unknown>;
  }>;
}

async function khPost(
  apiBaseUrl: string,
  apiKey: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SigilError(`KeeperHub POST ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function khGet(apiBaseUrl: string, apiKey: string, path: string): Promise<unknown> {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SigilError(`KeeperHub GET ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function pollExecution(
  apiBaseUrl: string,
  apiKey: string,
  executionId: string,
  timeoutMs = 90_000,
): Promise<KeeperHubExecution> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exec = (await khGet(
      apiBaseUrl,
      apiKey,
      `/api/workflows/executions/${executionId}/status`,
    )) as KeeperHubExecution;
    if (exec.status === 'success' || exec.status === 'error' || exec.status === 'cancelled') {
      return exec;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new SigilError(`KeeperHub execution ${executionId} did not complete within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface KeeperHubAttestConfig {
  /** KEEPERHUB_API_KEY */
  apiKey: string;
  /** Workflow ID from KeeperHub (KEEPERHUB_WORKFLOW_ID) */
  workflowId: string;
  /** Defaults to https://app.keeperhub.com */
  apiBaseUrl?: string;
}

export interface DirectAttestConfig {
  /** Wallet whose address is registered as a keeper relay on SigilRegistry. */
  relaySigner: Wallet | JsonRpcSigner;
  registryAddress: string;
}

export type AutoAttestSidecarConfig = (
  | { mode: 'keeperhub'; keeperHub: KeeperHubAttestConfig; registryAddress: string }
  | { mode: 'direct'; relaySigner: Wallet | JsonRpcSigner; registryAddress: string }
) & { defaultPassed?: boolean };

export interface AttestationRecord {
  txHash: string;
  attestationType: AttestationType;
  passed: boolean;
  dataHash: Hex32;
  demoSimulated: true;
  fingerprintTxHash?: string;
  /** Set in KeeperHub mode — the KeeperHub execution ID for audit trail lookup. */
  keeperHubExecutionId?: string;
}

// ---------------------------------------------------------------------------
// Artifact → attestation type mapping
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Sidecar
// ---------------------------------------------------------------------------

export class AutoAttestSidecar {
  private readonly defaultPassed: boolean;
  private readonly registryAddress: string;
  // Direct mode
  private readonly registry: Contract | null;
  // KeeperHub mode
  private readonly kh: (KeeperHubAttestConfig & { apiBaseUrl: string }) | null;

  constructor(config: AutoAttestSidecarConfig) {
    this.defaultPassed = config.defaultPassed ?? true;
    this.registryAddress = config.registryAddress;

    if (config.mode === 'keeperhub') {
      this.registry = null;
      this.kh = {
        ...config.keeperHub,
        apiBaseUrl: config.keeperHub.apiBaseUrl ?? 'https://app.keeperhub.com',
      };
    } else {
      this.registry = new Contract(config.registryAddress, REGISTRY_ABI, config.relaySigner);
      this.kh = null;
    }
  }

  async attest(params: {
    passportId: PassportId;
    attestationType: AttestationType;
    dataHash: Hex32;
    executionTxHash?: Hex32;
    passed?: boolean;
  }): Promise<AttestationRecord> {
    const passed = params.passed ?? this.defaultPassed;

    // Derive fingerprintHash the same way in both modes
    const fingerprintHash = params.executionTxHash
      ? (keccak256(
          abi.encode(
            ['bytes32', 'uint8', 'bytes32', 'bytes32'],
            [
              params.passportId,
              params.attestationType,
              params.dataHash,
              params.executionTxHash,
            ],
          ),
        ) as Hex32)
      : undefined;

    if (this.kh) {
      return this.attestViaKeeperHub(params, passed, fingerprintHash);
    }
    return this.attestDirect(params, passed, fingerprintHash);
  }

  // -------------------------------------------------------------------------
  // KeeperHub mode
  // -------------------------------------------------------------------------

  private async attestViaKeeperHub(
    params: {
      passportId: PassportId;
      attestationType: AttestationType;
      dataHash: Hex32;
      executionTxHash?: Hex32;
    },
    passed: boolean,
    fingerprintHash: Hex32 | undefined,
  ): Promise<AttestationRecord> {
    const { apiKey, workflowId, apiBaseUrl } = this.kh!;

    const input: Record<string, unknown> = {
      passportId: params.passportId,
      attestationType: params.attestationType,
      passed,
      dataHash: params.dataHash,
      fingerprintHash: fingerprintHash ?? params.dataHash, // fallback: use dataHash
      executionTxHash: params.executionTxHash ?? params.dataHash,
    };

    logger.info(
      { workflowId, passportId: params.passportId, demoSimulated: true },
      'auto-attest: triggering KeeperHub workflow',
    );

    const execResponse = (await khPost(apiBaseUrl, apiKey, `/api/workflow/${workflowId}/execute`, {
      input,
    })) as { executionId?: string; id?: string };

    const executionId = execResponse.executionId ?? execResponse.id ?? '';
    if (!executionId) {
      throw new SigilError('KeeperHub execute returned no executionId');
    }

    logger.info(
      { executionId, workflowId, demoSimulated: true },
      'auto-attest: KeeperHub execution started, polling…',
    );

    const exec = await pollExecution(apiBaseUrl, apiKey, executionId, 90_000);

    if (exec.status !== 'success') {
      throw new SigilError(
        `KeeperHub execution ${executionId} finished with status "${exec.status}"`,
      );
    }

    // Extract tx hashes from step outputs (endpoint returns nodeStatuses or steps)
    const allSteps = exec.nodeStatuses ?? exec.steps ?? [];
    const fpStep = allSteps.find((s) => s.nodeId === 'append-fingerprint');
    const attStep = allSteps.find((s) => s.nodeId === 'append-attestation');
    const fingerprintTxHash = (fpStep?.output?.transactionHash as string) ?? undefined;
    const attestTxHash = (attStep?.output?.transactionHash as string) ?? executionId;

    logger.info(
      {
        executionId,
        passportId: params.passportId,
        attestationType: AttestationType[params.attestationType],
        passed,
        fingerprintTxHash,
        attestTxHash,
        demoSimulated: true,
      },
      'auto-attest: KeeperHub execution confirmed',
    );

    return {
      txHash: attestTxHash,
      attestationType: params.attestationType,
      passed,
      dataHash: params.dataHash,
      demoSimulated: true,
      fingerprintTxHash,
      keeperHubExecutionId: executionId,
    };
  }

  // -------------------------------------------------------------------------
  // Direct mode (legacy: local relay wallet)
  // -------------------------------------------------------------------------

  private async attestDirect(
    params: {
      passportId: PassportId;
      attestationType: AttestationType;
      dataHash: Hex32;
      executionTxHash?: Hex32;
    },
    passed: boolean,
    fingerprintHash: Hex32 | undefined,
  ): Promise<AttestationRecord> {
    const contractProvider = this.registry?.runner?.provider as JsonRpcProvider | null;
    if (!contractProvider) {
      throw new SigilError('AutoAttestSidecar (direct): relay signer has no provider');
    }

    let fingerprintTxHash: string | undefined;
    if (fingerprintHash && params.executionTxHash) {
      const fpTx = await this.registry!.appendFingerprint(
        params.passportId,
        fingerprintHash,
        params.executionTxHash,
      );
      const fpReceipt = await awaitTx(fpTx, contractProvider, {
        label: 'SigilRegistry.appendFingerprint',
        timeoutMs: 30_000,
      });
      fingerprintTxHash = fpReceipt.hash;
      logger.info(
        {
          passportId: params.passportId,
          fingerprintHash,
          executionTxHash: params.executionTxHash,
          txHash: fpReceipt.hash,
          demoSimulated: true,
        },
        'auto-attest: appendFingerprint confirmed (direct)',
      );
    }

    const tx = await this.registry!.appendAttestation(
      params.passportId,
      params.attestationType,
      passed,
      params.dataHash,
    );
    const receipt = await awaitTx(tx, contractProvider, {
      label: 'SigilRegistry.appendAttestation',
      timeoutMs: 30_000,
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
      'auto-attest: appendAttestation confirmed (direct)',
    );

    return {
      txHash: receipt.hash,
      attestationType: params.attestationType,
      passed,
      dataHash: params.dataHash,
      demoSimulated: true,
      fingerprintTxHash,
    };
  }
}
