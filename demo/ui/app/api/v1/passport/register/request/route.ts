/**
 * POST /api/v1/passport/register/request
 *
 * An external agent (discovered Sigil via SKILL.md or MCP) asks for a
 * sponsored registration. The server:
 *  1. Generates a fresh agent keypair (never logged)
 *  2. Pre-computes passportId + permissionManifestHash
 *  3. Stores a PendingRegistration with a 24h TTL
 *  4. Returns requestId, agentAddress, and an approvalUrl the agent should
 *     present to its human principal
 *
 * The principal visits /approve/:requestId, connects their wallet, and
 * calls SigilRegistry.register() directly from the browser. On success the
 * agent polls GET /api/v1/passport/register/status/:requestId to receive
 * its passportId and agentPrivateKey (delivered exactly once).
 */

import { NextRequest, NextResponse } from "next/server";
import { Wallet } from "ethers";
import {
  store,
  generateRequestId,
  computePassportId,
  computePermissionManifestHash,
  checkRateLimit,
  countPendingForPrincipal,
  type PermissionSpec,
} from "../../../../../../lib/registration-store";

export const dynamic = "force-dynamic";

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded: max 5 registration requests per IP per hour" },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { principalAddress, agentDescription, permissions } = body as {
    principalAddress?: string;
    agentDescription?: string;
    permissions?: PermissionSpec;
  };

  if (!principalAddress || !/^0x[0-9a-fA-F]{40}$/.test(principalAddress)) {
    return NextResponse.json(
      { error: "principalAddress is required (0x + 40 hex chars)" },
      { status: 400 },
    );
  }
  if (!agentDescription || typeof agentDescription !== "string") {
    return NextResponse.json({ error: "agentDescription is required" }, { status: 400 });
  }
  if (agentDescription.length > 280) {
    return NextResponse.json(
      { error: "agentDescription must be ≤ 280 characters" },
      { status: 400 },
    );
  }
  if (!permissions || typeof permissions !== "object") {
    return NextResponse.json({ error: "permissions object is required" }, { status: 400 });
  }

  if (countPendingForPrincipal(principalAddress) >= 10) {
    return NextResponse.json(
      { error: "Too many pending registrations for this principal (max 10)" },
      { status: 429 },
    );
  }

  // Generate agent keypair — never logged
  const agentWallet = Wallet.createRandom();
  const agentAddress = agentWallet.address;
  const agentPrivateKey = agentWallet.privateKey;

  // Pre-compute a nonce for passportId derivation
  const nonceBuf = Buffer.allocUnsafe(32);
  for (let i = 0; i < 32; i++) nonceBuf[i] = Math.floor(Math.random() * 256);
  const nonce = nonceBuf.toString("hex");

  const passportId = computePassportId(principalAddress, agentAddress, nonce);
  const permissionManifestHash = computePermissionManifestHash(
    permissions as PermissionSpec,
    agentDescription,
  );

  const requestId = generateRequestId();
  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000;

  store.set(requestId, {
    requestId,
    principalAddress,
    agentAddress,
    agentPrivateKey,
    agentDescription,
    permissions: permissions as PermissionSpec,
    passportId,
    permissionManifestHash,
    status: "pending",
    createdAt: now,
    expiresAt,
    keyDelivered: false,
  });

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`;

  return NextResponse.json({
    requestId,
    agentAddress,
    passportId,
    approvalUrl: `${baseUrl}/approve/${requestId}`,
    expiresAt,
  });
}
