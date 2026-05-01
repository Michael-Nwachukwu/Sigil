/**
 * Sigil Protocol SDK — public exports.
 */

export { SigilClient } from './SigilClient';
export type { SigilClientOptions } from './SigilClient';

export { AgentPassportClient } from './passport/AgentPassport';
export type {
  AgentPassportClientConfig,
  RegisterParams,
  RegisterResult,
} from './passport/AgentPassport';

export { ProvenanceNotaryClient } from './provenance/ProvenanceNotary';
export type {
  NotarizeParams,
  NotarizeResult,
  ProvenanceNotaryClientConfig,
} from './provenance/ProvenanceNotary';

export { AutoAttestSidecar, attestationForArtifact } from './passport/AutoAttest';
export type {
  AutoAttestSidecarConfig,
  AttestationRecord,
} from './passport/AutoAttest';

export {
  derivePassportId,
  manifestKvKey,
  inputContextKvKey,
  logStreamId,
} from './passport/PassportTypes';

export {
  buildDomain as buildNotarizationDomain,
  signNotarization,
  NOTARIZATION_DOMAIN_NAME,
  NOTARIZATION_DOMAIN_VERSION,
  NOTARIZATION_TYPES,
} from './provenance/ProvenanceTypes';
export type { NotarizationTypedValue } from './provenance/ProvenanceTypes';

export { ZeroGStorageAdapter } from './adapters/ZeroGStorageAdapter';
export type { ZeroGStorageAdapterConfig } from './adapters/ZeroGStorageAdapter';

export { ZeroGComputeAdapter } from './adapters/ZeroGComputeAdapter';
export type {
  ZeroGComputeAdapterConfig,
  ChatMessage,
  SealedInferenceResult,
} from './adapters/ZeroGComputeAdapter';

export { KeeperHubAdapter } from './adapters/KeeperHubAdapter';
export type { KeeperHubAdapterConfig, BroadcastResult } from './adapters/KeeperHubAdapter';

export { mintAgentKeypair, redactMintedKeypair } from './utils/mintAgentKeypair';
export type { MintedAgentKeypair } from './utils/mintAgentKeypair';

export {
  writeCredential,
  readCredential,
  listCredentials,
  deleteCredential,
  credentialPath,
  credentialsDir,
} from './utils/credentials';
export type { SigilCredential, WriteCredentialOptions } from './utils/credentials';

export {
  encryptBytes,
  decryptBytes,
  encryptJson,
  decryptJson,
  deriveSymmetricKey,
  deriveSymmetricKeyWithSigner,
  keyDerivationMessage,
} from './utils/crypto';
export type { SealedPayload } from './utils/crypto';

export { logger, redactSensitiveFields } from './utils/logger';
export type { Logger } from './utils/logger';

export { withRetry, withTimeout, sleep } from './utils/withRetry';
export type { WithRetryOptions } from './utils/withRetry';

export {
  SigilError,
  ZeroGError,
  KeeperHubError,
  RegistryError,
  ProvenanceError,
  TimeoutError,
  CryptoError,
} from './utils/errors';

export * from './types/index';
