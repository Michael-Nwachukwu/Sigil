/**
 * Shared helper — build the optional auto-attest sidecar config from the
 * `SIGIL_KEEPER_RELAY_PRIVATE_KEY` env var. Returns `undefined` when the key
 * is unset so demo runners stay zero-config on a fresh checkout.
 *
 * The sidecar is a DEMO SIMULATOR — every attestation is marked passed=true.
 * See sdk/src/passport/AutoAttest.ts.
 */

import { Wallet, type JsonRpcProvider } from 'ethers';

export interface AutoAttestEnv {
  relaySigner: Wallet;
  defaultPassed: true;
}

export function autoAttestFromEnv(provider: JsonRpcProvider): AutoAttestEnv | undefined {
  const key = process.env.SIGIL_KEEPER_RELAY_PRIVATE_KEY;
  if (!key) return undefined;
  return {
    relaySigner: new Wallet(key, provider),
    defaultPassed: true,
  };
}

export function describeAutoAttest(env: AutoAttestEnv | undefined): string {
  return env
    ? `ON (relay ${env.relaySigner.address}) — DEMO SIMULATOR`
    : 'OFF (set SIGIL_KEEPER_RELAY_PRIVATE_KEY + run add-relay to enable)';
}
