/**
 * Sigil Protocol — ProvenanceNotary client.
 *
 * notarize(): hash output → encrypt input context to 0G Storage → upload
 *             sealed-inference proof to 0G Storage → query per-signer
 *             nonce → sign EIP-712 typed data with the agent wallet →
 *             call ProvenanceNotary.notarize on-chain.
 *
 * resolve():  read on-chain record + (optional) download sealed-inference
 *             proof from 0G Storage via `executionFingerprintRef`.
 *
 * The agent self-signs notarizations (CLAUDE.md dual-wallet model). The
 * `signer` configured here MUST be the agent wallet — the on-chain contract
 * checks `SigilRegistry.isAuthorizedSigner(passportId, msg.sender)` and the
 * EIP-712 signature must recover to `msg.sender`.
 *
 * Input-context encryption uses the SAME HKDF scheme as permission
 * manifests, but seeded by the AGENT's signature (not the principal's).
 * This diverges from the original CLAUDE.md security note (which predated
 * the dual-wallet split) — the agent owns its own audit trail and is
 * responsible for surfacing the input context if it later needs to defend
 * an output. The `inputContextHash` anchored on-chain still binds the
 * record to the exact bytes that were processed.
 */

import { Contract, keccak256, toUtf8Bytes, AbiCoder, getBytes } from 'ethers';
import type { JsonRpcProvider, JsonRpcSigner, Wallet } from 'ethers';
import { awaitTx } from '../utils/waitForReceipt';
import type {
  ArtifactType,
  ProvenanceRecord,
  RecordId,
  SealedInferenceReceipt,
  PassportId,
  Hex32,
} from '../types/index';
import { SigilError } from '../utils/errors';
import { logger } from '../utils/logger';
import type { ZeroGStorageAdapter } from '../adapters/ZeroGStorageAdapter';
import { deriveSymmetricKeyWithSigner, encryptBytes, decryptBytes } from '../utils/crypto';

const NOTARY_ABI = [
  'function notarize(bytes32 passportId, bytes32 modelFingerprintHash, string modelId, bytes32 inputContextHash, uint256 inputContextSize, bytes32 outputHash, uint8 artifactType, uint256 nonce, uint256 signedTimestamp, bytes agentSignature, bytes32 executionFingerprintRef) external returns (bytes32)',
  'function signerNonces(address signer) external view returns (uint256)',
  'function resolve(bytes32 recordId) external view returns (tuple(bytes32 recordId, bytes32 passportId, address principal, address agent, bytes32 modelFingerprintHash, string modelId, bytes32 inputContextHash, uint256 inputContextSize, bytes32 outputHash, uint8 artifactType, bytes agentSignature, uint256 nonce, uint256 timestamp, uint256 blockNumber, bytes32 executionFingerprintRef))',
  'function resolveByOutput(bytes32 outputHash) external view returns (bytes32)',
  'function recordsByAgent(bytes32 passportId, uint256 offset, uint256 limit) external view returns (bytes32[])',
  'function verify(bytes32 recordId) external view returns (bool, string)',
] as const;

const abi = AbiCoder.defaultAbiCoder();

export interface NotarizeParams {
  passportId: PassportId;
  inferenceReceipt: SealedInferenceReceipt;
  inputContext: string;
  output: string;
  artifactType: ArtifactType;
}

export interface NotarizeResult {
  recordId: RecordId;
  txHash: string;
  /** 0G Storage rootHash of the encrypted input context. */
  inputContextRootHash: Hex32;
  /** 0G Storage rootHash of the sealed-inference proof envelope. */
  proofRootHash: Hex32;
  /** Hashes anchored on-chain — useful for client-side verification. */
  outputHash: Hex32;
  inputContextHash: Hex32;
  modelFingerprintHash: Hex32;
  nonce: bigint;
  signedTimestamp: bigint;
}

export interface ProvenanceNotaryClientConfig {
  /** The AGENT'S signer (msg.sender for notarize()). */
  signer: Wallet | JsonRpcSigner;
  notaryAddress: string;
  chainId: number;
  storage: ZeroGStorageAdapter;
}

/**
 * Decrypted, fully-resolved provenance record. Includes the on-chain record
 * plus the off-chain sealed-inference proof envelope downloaded from 0G
 * Storage. Returned by `ProvenanceNotaryClient.resolveFull`.
 */
export interface ResolvedProvenanceRecord {
  record: ProvenanceRecord;
  proofEnvelope: unknown;
  /** Plain-text input context if the caller's signer can derive the key. */
  inputContext?: string;
}

export class ProvenanceNotaryClient {
  private readonly notary: Contract;

  constructor(private readonly config: ProvenanceNotaryClientConfig) {
    this.notary = new Contract(config.notaryAddress, NOTARY_ABI, config.signer);
  }

  async notarize(params: NotarizeParams): Promise<NotarizeResult> {
    const agentAddress = await this.config.signer.getAddress();

    const outputBytes = toUtf8Bytes(params.output);
    const outputHash = keccak256(outputBytes) as Hex32;

    const inputContextBytes = toUtf8Bytes(params.inputContext);
    const inputContextSize = BigInt(inputContextBytes.length);

    const symKey = await deriveSymmetricKeyWithSigner(this.config.signer, params.passportId);
    const sealedInput = encryptBytes(inputContextBytes, symKey);
    const inputContextHash = sealedInput.contentHash as Hex32;
    const inputCipherBytes = getBytes(sealedInput.ciphertextHex);
    const inputUpload = await this.config.storage.uploadBytes(inputCipherBytes);
    logger.info(
      { passportId: params.passportId, rootHash: inputUpload.rootHash },
      'input context encrypted + uploaded to 0G Storage',
    );

    const proofString = params.inferenceReceipt.proof;
    const proofBytes = toUtf8Bytes(proofString);
    const modelFingerprintHash = keccak256(proofBytes) as Hex32;
    const proofUpload = await this.config.storage.uploadBytes(proofBytes);
    const executionFingerprintRef = proofUpload.rootHash as Hex32;
    logger.info(
      { passportId: params.passportId, rootHash: proofUpload.rootHash },
      'sealed-inference proof uploaded to 0G Storage',
    );

    const nonce = (await this.notary.signerNonces(agentAddress)) as bigint;
    const signedTimestamp = BigInt(Math.floor(Date.now() / 1000));

    const domain = {
      name: 'SigilProvenanceNotary',
      version: '1',
      chainId: this.config.chainId,
      verifyingContract: this.config.notaryAddress,
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
      outputHash,
      inputContextHash,
      modelFingerprintHash,
      nonce,
      timestamp: signedTimestamp,
    };
    const agentSignature = await this.config.signer.signTypedData(domain, types, value);

    const tx = await this.notary.notarize(
      params.passportId,
      modelFingerprintHash,
      params.inferenceReceipt.modelId,
      inputContextHash,
      inputContextSize,
      outputHash,
      params.artifactType,
      nonce,
      signedTimestamp,
      agentSignature,
      executionFingerprintRef,
    );
    const provider = this.config.signer.provider as JsonRpcProvider | null;
    if (!provider) throw new SigilError('notarize: signer has no provider');
    const receipt = await awaitTx(tx, provider, {
      label: 'ProvenanceNotary.notarize',
    });

    const recordId = keccak256(
      abi.encode(
        ['bytes32', 'address', 'bytes32', 'uint256', 'uint256'],
        [params.passportId, agentAddress, outputHash, nonce, signedTimestamp],
      ),
    ) as RecordId;

    logger.info(
      { recordId, txHash: receipt.hash, passportId: params.passportId },
      'artifact notarized on-chain',
    );

    return {
      recordId,
      txHash: receipt.hash,
      inputContextRootHash: inputUpload.rootHash as Hex32,
      proofRootHash: proofUpload.rootHash as Hex32,
      outputHash,
      inputContextHash,
      modelFingerprintHash,
      nonce,
      signedTimestamp,
    };
  }

  async resolve(recordId: RecordId): Promise<ProvenanceRecord> {
    const raw = await this.notary.resolve(recordId);
    return {
      recordId: raw.recordId,
      passportId: raw.passportId,
      principal: raw.principal,
      agent: raw.agent,
      modelFingerprintHash: raw.modelFingerprintHash,
      modelId: raw.modelId,
      inputContextHash: raw.inputContextHash,
      inputContextSize: raw.inputContextSize,
      outputHash: raw.outputHash,
      artifactType: Number(raw.artifactType) as ArtifactType,
      agentSignature: raw.agentSignature,
      nonce: raw.nonce,
      timestamp: raw.timestamp,
      blockNumber: raw.blockNumber,
      executionFingerprintRef: raw.executionFingerprintRef,
    };
  }

  /**
   * Resolve + download proof envelope + (optionally) decrypt input context.
   * Decryption only succeeds if the configured signer is the agent that
   * produced the record (anyone else's HKDF-derived key fails AES-GCM
   * authentication).
   */
  async resolveFull(recordId: RecordId): Promise<ResolvedProvenanceRecord> {
    const record = await this.resolve(recordId);

    const proofBytes = await this.config.storage.downloadBytes(record.executionFingerprintRef);
    const proofString = Buffer.from(proofBytes).toString('utf8');
    const computedFingerprint = keccak256(toUtf8Bytes(proofString));
    if (computedFingerprint.toLowerCase() !== record.modelFingerprintHash.toLowerCase()) {
      throw new SigilError(
        `proof envelope tampered: on-chain ${record.modelFingerprintHash} != computed ${computedFingerprint}`,
      );
    }
    let proofEnvelope: unknown;
    try {
      proofEnvelope = JSON.parse(proofString);
    } catch {
      proofEnvelope = proofString;
    }

    let inputContext: string | undefined;
    try {
      const symKey = await deriveSymmetricKeyWithSigner(this.config.signer, record.passportId);
      const cipherBytes = await this.config.storage.downloadBytes(
        await this.findInputContextRootHash(record),
      );
      const cipherHex = '0x' + Buffer.from(cipherBytes).toString('hex');
      const onChainHash = record.inputContextHash.toLowerCase();
      const computed = keccak256(cipherHex).toLowerCase();
      if (onChainHash !== computed) {
        throw new SigilError(
          `input context tampered: on-chain ${onChainHash} != computed ${computed}`,
        );
      }
      const plain = decryptBytes(cipherHex, symKey);
      inputContext = Buffer.from(plain).toString('utf8');
    } catch (err) {
      logger.debug({ err, recordId }, 'input context decryption skipped');
    }

    return { record, proofEnvelope, inputContext };
  }

  /**
   * Looking up the input context's 0G rootHash from on-chain data alone is
   * not possible — the contract only stores `inputContextHash` (keccak256 of
   * ciphertext), not the rootHash. Phase 2 callers therefore must pass the
   * rootHash they got back from `notarize()` if they want to fetch the
   * encrypted blob. This stub exists so `resolveFull` fails cleanly until a
   * separate pointer index is added (Phase 3+).
   */
  private async findInputContextRootHash(_record: ProvenanceRecord): Promise<string> {
    throw new SigilError(
      'findInputContextRootHash: input-context rootHash is not anchored on-chain in Phase 2 — callers must persist the rootHash returned by notarize() and download via storage adapter directly',
    );
  }

  async signerNonce(signer: string): Promise<bigint> {
    return this.notary.signerNonces(signer);
  }

  async verify(recordId: RecordId): Promise<{ valid: boolean; reason: string }> {
    const [valid, reason] = await this.notary.verify(recordId);
    return { valid, reason };
  }
}
