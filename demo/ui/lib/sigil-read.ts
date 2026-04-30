import { Contract, JsonRpcProvider, isAddress, isHexString, ZeroAddress } from "ethers";

import deployments from "../../../deployments/galileo-testnet.json";

export const RPC_URL = deployments.rpcUrl;
export const CHAIN_ID = deployments.chainId;
export const EXPLORER_URL = deployments.explorerUrl;
export const REGISTRY_ADDRESS = deployments.contracts.SigilRegistry;
export const NOTARY_ADDRESS = deployments.contracts.ProvenanceNotary;

export type Hex32 = `0x${string}`;

export interface PassportRecord {
  passportId: Hex32;
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

export enum ArtifactType {
  CODE_AUDIT = 0,
  CONTRACT_CLAUSE = 1,
  RISK_ASSESSMENT = 2,
  FINANCIAL_MODEL = 3,
  DUE_DILIGENCE = 4,
  GOVERNANCE_ANALYSIS = 5,
  GENERIC_REPORT = 6,
}

export const ARTIFACT_TYPE_LABEL: Record<ArtifactType, string> = {
  [ArtifactType.CODE_AUDIT]: "CODE_AUDIT",
  [ArtifactType.CONTRACT_CLAUSE]: "CONTRACT_CLAUSE",
  [ArtifactType.RISK_ASSESSMENT]: "RISK_ASSESSMENT",
  [ArtifactType.FINANCIAL_MODEL]: "FINANCIAL_MODEL",
  [ArtifactType.DUE_DILIGENCE]: "DUE_DILIGENCE",
  [ArtifactType.GOVERNANCE_ANALYSIS]: "GOVERNANCE_ANALYSIS",
  [ArtifactType.GENERIC_REPORT]: "GENERIC_REPORT",
};

export interface ProvenanceRecord {
  recordId: Hex32;
  passportId: Hex32;
  principal: string;
  agent: string;
  modelFingerprintHash: Hex32;
  modelId: string;
  inputContextHash: Hex32;
  inputContextSize: bigint;
  outputHash: Hex32;
  artifactType: ArtifactType;
  agentSignature: string;
  nonce: bigint;
  timestamp: bigint;
  blockNumber: bigint;
  executionFingerprintRef: Hex32;
}

const REGISTRY_ABI = [
  "function resolve(bytes32 passportId) external view returns (tuple(bytes32 passportId, uint256 tokenId, address principal, address agentAddress, uint256 createdAt, uint256 createdBlock, bytes32 permissionManifestHash, uint256 reputationScore, uint256 taskCount, uint256 failureCount, uint256 provenanceRecordCount, uint256 executionFingerprintCount, bool active))",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function passportOfAgent(address agent) external view returns (bytes32)",
  "function isAuthorizedSigner(bytes32 passportId, address signer) external view returns (bool)",
] as const;

const NOTARY_ABI = [
  "function signerNonces(address signer) external view returns (uint256)",
  "function resolve(bytes32 recordId) external view returns (tuple(bytes32 recordId, bytes32 passportId, address principal, address agent, bytes32 modelFingerprintHash, string modelId, bytes32 inputContextHash, uint256 inputContextSize, bytes32 outputHash, uint8 artifactType, bytes agentSignature, uint256 nonce, uint256 timestamp, uint256 blockNumber, bytes32 executionFingerprintRef))",
  "function resolveByOutput(bytes32 outputHash) external view returns (bytes32)",
  "function recordsByAgent(bytes32 passportId, uint256 offset, uint256 limit) external view returns (bytes32[])",
  "function verify(bytes32 recordId) external view returns (bool, string)",
] as const;

let cachedProvider: JsonRpcProvider | null = null;
let cachedRegistry: Contract | null = null;
let cachedNotary: Contract | null = null;

function provider(): JsonRpcProvider {
  if (!cachedProvider) {
    cachedProvider = new JsonRpcProvider(RPC_URL, CHAIN_ID, {
      staticNetwork: true,
    });
  }
  return cachedProvider;
}

function registry(): Contract {
  if (!cachedRegistry) {
    cachedRegistry = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, provider());
  }
  return cachedRegistry;
}

function notary(): Contract {
  if (!cachedNotary) {
    cachedNotary = new Contract(NOTARY_ADDRESS, NOTARY_ABI, provider());
  }
  return cachedNotary;
}

export type InputKind = "passportId" | "recordId" | "address" | "outputHash" | "unknown";

export function detectInputKind(raw: string): InputKind {
  const value = raw.trim();
  if (!value) {
    return "unknown";
  }
  if (isAddress(value)) {
    return "address";
  }
  if (isHexString(value, 32)) {
    return "passportId";
  }
  return "unknown";
}

const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";

function toPassportRecord(raw: any): PassportRecord {
  return {
    passportId: raw.passportId as Hex32,
    tokenId: raw.tokenId as bigint,
    principal: raw.principal as string,
    agentAddress: raw.agentAddress as string,
    createdAt: raw.createdAt as bigint,
    createdBlock: raw.createdBlock as bigint,
    permissionManifestHash: raw.permissionManifestHash as Hex32,
    reputationScore: raw.reputationScore as bigint,
    taskCount: raw.taskCount as bigint,
    failureCount: raw.failureCount as bigint,
    provenanceRecordCount: raw.provenanceRecordCount as bigint,
    executionFingerprintCount: raw.executionFingerprintCount as bigint,
    active: raw.active as boolean,
  };
}

function toProvenanceRecord(raw: any): ProvenanceRecord {
  return {
    recordId: raw.recordId as Hex32,
    passportId: raw.passportId as Hex32,
    principal: raw.principal as string,
    agent: raw.agent as string,
    modelFingerprintHash: raw.modelFingerprintHash as Hex32,
    modelId: raw.modelId as string,
    inputContextHash: raw.inputContextHash as Hex32,
    inputContextSize: raw.inputContextSize as bigint,
    outputHash: raw.outputHash as Hex32,
    artifactType: Number(raw.artifactType) as ArtifactType,
    agentSignature: raw.agentSignature as string,
    nonce: raw.nonce as bigint,
    timestamp: raw.timestamp as bigint,
    blockNumber: raw.blockNumber as bigint,
    executionFingerprintRef: raw.executionFingerprintRef as Hex32,
  };
}

export async function resolvePassport(passportId: Hex32): Promise<PassportRecord | null> {
  const result = await registry().resolve(passportId);
  if (!result || result.principal === ZeroAddress) {
    return null;
  }
  return toPassportRecord(result);
}

export async function resolvePassportByAgent(
  agentAddress: string,
): Promise<PassportRecord | null> {
  const passportId = (await registry().passportOfAgent(agentAddress)) as Hex32;
  if (!passportId || passportId === ZERO_BYTES32) {
    return null;
  }
  return resolvePassport(passportId);
}

export async function recordsByAgent(
  passportId: Hex32,
  offset = 0,
  limit = 25,
): Promise<Hex32[]> {
  const ids = (await notary().recordsByAgent(passportId, offset, limit)) as string[];
  return ids.map((id) => id as Hex32);
}

export async function resolveRecord(recordId: Hex32): Promise<ProvenanceRecord | null> {
  const result = await notary().resolve(recordId);
  if (!result || result.passportId === ZERO_BYTES32) {
    return null;
  }
  return toProvenanceRecord(result);
}

export async function resolveByOutput(outputHash: Hex32): Promise<Hex32 | null> {
  const recordId = (await notary().resolveByOutput(outputHash)) as Hex32;
  if (!recordId || recordId === ZERO_BYTES32) {
    return null;
  }
  return recordId;
}

export async function verifyRecord(
  recordId: Hex32,
): Promise<{ valid: boolean; reason: string }> {
  const [valid, reason] = (await notary().verify(recordId)) as [boolean, string];
  return { valid, reason };
}

export async function tokenURI(tokenId: bigint): Promise<string> {
  return (await registry().tokenURI(tokenId)) as string;
}

/**
 * Resolve any input — tries passportId first, falls back to recordId or outputHash
 * for 32-byte hashes that aren't a registered passport.
 */
export type ResolveResult =
  | { kind: "passport"; passport: PassportRecord; records: Hex32[] }
  | { kind: "record"; record: ProvenanceRecord; passport: PassportRecord | null; verified: { valid: boolean; reason: string } }
  | { kind: "address"; passport: PassportRecord | null; query: string }
  | { kind: "output"; recordId: Hex32; record: ProvenanceRecord | null }
  | { kind: "notfound"; query: string }
  | { kind: "invalid"; query: string };

export async function smartResolve(rawInput: string): Promise<ResolveResult> {
  const value = rawInput.trim();
  const kind = detectInputKind(value);

  if (kind === "address") {
    const passport = await resolvePassportByAgent(value);
    return { kind: "address", passport, query: value };
  }

  if (kind === "passportId") {
    const hex = value as Hex32;
    const passport = await resolvePassport(hex);
    if (passport) {
      const records = await recordsByAgent(hex, 0, 50).catch(() => [] as Hex32[]);
      return { kind: "passport", passport, records };
    }

    const record = await resolveRecord(hex);
    if (record) {
      const [verified, agentPassport] = await Promise.all([
        verifyRecord(hex),
        resolvePassport(record.passportId),
      ]);
      return { kind: "record", record, passport: agentPassport, verified };
    }

    const recordIdFromOutput = await resolveByOutput(hex);
    if (recordIdFromOutput) {
      const record = await resolveRecord(recordIdFromOutput);
      return { kind: "output", recordId: recordIdFromOutput, record };
    }

    return { kind: "notfound", query: value };
  }

  return { kind: "invalid", query: value };
}

export function shortHex(value?: string | null): string {
  if (!value) {
    return "";
  }
  if (value.includes("...")) {
    return value;
  }
  return value.startsWith("0x")
    ? `0x${value.slice(2, 6)}...${value.slice(-4)}`
    : `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function explorerAddress(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function formatTimestamp(ts: bigint | number): string {
  const seconds = typeof ts === "bigint" ? Number(ts) : ts;
  if (!seconds) {
    return "—";
  }
  const date = new Date(seconds * 1000);
  return date.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}
