/**
 * sigil__verify_agent — Trust gate for another agent's passport.
 *
 * Returns ACCEPT / CAUTION / REJECT based on reputation score and activity.
 *
 * Thresholds per CLAUDE.md spec:
 *   REJECT  — reputation < 200 OR active == false
 *   CAUTION — reputation < 600 OR failureCount > 0
 *   ACCEPT  — reputation >= 600 AND failureCount == 0
 */

import { z } from "zod";
import { JsonRpcProvider, Contract, isAddress } from "ethers";

const REGISTRY_ABI = [
  "function resolve(bytes32 passportId) external view returns (tuple(bytes32 passportId, uint256 tokenId, address principal, address agentAddress, uint256 createdAt, uint256 createdBlock, bytes32 permissionManifestHash, uint256 reputationScore, uint256 taskCount, uint256 failureCount, uint256 provenanceRecordCount, uint256 executionFingerprintCount, bool active))",
  "function passportOfAgent(address agent) external view returns (bytes32)",
] as const;

export const verifyAgentSchema = z.object({
  query: z
    .string()
    .describe(
      "PassportId (0x+64 hex) or agent address (0x+40 hex) to verify trust level",
    ),
});

export type VerifyAgentInput = z.infer<typeof verifyAgentSchema>;

export type TrustLevel = "ACCEPT" | "CAUTION" | "REJECT";

export async function verifyAgent(
  input: VerifyAgentInput,
  config: { rpcUrl: string; registryAddress: string },
): Promise<{
  query: string;
  passportId: string;
  agentAddress: string;
  active: boolean;
  reputationScore: number;
  taskCount: number;
  failureCount: number;
  trustLevel: TrustLevel;
  reasons: string[];
  message: string;
}> {
  const provider = new JsonRpcProvider(config.rpcUrl);
  const registry = new Contract(config.registryAddress, REGISTRY_ABI, provider);

  let passportId: string;
  if (/^0x[0-9a-fA-F]{64}$/.test(input.query)) {
    passportId = input.query;
  } else if (isAddress(input.query)) {
    passportId = (await registry.passportOfAgent(input.query)) as string;
    if (passportId === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      return {
        query: input.query,
        passportId: passportId,
        agentAddress: input.query,
        active: false,
        reputationScore: 0,
        taskCount: 0,
        failureCount: 0,
        trustLevel: "REJECT",
        reasons: ["No passport registered for this address"],
        message: "REJECT — No passport registered for this address",
      };
    }
  } else {
    throw new Error(`Invalid query "${input.query}" — expected bytes32 passportId or 0x address`);
  }

  const rec = await registry.resolve(passportId);
  const reputationScore = Number(rec.reputationScore);
  const taskCount = Number(rec.taskCount);
  const failureCount = Number(rec.failureCount);
  const active: boolean = rec.active;

  const reasons: string[] = [];
  let trustLevel: TrustLevel = "ACCEPT";

  if (!active) {
    reasons.push("Agent has been revoked (active=false)");
    trustLevel = "REJECT";
  }
  if (reputationScore < 200) {
    reasons.push(`Reputation score too low (${reputationScore} < 200)`);
    if (trustLevel !== "REJECT") trustLevel = "REJECT";
  }
  if (trustLevel !== "REJECT") {
    if (reputationScore < 600) {
      reasons.push(`Reputation score below full-trust threshold (${reputationScore} < 600)`);
      trustLevel = "CAUTION";
    }
    if (failureCount > 0) {
      reasons.push(`Agent has ${failureCount} recorded failure(s)`);
      if (trustLevel === "ACCEPT") trustLevel = "CAUTION";
    }
  }
  if (reasons.length === 0) {
    reasons.push(
      `Reputation ${reputationScore}/1000, ${taskCount} tasks completed, 0 failures`,
    );
  }

  const summary = `${trustLevel} — ${reasons.join("; ")}`;

  return {
    query: input.query,
    passportId,
    agentAddress: rec.agentAddress,
    active,
    reputationScore,
    taskCount,
    failureCount,
    trustLevel,
    reasons,
    message: summary,
  };
}
