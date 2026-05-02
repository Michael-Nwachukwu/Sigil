/**
 * sigil__resolve_provenance — Resolve a ProvenanceRecord from on-chain.
 *
 * Supports lookup by: recordId, outputHash (bytes32 keccak of the artifact),
 * or "all records for a passportId" (paginated).
 */

import { z } from "zod";
import { JsonRpcProvider, Contract } from "ethers";

const NOTARY_ABI = [
  "function resolve(bytes32 recordId) external view returns (tuple(bytes32 recordId, bytes32 passportId, address principal, address agent, bytes32 modelFingerprintHash, string modelId, bytes32 inputContextHash, uint256 inputContextSize, bytes32 outputHash, uint8 artifactType, bytes agentSignature, uint256 nonce, uint256 timestamp, uint256 blockNumber, bytes32 executionFingerprintRef))",
  "function resolveByOutput(bytes32 outputHash) external view returns (bytes32)",
  "function recordsByAgent(bytes32 passportId, uint256 offset, uint256 limit) external view returns (bytes32[])",
  "function verify(bytes32 recordId) external view returns (bool, string)",
] as const;

const ARTIFACT_TYPE_LABELS = [
  "CODE_AUDIT",
  "CONTRACT_CLAUSE",
  "RISK_ASSESSMENT",
  "FINANCIAL_MODEL",
  "DUE_DILIGENCE",
  "GOVERNANCE_ANALYSIS",
  "GENERIC_REPORT",
];

export const resolveProvenanceSchema = z.object({
  recordId: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional()
    .describe("The ProvenanceRecord ID (bytes32)"),
  outputHash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional()
    .describe("keccak256 of the artifact output (resolves to the record ID first)"),
  passportId: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional()
    .describe("List all records for this passport (paginated)"),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(10),
});

export type ResolveProvenanceInput = z.infer<typeof resolveProvenanceSchema>;

export async function resolveProvenance(
  input: ResolveProvenanceInput,
  config: { rpcUrl: string; notaryAddress: string },
) {
  const provider = new JsonRpcProvider(config.rpcUrl);
  const notary = new Contract(config.notaryAddress, NOTARY_ABI, provider);
  const explorerBase = process.env.SIGIL_EXPLORER_URL ?? "https://chainscan-galileo.0g.ai";

  // List all records for a passport
  if (input.passportId && !input.recordId && !input.outputHash) {
    const ids = (await notary.recordsByAgent(
      input.passportId,
      input.offset,
      input.limit,
    )) as string[];
    return {
      passportId: input.passportId,
      recordIds: ids,
      offset: input.offset,
      count: ids.length,
      message: `Found ${ids.length} provenance record(s) for passport ${input.passportId.slice(0, 10)}…`,
    };
  }

  let recordId: string;

  if (input.outputHash) {
    recordId = (await notary.resolveByOutput(input.outputHash)) as string;
    if (recordId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      throw new Error(`No provenance record found for outputHash ${input.outputHash}`);
    }
  } else if (input.recordId) {
    recordId = input.recordId;
  } else {
    throw new Error("Provide recordId, outputHash, or passportId");
  }

  const [raw, [valid, reason]] = await Promise.all([
    notary.resolve(recordId),
    notary.verify(recordId),
  ]);

  const artifactType =
    ARTIFACT_TYPE_LABELS[Number(raw.artifactType)] ?? String(raw.artifactType);
  const timestamp = new Date(Number(raw.timestamp) * 1000).toISOString();

  return {
    recordId,
    passportId: raw.passportId,
    principal: raw.principal,
    agent: raw.agent,
    modelId: raw.modelId,
    modelFingerprintHash: raw.modelFingerprintHash,
    outputHash: raw.outputHash,
    inputContextHash: raw.inputContextHash,
    inputContextSize: raw.inputContextSize.toString(),
    artifactType,
    nonce: raw.nonce.toString(),
    timestamp,
    blockNumber: raw.blockNumber.toString(),
    executionFingerprintRef: raw.executionFingerprintRef,
    verified: valid,
    verifyReason: reason,
    explorerUrl: `${explorerBase}/tx/${raw.executionFingerprintRef}`,
    message: `Record resolved. verified=${valid}${reason ? ` (${reason})` : ""}. Agent=${raw.agent.slice(0, 10)}…, artifact=${artifactType}, ts=${timestamp}`,
  };
}
