/**
 * Pending-registration storage for the hosted Sigil onboarding flow.
 *
 * Local development falls back to an in-memory singleton so `next dev` keeps
 * working without extra infrastructure.
 *
 * Hosted/serverless environments should use a durable HTTP KV backend
 * (Vercel KV / Upstash Redis REST). Otherwise POST /request and GET /status
 * may hit different instances and lose pending registrations.
 */

import { AbiCoder, keccak256, randomBytes, toUtf8Bytes } from "ethers";

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
  agentDescription: string;
  permissions: PermissionSpec;
  passportId: string;
  permissionManifestHash: string;
  status: "pending" | "approved" | "expired";
  createdAt: number;
  expiresAt: number;
  approvalTxHash?: string;
  keyDelivered: boolean;
}

type StoredRegistration = PendingRegistration;

const TTL_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

const KV_REST_URL =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
const KV_REST_TOKEN =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
const USE_REMOTE_KV = KV_REST_URL.length > 0 && KV_REST_TOKEN.length > 0;

type LocalRateLimitEntry = { count: number; windowStart: number };
type GlobalRegistrationState = typeof globalThis & {
  _sigilRegistrationStore?: Map<string, StoredRegistration>;
  _sigilRegistrationSecrets?: Map<string, string>;
  _sigilRegistrationRateLimit?: Map<string, LocalRateLimitEntry>;
  _sigilRegistrationPrincipalIndex?: Map<string, Set<string>>;
  _sigilRegistrationSweeper?: ReturnType<typeof setInterval>;
};

const g = globalThis as GlobalRegistrationState;

if (!g._sigilRegistrationStore) {
  g._sigilRegistrationStore = new Map();
}
if (!g._sigilRegistrationSecrets) {
  g._sigilRegistrationSecrets = new Map();
}
if (!g._sigilRegistrationRateLimit) {
  g._sigilRegistrationRateLimit = new Map();
}
if (!g._sigilRegistrationPrincipalIndex) {
  g._sigilRegistrationPrincipalIndex = new Map();
}
if (!g._sigilRegistrationSweeper) {
  g._sigilRegistrationSweeper = setInterval(() => {
    const now = Date.now();
    for (const [requestId, reg] of g._sigilRegistrationStore!) {
      if (reg.expiresAt < now && reg.status === "pending") {
        localDeleteRegistration(requestId, reg.principalAddress);
      }
    }
  }, 60_000);
  if (typeof g._sigilRegistrationSweeper.unref === "function") {
    g._sigilRegistrationSweeper.unref();
  }
}

const localStore = g._sigilRegistrationStore;
const localSecrets = g._sigilRegistrationSecrets;
const localRateLimit = g._sigilRegistrationRateLimit;
const localPrincipalIndex = g._sigilRegistrationPrincipalIndex;

const abi = AbiCoder.defaultAbiCoder();

function ttlSeconds(expiresAt: number): number {
  return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
}

function normalizePrincipal(principalAddress: string): string {
  return principalAddress.toLowerCase();
}

function remoteRequestKey(requestId: string): string {
  return `sigil:reg:req:${requestId}`;
}

function remoteSecretKey(requestId: string): string {
  return `sigil:reg:secret:${requestId}`;
}

function remotePrincipalKey(principalAddress: string): string {
  return `sigil:reg:principal:${normalizePrincipal(principalAddress)}`;
}

function remoteRateLimitKey(ip: string): string {
  return `sigil:reg:rate:${ip}`;
}

async function kvCommand<T>(command: Array<string | number>): Promise<T> {
  const res = await fetch(KV_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KV_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  const payload = (await res.json()) as { result?: T; error?: string };
  if (!res.ok || payload.error) {
    throw new Error(payload.error ?? `KV request failed (${res.status})`);
  }
  return payload.result as T;
}

function localAddToPrincipalIndex(principalAddress: string, requestId: string): void {
  const key = normalizePrincipal(principalAddress);
  const bucket = localPrincipalIndex.get(key) ?? new Set<string>();
  bucket.add(requestId);
  localPrincipalIndex.set(key, bucket);
}

function localRemoveFromPrincipalIndex(
  principalAddress: string | undefined,
  requestId: string,
): void {
  if (!principalAddress) return;
  const key = normalizePrincipal(principalAddress);
  const bucket = localPrincipalIndex.get(key);
  if (!bucket) return;
  bucket.delete(requestId);
  if (bucket.size === 0) {
    localPrincipalIndex.delete(key);
  }
}

function localDeleteRegistration(requestId: string, principalAddress?: string): void {
  const reg = localStore.get(requestId);
  localStore.delete(requestId);
  localSecrets.delete(requestId);
  localRemoveFromPrincipalIndex(principalAddress ?? reg?.principalAddress, requestId);
}

async function remoteDeleteRegistration(
  requestId: string,
  principalAddress?: string,
): Promise<void> {
  let principal = principalAddress;
  if (!principal) {
    const reg = await getRegistration(requestId);
    principal = reg?.principalAddress;
  }
  await kvCommand<number>(["DEL", remoteRequestKey(requestId)]);
  await kvCommand<number>(["DEL", remoteSecretKey(requestId)]);
  if (principal) {
    await kvCommand<number>(["SREM", remotePrincipalKey(principal), requestId]);
  }
}

async function remoteSetRegistration(reg: StoredRegistration): Promise<void> {
  await kvCommand<string>([
    "SET",
    remoteRequestKey(reg.requestId),
    JSON.stringify(reg),
    "EX",
    ttlSeconds(reg.expiresAt),
  ]);
}

async function remoteSetSecret(
  requestId: string,
  agentPrivateKey: string,
  expiresAt: number,
): Promise<void> {
  await kvCommand<string>([
    "SET",
    remoteSecretKey(requestId),
    agentPrivateKey,
    "EX",
    ttlSeconds(expiresAt),
  ]);
}

async function remoteGetSecret(requestId: string): Promise<string | null> {
  return (await kvCommand<string | null>(["GET", remoteSecretKey(requestId)])) ?? null;
}

async function remoteDeleteSecret(requestId: string): Promise<void> {
  await kvCommand<number>(["DEL", remoteSecretKey(requestId)]);
}

async function remoteConsumeSecret(requestId: string): Promise<string | null> {
  try {
    return (await kvCommand<string | null>(["GETDEL", remoteSecretKey(requestId)])) ?? null;
  } catch {
    const secret = await remoteGetSecret(requestId);
    if (secret != null) {
      await remoteDeleteSecret(requestId);
    }
    return secret;
  }
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

export function generateRequestId(): string {
  return randomBytes(16).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
}

export function generateNonceHex(bytes = 32): string {
  return randomBytes(bytes).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
}

export function computePassportId(
  principal: string,
  agentAddress: string,
  nonce: string,
): string {
  const encoded = abi.encode(
    ["address", "address", "uint256", "uint256"],
    [principal, agentAddress, 0, BigInt(`0x${nonce}`)],
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

export async function checkRateLimit(ip: string): Promise<boolean> {
  if (!USE_REMOTE_KV) {
    const now = Date.now();
    const entry = localRateLimit.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      localRateLimit.set(ip, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= RATE_LIMIT_MAX) {
      return false;
    }
    entry.count += 1;
    return true;
  }

  const count = Number(await kvCommand<number>(["INCR", remoteRateLimitKey(ip)]));
  if (count === 1) {
    await kvCommand<number>(["EXPIRE", remoteRateLimitKey(ip), RATE_LIMIT_WINDOW_MS / 1000]);
  }
  return count <= RATE_LIMIT_MAX;
}

export async function countPendingForPrincipal(principalAddress: string): Promise<number> {
  if (!USE_REMOTE_KV) {
    const bucket = localPrincipalIndex.get(normalizePrincipal(principalAddress));
    if (!bucket) return 0;

    let count = 0;
    for (const requestId of bucket) {
      const reg = localStore.get(requestId);
      if (
        reg &&
        reg.status === "pending" &&
        reg.expiresAt >= Date.now()
      ) {
        count += 1;
      } else if (!reg || reg.expiresAt < Date.now()) {
        localDeleteRegistration(requestId, principalAddress);
      }
    }
    return count;
  }

  const ids =
    (await kvCommand<string[]>(["SMEMBERS", remotePrincipalKey(principalAddress)])) ?? [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return 0;
  }

  let count = 0;
  const cleanup: Array<Promise<unknown>> = [];
  const regs = await Promise.all(ids.map((requestId) => getRegistration(requestId)));
  regs.forEach((reg, index) => {
    const requestId = ids[index];
    if (reg && reg.status === "pending" && reg.expiresAt >= Date.now()) {
      count += 1;
      return;
    }
    cleanup.push(kvCommand<number>(["SREM", remotePrincipalKey(principalAddress), requestId]));
    if (reg && reg.status === "pending" && reg.expiresAt < Date.now()) {
      cleanup.push(remoteDeleteRegistration(requestId, principalAddress));
    }
  });
  if (cleanup.length > 0) {
    await Promise.all(cleanup);
  }
  return count;
}

export async function createPendingRegistration(
  reg: PendingRegistration,
  agentPrivateKey: string,
): Promise<void> {
  if (!USE_REMOTE_KV) {
    localStore.set(reg.requestId, { ...reg });
    localSecrets.set(reg.requestId, agentPrivateKey);
    localAddToPrincipalIndex(reg.principalAddress, reg.requestId);
    return;
  }

  await remoteSetRegistration(reg);
  await remoteSetSecret(reg.requestId, agentPrivateKey, reg.expiresAt);
  await kvCommand<number>(["SADD", remotePrincipalKey(reg.principalAddress), reg.requestId]);
  await kvCommand<number>([
    "EXPIRE",
    remotePrincipalKey(reg.principalAddress),
    ttlSeconds(reg.expiresAt),
  ]);
}

export async function getRegistration(requestId: string): Promise<PendingRegistration | null> {
  if (!USE_REMOTE_KV) {
    return localStore.get(requestId) ?? null;
  }

  const payload = await kvCommand<string | null>(["GET", remoteRequestKey(requestId)]);
  if (!payload) return null;
  return JSON.parse(payload) as PendingRegistration;
}

export async function setRegistration(reg: PendingRegistration): Promise<void> {
  if (!USE_REMOTE_KV) {
    localStore.set(reg.requestId, { ...reg });
    return;
  }
  await remoteSetRegistration(reg);
}

export async function deleteRegistration(
  requestId: string,
  principalAddress?: string,
): Promise<void> {
  if (!USE_REMOTE_KV) {
    localDeleteRegistration(requestId, principalAddress);
    return;
  }
  await remoteDeleteRegistration(requestId, principalAddress);
}

export async function consumeApprovedPrivateKey(
  requestId: string,
): Promise<string | null> {
  const reg = await getRegistration(requestId);
  if (!reg) return null;

  const secret = !USE_REMOTE_KV
    ? (localSecrets.get(requestId) ?? null)
    : await remoteConsumeSecret(requestId);

  if (!USE_REMOTE_KV) {
    localSecrets.delete(requestId);
  }

  if (!reg.keyDelivered) {
    reg.keyDelivered = true;
    await setRegistration(reg);
  }

  return secret;
}

export function usingRemoteRegistrationStore(): boolean {
  return USE_REMOTE_KV;
}

export function registrationStoreMode(): "remote-kv" | "memory" {
  return USE_REMOTE_KV ? "remote-kv" : "memory";
}

export { TTL_MS };
