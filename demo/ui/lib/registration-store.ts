/**
 * In-memory pending-registration store for the Sigil sponsored-registration flow.
 *
 * Module-level singleton (shared across Next.js API route invocations in the
 * same process). Uses the global object trick so Next.js hot-reloads in
 * development don't re-create an empty Map and wipe pending requests.
 *
 * TTL: 24 hours. A simple setInterval sweeper is started the first time the
 * module loads. In production, use Redis or a durable store.
 */

import { randomBytes, keccak256, toUtf8Bytes, AbiCoder } from "ethers";

export interface PermissionSpec {
  whitelistedContracts: string[];
  maxTxValuePerWindow: Record<string, number>;
  authorizedApis: string[];
  allowedTokens: string[];
  timeWindowSeconds: number;
}

export interface PendingRegistration {
  requestId: string;
  principalAddress: string;
  agentAddress: string;
  /** Stored in memory only; never logged. Delivered exactly once after approval. */
  agentPrivateKey: string;
  agentDescription: string;
  permissions: PermissionSpec;
  /** Pre-computed passportId (blockNumber=0, random nonce). */
  passportId: string;
  permissionManifestHash: string;
  status: "pending" | "approved" | "expired";
  createdAt: number;
  expiresAt: number;
  /** Set on approval. */
  approvalTxHash?: string;
  /** True after the first status GET that returns the key — key never resent. */
  keyDelivered: boolean;
}

const TTL_MS = 24 * 60 * 60 * 1000;

// Survive hot-reloads in Next.js dev mode
const g = global as typeof global & {
  _sigilStore?: Map<string, PendingRegistration>;
  _sigilSweeper?: ReturnType<typeof setInterval>;
  _sigilRateLimit?: Map<string, { count: number; windowStart: number }>;
};

if (!g._sigilStore) {
  g._sigilStore = new Map();
}
if (!g._sigilRateLimit) {
  g._sigilRateLimit = new Map();
}
if (!g._sigilSweeper) {
  g._sigilSweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, req] of g._sigilStore!) {
      if (req.expiresAt < now && req.status === "pending") {
        g._sigilStore!.delete(id);
      }
    }
  }, 60_000);
  // Don't block the process from exiting
  if (typeof g._sigilSweeper.unref === "function") {
    g._sigilSweeper.unref();
  }
}

export const store = g._sigilStore;
export const rateLimit = g._sigilRateLimit;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateRequestId(): string {
  return randomBytes(16).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
}

const abi = AbiCoder.defaultAbiCoder();

export function computePassportId(
  principal: string,
  agentAddress: string,
  nonce: string,
): string {
  // blockNumber=0 for pre-computed pending registrations (the contract only
  // checks passportId uniqueness, not that blockNumber == block.number).
  const encoded = abi.encode(
    ["address", "address", "uint256", "uint256"],
    [principal, agentAddress, 0, BigInt("0x" + nonce)],
  );
  return keccak256(encoded);
}

export function computePermissionManifestHash(
  permissions: PermissionSpec,
  agentDescription: string,
): string {
  const manifest = JSON.stringify({ agentDescription, ...permissions });
  return keccak256(toUtf8Bytes(manifest));
}

// ---------------------------------------------------------------------------
// Rate limiting: 5 requests per IP per hour
// ---------------------------------------------------------------------------

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimit.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimit.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// ---------------------------------------------------------------------------
// Max 10 pending per principal
// ---------------------------------------------------------------------------

export function countPendingForPrincipal(principal: string): number {
  let count = 0;
  for (const req of store.values()) {
    if (
      req.principalAddress.toLowerCase() === principal.toLowerCase() &&
      req.status === "pending"
    ) {
      count++;
    }
  }
  return count;
}
