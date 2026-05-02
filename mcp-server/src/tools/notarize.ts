/**
 * sigil__notarize_output — Notarize an AI-generated artifact on-chain.
 *
 * Local-only: reads SIGIL_AGENT_PRIVATE_KEY from env. Never accepts private
 * keys in the tool call payload — this tool is exposed via stdio transport
 * only (not the remote SSE transport).
 *
 * Calls ProvenanceNotaryClient.notarize() which uploads the proof envelope
 * to 0G Storage and submits an EIP-712 signed tx to ProvenanceNotary on-chain.
 */

import { z } from "zod";
import { Wallet, JsonRpcProvider } from "ethers";
import { SigilClient } from "sigil-protocol";
import { ArtifactType } from "sigil-protocol";

export const notarizeOutputSchema = z.object({
  passportId: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .describe("The agent's passportId"),
  output: z.string().describe("The full text of the AI-generated artifact to notarize"),
  inputContext: z
    .string()
    .describe("The input prompt/context that produced this output (encrypted before upload)"),
  artifactType: z
    .enum([
      "CODE_AUDIT",
      "CONTRACT_CLAUSE",
      "RISK_ASSESSMENT",
      "FINANCIAL_MODEL",
      "DUE_DILIGENCE",
      "GOVERNANCE_ANALYSIS",
      "GENERIC_REPORT",
    ])
    .default("GENERIC_REPORT")
    .describe("The artifact category"),
  modelId: z
    .string()
    .default("qwen/qwen-2.5-7b-instruct")
    .describe("The model used to generate the output"),
});

export type NotarizeOutputInput = z.infer<typeof notarizeOutputSchema>;

const ARTIFACT_TYPE_MAP: Record<string, ArtifactType> = {
  CODE_AUDIT: ArtifactType.CODE_AUDIT,
  CONTRACT_CLAUSE: ArtifactType.CONTRACT_CLAUSE,
  RISK_ASSESSMENT: ArtifactType.RISK_ASSESSMENT,
  FINANCIAL_MODEL: ArtifactType.FINANCIAL_MODEL,
  DUE_DILIGENCE: ArtifactType.DUE_DILIGENCE,
  GOVERNANCE_ANALYSIS: ArtifactType.GOVERNANCE_ANALYSIS,
  GENERIC_REPORT: ArtifactType.GENERIC_REPORT,
};

export async function notarizeOutput(
  input: NotarizeOutputInput,
  config: {
    rpcUrl: string;
    chainId: number;
    registryAddress: string;
    notaryAddress: string;
    storageRpc: string;
  },
) {
  const agentPrivateKey = process.env.SIGIL_AGENT_PRIVATE_KEY;
  if (!agentPrivateKey) {
    throw new Error("SIGIL_AGENT_PRIVATE_KEY is not set. This tool requires the agent private key in env.");
  }

  const provider = new JsonRpcProvider(config.rpcUrl);
  const agentWallet = new Wallet(agentPrivateKey, provider);

  const sigil = new SigilClient({
    rpcUrl: config.rpcUrl,
    chainId: config.chainId,
    registryAddress: config.registryAddress,
    notaryAddress: config.notaryAddress,
    signer: agentWallet,
    storageRpcUrl: config.storageRpc,
  });

  // Build a minimal sealed inference receipt (the MCP caller provides the output;
  // we construct a receipt that records the model + content hashes)
  const { keccak256, toUtf8Bytes } = await import("ethers");
  const outputHash = keccak256(toUtf8Bytes(input.output));
  const inputHash = keccak256(toUtf8Bytes(input.inputContext));

  const inferenceReceipt = {
    modelId: input.modelId,
    modelVersionHash: keccak256(toUtf8Bytes(input.modelId)),
    inputHash,
    outputHash,
    proof: JSON.stringify({
      modelId: input.modelId,
      inputHash,
      outputHash,
      source: "mcp-notarize",
      timestamp: Math.floor(Date.now() / 1000),
    }),
    timestamp: Math.floor(Date.now() / 1000),
  };

  const result = await sigil.provenance.notarize({
    passportId: input.passportId as `0x${string}`,
    inferenceReceipt,
    inputContext: input.inputContext,
    output: input.output,
    artifactType: ARTIFACT_TYPE_MAP[input.artifactType] ?? ArtifactType.GENERIC_REPORT,
  });

  const explorerBase = process.env.SIGIL_EXPLORER_URL ?? "https://chainscan-galileo.0g.ai";
  return {
    recordId: result.recordId,
    txHash: result.txHash,
    outputHash: result.outputHash,
    inputContextHash: result.inputContextHash,
    proofRootHash: result.proofRootHash,
    explorerUrl: `${explorerBase}/tx/${result.txHash}`,
    message: `Notarized on-chain. recordId=${result.recordId}\nTx: ${explorerBase}/tx/${result.txHash}`,
  };
}
