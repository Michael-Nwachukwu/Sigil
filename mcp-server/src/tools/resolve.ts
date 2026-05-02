/**
 * sigil__resolve_agent — Read a Sigil AgentPassport from the registry.
 *
 * Input: passportId (bytes32 hex), agentAddress (0x address), or raw string
 * that looks like a passportId or address. Falls back to passportId lookup.
 */

import { z } from "zod";
import { JsonRpcProvider, Contract, isAddress } from "ethers";

const REGISTRY_ABI = [
  "function resolve(bytes32 passportId) external view returns (tuple(bytes32 passportId, uint256 tokenId, address principal, address agentAddress, uint256 createdAt, uint256 createdBlock, bytes32 permissionManifestHash, uint256 reputationScore, uint256 taskCount, uint256 failureCount, uint256 provenanceRecordCount, uint256 executionFingerprintCount, bool active))",
  "function passportOfAgent(address agent) external view returns (bytes32)",
] as const;

export const resolveAgentSchema = z.object({
  query: z
    .string()
    .describe(
      "PassportId (0x + 64 hex chars), agent address (0x + 40 hex chars), or leave blank to resolve the configured agent address from env",
    )
    .optional(),
});

export type ResolveAgentInput = z.infer<typeof resolveAgentSchema>;

export async function resolveAgent(
  input: ResolveAgentInput,
  config: { rpcUrl: string; registryAddress: string },
) {
  const provider = new JsonRpcProvider(config.rpcUrl);
  const registry = new Contract(config.registryAddress, REGISTRY_ABI, provider);

  let passportId: string;
  const query = input.query ?? process.env.SIGIL_AGENT_ADDRESS ?? "";

  if (!query) {
    throw new Error(
      "Provide a passportId or agentAddress query, or set SIGIL_AGENT_ADDRESS env var",
    );
  }

  if (/^0x[0-9a-fA-F]{64}$/.test(query)) {
    passportId = query;
  } else if (isAddress(query)) {
    passportId = (await registry.passportOfAgent(query)) as string;
    if (passportId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      throw new Error(`No passport found for agent address ${query}`);
    }
  } else {
    throw new Error(`Invalid query "${query}" — expected 0x+64 hex passportId or 0x+40 hex address`);
  }

  const rec = await registry.resolve(passportId);
  const reputationScore = Number(rec.reputationScore);
  const taskCount = Number(rec.taskCount);
  const failureCount = Number(rec.failureCount);

  return {
    passportId,
    tokenId: rec.tokenId.toString(),
    principal: rec.principal,
    agentAddress: rec.agentAddress,
    active: rec.active,
    reputationScore,
    taskCount,
    failureCount,
    provenanceRecordCount: rec.provenanceRecordCount.toString(),
    executionFingerprintCount: rec.executionFingerprintCount.toString(),
    createdAt: new Date(Number(rec.createdAt) * 1000).toISOString(),
    permissionManifestHash: rec.permissionManifestHash,
    explorerUrl: `${process.env.SIGIL_EXPLORER_URL ?? "https://chainscan-galileo.0g.ai"}/address/${rec.agentAddress}`,
  };
}
