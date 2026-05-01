/**
 * Browser-side permission-manifest decrypt.
 *
 * Mirrors `sdk/src/utils/crypto.ts` but uses Web Crypto (HKDF + AES-GCM)
 * instead of node:crypto. The principal signs the same deterministic message
 * the SDK uses, the signature is HKDF-stretched into a 32-byte AES key, and
 * the ciphertext from 0G Storage is decrypted in the browser. The on-chain
 * `permissionManifestHash` is verified against the downloaded ciphertext as
 * a tamper check before any decryption is attempted.
 *
 * Dependencies on the rest of the demo:
 *   - `tokenURI(tokenId)` is read directly via the public Galileo RPC.
 *   - Ciphertext is fetched through `/api/storage/<rootHash>` (the same
 *     server-side proxy the resolve page uses for provenance envelopes).
 */

import { Contract, JsonRpcProvider, getBytes, hexlify, keccak256 } from "ethers";

import {
  CHAIN_ID,
  REGISTRY_ADDRESS,
  RPC_URL,
  type Hex32,
  type PassportRecord,
} from "./sigil-read";

const REGISTRY_ABI = [
  "function tokenURI(uint256 tokenId) external view returns (string)",
] as const;

const KEY_DERIVATION_LABEL = "sigil-key-derivation";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type ManifestDecryptResult =
  | { status: "ok"; plaintext: string; manifest: unknown }
  | { status: "error"; reason: string };

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export function keyDerivationMessage(passportId: string): string {
  return `${KEY_DERIVATION_LABEL}:${passportId.toLowerCase()}`;
}

let cachedReadProvider: JsonRpcProvider | null = null;
function readProvider(): JsonRpcProvider {
  if (!cachedReadProvider) {
    cachedReadProvider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
  }
  return cachedReadProvider;
}

async function fetchManifestCiphertext(
  passport: PassportRecord,
): Promise<{ rootHash: Hex32; ciphertext: Uint8Array }> {
  const registry = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, readProvider());
  const uri = (await registry.tokenURI(passport.tokenId)) as string;
  if (!uri.startsWith("og-storage:")) {
    throw new Error(`unsupported metadataUri scheme: "${uri}"`);
  }
  const rootHash = uri.slice("og-storage:".length) as Hex32;
  if (!/^0x[0-9a-f]{64}$/i.test(rootHash)) {
    throw new Error(`bad rootHash decoded from URI: "${rootHash}"`);
  }
  const res = await fetch(`/api/storage/${rootHash}`);
  if (!res.ok) {
    throw new Error(`storage proxy returned ${res.status}`);
  }
  const ciphertext = new Uint8Array(await res.arrayBuffer());
  const computed = keccak256(hexlify(ciphertext)).toLowerCase();
  if (computed !== passport.permissionManifestHash.toLowerCase()) {
    throw new Error(
      `manifest tampered: on-chain ${passport.permissionManifestHash} != computed ${computed}`,
    );
  }
  return { rootHash, ciphertext };
}

/**
 * HKDF-SHA256 stretch: ikm=signature_bytes, salt=passportId_bytes,
 * info="sigil-key-derivation", L=32. Identical to the SDK's
 * `deriveSymmetricKey()` — re-implemented on Web Crypto for the browser.
 */
async function deriveKeyFromSignature(
  signatureHex: string,
  passportId: string,
): Promise<CryptoKey> {
  const ikm = getBytes(signatureHex);
  const salt = getBytes(passportId);
  const info = new TextEncoder().encode(KEY_DERIVATION_LABEL);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    ikm as BufferSource,
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: info as BufferSource,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

/**
 * Decrypt a permission manifest in the browser. The wallet whose signer is
 * passed in MUST be the recorded principal — any other wallet derives a
 * different HKDF key and AES-GCM authentication fails.
 */
export async function decryptManifestInBrowser(args: {
  passport: PassportRecord;
  wallet: EthereumProvider;
  account: string;
}): Promise<ManifestDecryptResult> {
  const { passport, wallet, account } = args;
  if (account.toLowerCase() !== passport.principal.toLowerCase()) {
    return {
      status: "error",
      reason: "connected wallet is not the recorded principal",
    };
  }

  let ciphertext: Uint8Array;
  try {
    ({ ciphertext } = await fetchManifestCiphertext(passport));
  } catch (err) {
    return { status: "error", reason: (err as Error).message };
  }

  if (ciphertext.length < IV_LENGTH + TAG_LENGTH) {
    return { status: "error", reason: "ciphertext too short" };
  }

  let signatureHex: string;
  try {
    const message = keyDerivationMessage(passport.passportId);
    signatureHex = (await wallet.request({
      method: "personal_sign",
      params: [message, account],
    })) as string;
  } catch (err) {
    return {
      status: "error",
      reason: `wallet refused to sign: ${(err as Error).message}`,
    };
  }

  let key: CryptoKey;
  try {
    key = await deriveKeyFromSignature(signatureHex, passport.passportId);
  } catch (err) {
    return {
      status: "error",
      reason: `key derivation failed: ${(err as Error).message}`,
    };
  }

  // The SDK lays out [iv (12) || authTag (16) || ciphertext]. Web Crypto
  // expects [ciphertext || authTag], so we reassemble the trailing block.
  const iv = ciphertext.subarray(0, IV_LENGTH);
  const authTag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = ciphertext.subarray(IV_LENGTH + TAG_LENGTH);
  const aesPayload = new Uint8Array(ct.length + authTag.length);
  aesPayload.set(ct, 0);
  aesPayload.set(authTag, ct.length);

  let plainBytes: ArrayBuffer;
  try {
    plainBytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      aesPayload as BufferSource,
    );
  } catch {
    return {
      status: "error",
      reason: "AES-GCM authentication failed — wrong wallet, or tampered bytes",
    };
  }

  const plaintext = new TextDecoder().decode(plainBytes);
  let manifest: unknown;
  try {
    manifest = JSON.parse(plaintext);
  } catch {
    manifest = plaintext;
  }
  return { status: "ok", plaintext, manifest };
}
