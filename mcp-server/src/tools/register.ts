/**
 * sigil__register_agent — Initiate a sponsored Sigil agent registration.
 *
 * This tool calls the Sigil registration API (Next.js) to generate an agent
 * keypair and return an approvalUrl the principal must visit to complete
 * the on-chain registration. After approval, the agent polls
 * sigil__poll_registration to receive its passportId and private key.
 */

import { z } from "zod";

export const registerAgentSchema = z.object({
  principalAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Must be 0x + 40 hex chars")
    .describe("The principal wallet address that will own the AgentPassport"),
  agentDescription: z
    .string()
    .max(280)
    .describe("Free-text description of the agent (≤ 280 chars)"),
  permissions: z
    .object({
      whitelistedContracts: z
        .array(z.string())
        .default([])
        .describe("Contract addresses the agent may interact with"),
      maxTxValuePerWindow: z
        .record(z.number())
        .default({ OG: 0 })
        .describe("Max token value the agent can transact per time window"),
      authorizedApis: z
        .array(z.string())
        .default(["0g.compute"])
        .describe("External APIs the agent may call"),
      allowedTokens: z
        .array(z.string())
        .default(["OG"])
        .describe("Token symbols the agent may use"),
      timeWindowSeconds: z
        .number()
        .int()
        .positive()
        .default(3600)
        .describe("Rolling window for tx-value limits, in seconds"),
    })
    .describe("Permission manifest for the agent"),
  requestId: z
    .string()
    .optional()
    .describe("If provided, poll the status of an existing request instead of creating a new one"),
});

export type RegisterAgentInput = z.infer<typeof registerAgentSchema>;

export async function registerAgent(
  input: RegisterAgentInput,
  config: { apiBaseUrl: string },
): Promise<{
  requestId: string;
  agentAddress: string;
  passportId: string;
  approvalUrl: string;
  expiresAt: number;
  message: string;
}> {
  // If requestId provided, poll status instead of creating a new request
  if (input.requestId) {
    const res = await fetch(
      `${config.apiBaseUrl}/api/v1/passport/register/status/${input.requestId}`,
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Status poll failed: ${(err as { error: string }).error}`);
    }
    const data = (await res.json()) as {
      status: string;
      requestId: string;
      agentAddress?: string;
      passportId?: string;
      agentPrivateKey?: string;
      approvalTxHash?: string;
      expiresAt?: number;
    };

    if (data.status === "approved") {
      return {
        requestId: data.requestId,
        agentAddress: data.agentAddress ?? "",
        passportId: data.passportId ?? "",
        approvalUrl: "",
        expiresAt: 0,
        message: data.agentPrivateKey
          ? `Registration approved! passportId=${data.passportId}\n\nIMPORTANT: Store your agent private key securely — it will not be shown again:\n${data.agentPrivateKey}\n\nApproval tx: ${data.approvalTxHash}`
          : `Registration approved. passportId=${data.passportId} (key already delivered)`,
      };
    }

    return {
      requestId: data.requestId,
      agentAddress: data.agentAddress ?? "",
      passportId: data.passportId ?? "",
      approvalUrl: `${config.apiBaseUrl}/approve/${data.requestId}`,
      expiresAt: data.expiresAt ?? 0,
      message: `Still pending. The principal must visit the approval URL to complete registration.`,
    };
  }

  // Create a new pending registration
  const res = await fetch(`${config.apiBaseUrl}/api/v1/passport/register/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      principalAddress: input.principalAddress,
      agentDescription: input.agentDescription,
      permissions: input.permissions,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Registration request failed: ${(err as { error: string }).error}`);
  }

  const data = (await res.json()) as {
    requestId: string;
    agentAddress: string;
    passportId: string;
    approvalUrl: string;
    expiresAt: number;
  };

  return {
    ...data,
    message: `Registration pending. The principal (${input.principalAddress}) must visit this URL to approve:\n${data.approvalUrl}\n\nOnce approved, call sigil__register_agent again with requestId="${data.requestId}" to receive the passportId and agent private key.`,
  };
}
