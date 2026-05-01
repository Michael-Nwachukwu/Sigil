/**
 * Sigil Protocol — AgentPassport client.
 *
 * register(): mint fresh agent keypair → derive passportId client-side →
 *             encrypt permission manifest → upload to 0G Storage → call
 *             SigilRegistry.register on-chain (signer = principal).
 * resolve():  on-chain read of PassportRecord (anyone can call).
 * getManifest(): on-chain tokenURI lookup → 0G download → AES-GCM decrypt
 *                using the principal's signature-derived key.
 */

import type { JsonRpcProvider, Signer } from 'ethers';
import { Contract, getAddress, hexlify, keccak256, randomBytes } from 'ethers';
import type {
  PassportRecord,
  PassportId,
  PermissionManifestPlain,
} from '../types/index';
import { mintAgentKeypair } from '../utils/mintAgentKeypair';
import {
  encryptJson,
  decryptJson,
  deriveSymmetricKeyWithSigner,
} from '../utils/crypto';
import { RegistryError } from '../utils/errors';
import { logger } from '../utils/logger';
import { writeCredential } from '../utils/credentials';
import { ZeroGStorageAdapter } from '../adapters/ZeroGStorageAdapter';
import { awaitTx } from '../utils/waitForReceipt';
import {
  derivePassportId,
  encodeStorageUri,
  decodeStorageUri,
} from './PassportTypes';

const REGISTRY_ABI = [
  'function register(bytes32 passportId, address principal, address agentAddress, bytes32 permissionManifestHash, string metadataUri) external',
  'function resolve(bytes32 passportId) external view returns (tuple(bytes32 passportId, uint256 tokenId, address principal, address agentAddress, uint256 createdAt, uint256 createdBlock, bytes32 permissionManifestHash, uint256 reputationScore, uint256 taskCount, uint256 failureCount, uint256 provenanceRecordCount, uint256 executionFingerprintCount, bool active))',
  'function tokenURI(uint256 tokenId) external view returns (string)',
  'function passportOfAgent(address agent) external view returns (bytes32)',
  'function isAuthorizedSigner(bytes32 passportId, address signer) external view returns (bool)',
] as const;

export interface RegisterParams {
  /**
   * Plaintext permissions for this agent. Encrypted before it ever leaves
   * the principal's machine.
   */
  permissions: Omit<PermissionManifestPlain, 'version' | 'agentDescription'>;
  /** Free-text description (≤280 chars). Encrypted alongside permissions. */
  agentDescription: string;
  /**
   * Optional override for the registration nonce. By default we use a fresh
   * cryptographic random — the same principal can register many agents.
   */
  nonce?: bigint;
  /**
   * If set, write a discoverability credential to ~/.sigil/credentials/<persistAs>.json
   * after a successful registration. The file holds passportId, agentAddress,
   * principal, registry/notary addresses, and chainId — NEVER the private key.
   * The agent runtime can later `readCredential(persistAs)` to report its own
   * identity back to the operator without rediscovering it on-chain.
   */
  persistAs?: string;
  /**
   * Optional metadata fields written into the credential file (notaryAddress,
   * chainId, rpcUrl). Only used when `persistAs` is set. If omitted, the
   * credential file will not include these fields and downstream tooling
   * should fall back to its own config.
   */
  credentialContext?: {
    notaryAddress?: `0x${string}`;
    chainId?: number;
    rpcUrl?: string;
  };
}

export interface RegisterResult {
  passportId: PassportId;
  agentAddress: string;
  /** Returned ONCE; caller MUST persist it securely. Sigil never stores it. */
  agentPrivateKey: string;
  manifestRootHash: string;
  txHash: string;
}

export interface AgentPassportClientConfig {
  signer: Signer;
  registryAddress: string;
  storage: ZeroGStorageAdapter;
}

export class AgentPassportClient {
  private readonly registry: Contract;
  constructor(private readonly config: AgentPassportClientConfig) {
    this.registry = new Contract(config.registryAddress, REGISTRY_ABI, config.signer);
  }

  async register(params: RegisterParams): Promise<RegisterResult> {
    if (params.agentDescription.length > 280) {
      throw new RegistryError(
        `agentDescription too long (${params.agentDescription.length} > 280)`,
      );
    }

    const principalAddress = await this.config.signer.getAddress();

    const provider = this.config.signer.provider;
    if (!provider) throw new RegistryError('signer has no provider attached');

    const blockNumber = BigInt(await provider.getBlockNumber());
    const nonce = params.nonce ?? bytesToBigInt(randomBytes(32));
    const agentKeypair = mintAgentKeypair();

    const passportId = derivePassportId({
      principal: principalAddress,
      agentAddress: agentKeypair.agentAddress,
      blockNumber,
      nonce,
    });
    logger.info({ passportId, agent: agentKeypair.agentAddress }, 'derived passportId');

    const manifest: PermissionManifestPlain = {
      version: '1',
      agentDescription: params.agentDescription,
      ...params.permissions,
    };

    const symKey = await deriveSymmetricKeyWithSigner(this.config.signer, passportId);
    const sealed = encryptJson(manifest, symKey);
    const ciphertext = bytesFromHex(sealed.ciphertextHex);
    const permissionManifestHash = sealed.contentHash as `0x${string}`;

    const upload = await this.config.storage.uploadBytes(ciphertext);
    logger.info(
      { passportId, rootHash: upload.rootHash, storageTx: upload.txHash },
      'manifest uploaded to 0G Storage',
    );

    const metadataUri = encodeStorageUri(upload.rootHash);

    const tx = await this.registry.register(
      passportId,
      principalAddress,
      agentKeypair.agentAddress,
      permissionManifestHash,
      metadataUri,
    );
    const receipt = await awaitTx(tx, provider as JsonRpcProvider, {
      label: 'SigilRegistry.register',
    });
    logger.info({ passportId, txHash: receipt.hash }, 'agent passport registered');

    if (params.persistAs) {
      const ctx = params.credentialContext ?? {};
      writeCredential({
        name: params.persistAs,
        passportId: passportId as `0x${string}`,
        agentAddress: agentKeypair.agentAddress as `0x${string}`,
        principal: principalAddress as `0x${string}`,
        registry: this.config.registryAddress as `0x${string}`,
        notary: (ctx.notaryAddress ??
          ('0x0000000000000000000000000000000000000000' as `0x${string}`)),
        chainId: ctx.chainId ?? Number((await provider.getNetwork()).chainId),
        registeredAtBlock: Number(receipt.blockNumber),
        registeredAt: new Date().toISOString(),
        registerTxHash: receipt.hash as `0x${string}`,
        rpcUrl: ctx.rpcUrl,
        agentDescription: params.agentDescription,
      });
    }

    return {
      passportId,
      agentAddress: agentKeypair.agentAddress,
      agentPrivateKey: agentKeypair.agentPrivateKey,
      manifestRootHash: upload.rootHash,
      txHash: receipt.hash,
    };
  }

  async resolve(passportId: PassportId): Promise<PassportRecord> {
    const raw = await this.registry.resolve(passportId);
    if (!raw.principal || raw.principal === '0x0000000000000000000000000000000000000000') {
      throw new RegistryError(`passport not found: ${passportId}`);
    }
    return {
      passportId: raw.passportId,
      tokenId: raw.tokenId,
      principal: getAddress(raw.principal),
      agentAddress: getAddress(raw.agentAddress),
      createdAt: raw.createdAt,
      createdBlock: raw.createdBlock,
      permissionManifestHash: raw.permissionManifestHash,
      reputationScore: raw.reputationScore,
      taskCount: raw.taskCount,
      failureCount: raw.failureCount,
      provenanceRecordCount: raw.provenanceRecordCount,
      executionFingerprintCount: raw.executionFingerprintCount,
      active: raw.active,
    };
  }

  /**
   * Fetch and decrypt the permission manifest for a passport. The signer
   * provided to this client MUST be the principal — anyone else's signature
   * derives a different HKDF key and AES-GCM authentication will fail.
   *
   * Also verifies that the on-chain `permissionManifestHash` matches
   * `keccak256(ciphertext)` so we detect tampered uploads.
   */
  async getManifest(passportId: PassportId): Promise<PermissionManifestPlain> {
    const record = await this.resolve(passportId);
    const uri = await this.registry.tokenURI(record.tokenId);
    const rootHash = decodeStorageUri(uri);
    if (!rootHash) {
      throw new RegistryError(`unsupported metadataUri scheme: "${uri}"`);
    }
    const ciphertext = await this.config.storage.downloadBytes(rootHash);
    const ciphertextHex = hexlify(ciphertext);

    const onChainHash = record.permissionManifestHash.toLowerCase();
    const computedHash = keccak256(ciphertextHex).toLowerCase();
    if (onChainHash !== computedHash) {
      throw new RegistryError(
        `manifest tampered: on-chain ${onChainHash} != computed ${computedHash}`,
      );
    }

    const symKey = await deriveSymmetricKeyWithSigner(this.config.signer, passportId);
    return decryptJson<PermissionManifestPlain>(ciphertextHex, symKey);
  }

  async passportOfAgent(agentAddress: string): Promise<PassportId | null> {
    const id = (await this.registry.passportOfAgent(agentAddress)) as PassportId;
    if (!id || id === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return null;
    }
    return id;
  }

  async isAuthorizedSigner(passportId: PassportId, signer: string): Promise<boolean> {
    return this.registry.isAuthorizedSigner(passportId, signer);
  }
}

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n;
  for (const byte of b) n = (n << 8n) | BigInt(byte);
  return n;
}

function bytesFromHex(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
