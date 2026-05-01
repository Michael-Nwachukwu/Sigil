import {
  Contract,
  JsonRpcProvider,
  isAddress,
  isHexString,
  keccak256,
  toUtf8Bytes,
  ZeroAddress,
} from "ethers";

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
  "event AgentRegistered(bytes32 indexed passportId, uint256 indexed tokenId, address indexed principal, address agentAddress, bytes32 permissionManifestHash, string metadataUri)",
  "function resolve(bytes32 passportId) external view returns (tuple(bytes32 passportId, uint256 tokenId, address principal, address agentAddress, uint256 createdAt, uint256 createdBlock, bytes32 permissionManifestHash, uint256 reputationScore, uint256 taskCount, uint256 failureCount, uint256 provenanceRecordCount, uint256 executionFingerprintCount, bool active))",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function passportOfAgent(address agent) external view returns (bytes32)",
  "function isAuthorizedSigner(bytes32 passportId, address signer) external view returns (bool)",
] as const;

const NOTARY_ABI = [
  "event ArtifactNotarized(bytes32 indexed recordId, bytes32 indexed passportId, address indexed agent, address principal, bytes32 outputHash, bytes32 inputContextHash, bytes32 modelFingerprintHash, uint8 artifactType, uint256 nonce, uint256 timestamp)",
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

export type InputKind = "bytes32" | "address" | "unknown";

export function detectInputKind(raw: string): InputKind {
  const value = raw.trim();
  if (!value) {
    return "unknown";
  }
  if (isAddress(value)) {
    return "address";
  }
  if (isHexString(value, 32)) {
    return "bytes32";
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

function isNotFoundRevert(err: unknown): boolean {
  const message = (err as { message?: string })?.message ?? "";
  const data = (err as { data?: string; info?: { error?: { data?: string } } })?.data
    ?? (err as { info?: { error?: { data?: string } } })?.info?.error?.data
    ?? "";
  if (typeof data === "string" && (data.startsWith("0x103cbaf3") || data.startsWith("0x95657ef9"))) {
    return true;
  }
  return /PassportNotFound|RecordNotFound|reverted/i.test(message);
}

export async function resolvePassport(passportId: Hex32): Promise<PassportRecord | null> {
  try {
    const result = await registry().resolve(passportId);
    if (!result || result.principal === ZeroAddress) {
      return null;
    }
    return toPassportRecord(result);
  } catch (err) {
    if (isNotFoundRevert(err)) {
      return null;
    }
    throw err;
  }
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
  try {
    const ids = (await notary().recordsByAgent(passportId, offset, limit)) as string[];
    return ids.map((id) => id as Hex32);
  } catch {
    return [];
  }
}

export async function resolveRecord(recordId: Hex32): Promise<ProvenanceRecord | null> {
  try {
    const result = await notary().resolve(recordId);
    if (!result || result.passportId === ZERO_BYTES32) {
      return null;
    }
    return toProvenanceRecord(result);
  } catch (err) {
    if (isNotFoundRevert(err)) {
      return null;
    }
    throw err;
  }
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
 * Provenance envelope fetched from 0G Storage by content-address (rootHash =
 * the on-chain `executionFingerprintRef`). Envelope v2 inlines the agent's
 * output bytes alongside the sealed-inference proof so resolvers can render
 * the actual decision; v1 records only stored the proof string and are
 * surfaced here as `{ schema: "v1-or-unknown", output: undefined }`.
 *
 * Tamper check: the envelope itself is anchored on-chain via
 * `modelFingerprintHash = keccak256(envelopeBytes)`, and the lifted output is
 * additionally re-hashed against the on-chain `outputHash` before being
 * returned. Either mismatch flips `tampered = true` and the caller should
 * refuse to render the lifted output.
 */
export type ProvenanceEnvelopeResult =
  | {
      status: "v2";
      output: string;
      outputContentType?: string;
      schema: string;
      tampered: false;
    }
  | {
      status: "v2-tampered";
      output: string;
      schema: string;
      tampered: true;
      reason: string;
    }
  | {
      status: "v1-or-unknown";
      schema?: string;
      raw: unknown;
    }
  | {
      status: "missing";
      reason: string;
    }
  | {
      status: "error";
      reason: string;
    };

export async function fetchProvenanceEnvelope(
  rootHash: Hex32,
  expectedOutputHash: Hex32,
  expectedEnvelopeHash: Hex32,
): Promise<ProvenanceEnvelopeResult> {
  if (
    !rootHash ||
    rootHash === ZERO_BYTES32 ||
    !isHexString(rootHash, 32)
  ) {
    return { status: "missing", reason: "no executionFingerprintRef on record" };
  }

  let res: Response;
  try {
    res = await fetch(`/api/storage/${rootHash}`);
  } catch (err) {
    return {
      status: "error",
      reason: `fetch failed: ${(err as Error).message}`,
    };
  }
  if (!res.ok) {
    return {
      status: "error",
      reason: `storage proxy returned ${res.status}`,
    };
  }

  const buf = new Uint8Array(await res.arrayBuffer());

  // Anchor the bytes against the on-chain modelFingerprintHash. v1 envelopes
  // were the bare proof string, so this also catches "we got the right bytes
  // but they're not v2" before we try to JSON.parse a non-JSON payload.
  const anchorMatches =
    expectedEnvelopeHash !== ZERO_BYTES32 &&
    keccak256(buf).toLowerCase() === expectedEnvelopeHash.toLowerCase();

  let parsed: unknown;
  try {
    const text = new TextDecoder().decode(buf);
    parsed = JSON.parse(text);
  } catch {
    return {
      status: "v1-or-unknown",
      raw: undefined,
    };
  }

  const env = parsed as {
    schema?: unknown;
    output?: unknown;
    outputContentType?: unknown;
  };
  const schema = typeof env.schema === "string" ? env.schema : undefined;
  if (schema !== "sigil.provenance-envelope/2" || typeof env.output !== "string") {
    return { status: "v1-or-unknown", schema, raw: parsed };
  }

  const output = env.output;
  const outputContentType =
    typeof env.outputContentType === "string" ? env.outputContentType : undefined;

  if (!anchorMatches) {
    return {
      status: "v2-tampered",
      output,
      schema,
      tampered: true,
      reason: "envelope bytes do not hash to on-chain modelFingerprintHash",
    };
  }

  const outputMatches =
    keccak256(toUtf8Bytes(output)).toLowerCase() ===
    expectedOutputHash.toLowerCase();
  if (!outputMatches) {
    return {
      status: "v2-tampered",
      output,
      schema,
      tampered: true,
      reason: "embedded output does not hash to on-chain outputHash",
    };
  }

  return {
    status: "v2",
    output,
    outputContentType,
    schema,
    tampered: false,
  };
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

export type RecentActivityItem = {
  id: string;
  kind: "registration" | "notarization";
  source: "live" | "indexed";
  passportId?: Hex32;
  recordId?: Hex32;
  outputHash?: Hex32;
  principal?: string;
  agentAddress?: string;
  blockNumber?: number;
  txHash?: string;
  tokenId?: bigint;
  artifactType?: ArtifactType;
};

export type RecentActivityFeed = {
  items: RecentActivityItem[];
  mode: "live" | "mixed" | "indexed-only";
  liveCount: number;
  indexedCount: number;
  latestBlock?: number;
  lookbackBlocks: number;
};

// Curated index of real on-chain agents and records produced by the demo
// scenarios. Verified live against SigilRegistry / ProvenanceNotary on
// Galileo (chainId 16602) — every passportId, recordId, and outputHash here
// resolves end-to-end. The Galileo public RPC silently drops `eth_getLogs`
// for ranges past a few thousand blocks (see notes in `recentActivity`),
// so this curated list is the canonical discovery surface for the demo —
// not a fallback for missing data.
const INDEXED_ACTIVITY: RecentActivityItem[] = [
  {
    id: "indexed-passport-risk",
    kind: "registration",
    source: "indexed",
    passportId:
      "0x4a2c793f17dd95824d638d9ecb4c7625d2b31164d45eacaa42a128ea714d83ca",
    principal: "0x7FBbE68068A3Aa7E479A1E51e792F4C2073b018f",
    agentAddress: "0x472F443E25bF918839a22251310BaadB5F5590A1",
    blockNumber: 30579126,
    tokenId: 6n,
  },
  {
    id: "indexed-passport-audit",
    kind: "registration",
    source: "indexed",
    passportId:
      "0xb2a7894be763a5286aa1dc58e161818dcdfb149937217d31cc6a81f601917ec0",
    principal: "0x7FBbE68068A3Aa7E479A1E51e792F4C2073b018f",
    agentAddress: "0x8d3eF461B0996e5d1C6AA421b1fF00396f035C96",
    blockNumber: 30593007,
    tokenId: 7n,
  },
  {
    id: "indexed-record-risk-1",
    kind: "notarization",
    source: "indexed",
    recordId:
      "0x34a19c9d487934dbf272c6b198c9287f34cf5b7ec61fd2cc2fabcefe684294cf",
    passportId:
      "0x4a2c793f17dd95824d638d9ecb4c7625d2b31164d45eacaa42a128ea714d83ca",
    agentAddress: "0x472F443E25bF918839a22251310BaadB5F5590A1",
    outputHash:
      "0x7146eb6933e568492e2336f0656dcc64e97ed5a98803421d8c7db026abd29c65",
    artifactType: ArtifactType.RISK_ASSESSMENT,
    blockNumber: 30591267,
  },
  {
    id: "indexed-record-risk-2",
    kind: "notarization",
    source: "indexed",
    recordId:
      "0xa149557fad1a4808d7e963d787a80bd28e8ac7c9b6d1b07be3c00ca7d89ccdc8",
    passportId:
      "0x4a2c793f17dd95824d638d9ecb4c7625d2b31164d45eacaa42a128ea714d83ca",
    agentAddress: "0x472F443E25bF918839a22251310BaadB5F5590A1",
    outputHash:
      "0xb8c493d592a70262497b96d1766d483485758547c609d905837864f459804600",
    artifactType: ArtifactType.RISK_ASSESSMENT,
    blockNumber: 30634471,
  },
  {
    id: "indexed-record-risk-3",
    kind: "notarization",
    source: "indexed",
    recordId:
      "0xa762e3ff15695d09d0a6c456a129ee6c82b1908755b68c452f96173cb5e6f154",
    passportId:
      "0x4a2c793f17dd95824d638d9ecb4c7625d2b31164d45eacaa42a128ea714d83ca",
    agentAddress: "0x472F443E25bF918839a22251310BaadB5F5590A1",
    outputHash:
      "0x8a557f6e3435a091e5ca7278457a154bd574cd76c71b943e3761746ece56900d",
    artifactType: ArtifactType.RISK_ASSESSMENT,
    blockNumber: 30634562,
  },
  {
    id: "indexed-record-audit-1",
    kind: "notarization",
    source: "indexed",
    recordId:
      "0xa891741e327ec687276442d823d6ae2a578ccd880d1f375310d598fbbac82e08",
    passportId:
      "0xb2a7894be763a5286aa1dc58e161818dcdfb149937217d31cc6a81f601917ec0",
    agentAddress: "0x8d3eF461B0996e5d1C6AA421b1fF00396f035C96",
    outputHash:
      "0x2bf88d3a175dd95ed314582c11299bee0c793c5e8c3af23d7e18ff8fc1efd489",
    artifactType: ArtifactType.CODE_AUDIT,
    blockNumber: 30593281,
  },
];

// Real, resolvable starter examples for each lookup mode. Picked from the
// curated index above so every chip lands on a successful resolution.
export const EXAMPLE_LOOKUPS = {
  agent: [
    {
      label: "risk-scorer passport",
      value:
        "0x4a2c793f17dd95824d638d9ecb4c7625d2b31164d45eacaa42a128ea714d83ca",
      detail: "32-byte passportId · 3 records",
    },
    {
      label: "auditor agent address",
      value: "0x8d3eF461B0996e5d1C6AA421b1fF00396f035C96",
      detail: "20-byte agent address",
    },
  ],
  artifact: [
    {
      label: "audit record",
      value:
        "0xa891741e327ec687276442d823d6ae2a578ccd880d1f375310d598fbbac82e08",
      detail: "ProvenanceRecord · CODE_AUDIT",
    },
    {
      label: "risk record #2",
      value:
        "0xa149557fad1a4808d7e963d787a80bd28e8ac7c9b6d1b07be3c00ca7d89ccdc8",
      detail: "ProvenanceRecord · RISK_ASSESSMENT",
    },
  ],
  verify: [
    {
      label: "audit output hash",
      value:
        "0x2bf88d3a175dd95ed314582c11299bee0c793c5e8c3af23d7e18ff8fc1efd489",
      detail: "raw output keccak256",
    },
    {
      label: "risk output hash",
      value:
        "0x7146eb6933e568492e2336f0656dcc64e97ed5a98803421d8c7db026abd29c65",
      detail: "raw output keccak256",
    },
  ],
} as const;

function dedupeActivity(items: RecentActivityItem[]): RecentActivityItem[] {
  const seen = new Set<string>();
  const deduped: RecentActivityItem[] = [];

  for (const item of items) {
    const key = item.recordId ?? item.passportId ?? item.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

export async function recentActivity(
  limit = 8,
  lookbackBlocks = 10_000,
): Promise<RecentActivityFeed> {
  try {
    const latestBlock = await provider().getBlockNumber();
    const fromBlock = Math.max(latestBlock - lookbackBlocks, 0);

    const [registrations, notarizations] = await Promise.all([
      registry()
        .queryFilter(registry().filters.AgentRegistered(), fromBlock, latestBlock)
        .catch(() => [] as any[]),
      notary()
        .queryFilter(notary().filters.ArtifactNotarized(), fromBlock, latestBlock)
        .catch(() => [] as any[]),
    ]);

    const sortableLiveItems: Array<RecentActivityItem & { sortIndex: number }> = [
      ...registrations.map((log: any) => {
        const args = log.args as any;
        return {
          id: `reg-${log.transactionHash}-${log.index ?? 0}`,
          kind: "registration" as const,
          source: "live" as const,
          passportId: args.passportId as Hex32,
          principal: args.principal as string,
          agentAddress: args.agentAddress as string,
          tokenId: args.tokenId as bigint,
          txHash: log.transactionHash as string,
          blockNumber: Number(log.blockNumber),
          sortIndex: Number(log.index ?? 0),
        };
      }),
      ...notarizations.map((log: any) => {
        const args = log.args as any;
        return {
          id: `note-${log.transactionHash}-${log.index ?? 0}`,
          kind: "notarization" as const,
          source: "live" as const,
          recordId: args.recordId as Hex32,
          passportId: args.passportId as Hex32,
          principal: args.principal as string,
          agentAddress: args.agent as string,
          outputHash: args.outputHash as Hex32,
          artifactType: Number(args.artifactType) as ArtifactType,
          txHash: log.transactionHash as string,
          blockNumber: Number(log.blockNumber),
          sortIndex: Number(log.index ?? 0),
        };
      }),
    ];

    const liveItems = sortableLiveItems
      .sort((a, b) => {
        if ((b.blockNumber ?? 0) !== (a.blockNumber ?? 0)) {
          return (b.blockNumber ?? 0) - (a.blockNumber ?? 0);
        }
        return b.sortIndex - a.sortIndex;
      })
      .map(({ sortIndex: _sortIndex, ...item }) => item);

    // The Galileo public RPC silently truncates eth_getLogs even on tiny
    // ranges, so liveItems is almost always empty in practice. We always
    // mix the curated INDEXED_ACTIVITY in so the rail has real, resolvable
    // entries — when live events do come through (private RPC, future
    // indexer), they sort to the top by block height.
    const merged = dedupeActivity([...liveItems, ...INDEXED_ACTIVITY]).slice(0, limit);
    const liveCount = merged.filter((item) => item.source === "live").length;
    const indexedCount = merged.length - liveCount;

    return {
      items: merged,
      mode:
        liveCount === 0 ? "indexed-only" : indexedCount > 0 ? "mixed" : "live",
      liveCount,
      indexedCount,
      latestBlock,
      lookbackBlocks,
    };
  } catch {
    return {
      items: INDEXED_ACTIVITY.slice(0, limit),
      mode: "indexed-only",
      liveCount: 0,
      indexedCount: Math.min(limit, INDEXED_ACTIVITY.length),
      lookbackBlocks,
    };
  }
}

export async function smartResolve(rawInput: string): Promise<ResolveResult> {
  const value = rawInput.trim();
  const kind = detectInputKind(value);

  if (kind === "address") {
    const passport = await resolvePassportByAgent(value);
    return { kind: "address", passport, query: value };
  }

  if (kind === "bytes32") {
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
