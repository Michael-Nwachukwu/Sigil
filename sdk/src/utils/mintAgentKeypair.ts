/**
 * Sigil Protocol — fresh agent-wallet generator.
 *
 * Used by both the SDK (principal-side register flow) and the API server
 * (sponsored-registration flow). Always produces a NEW random keypair —
 * never reuse across passports.
 *
 * The returned `agentPrivateKey` MUST be:
 *   - returned to the caller exactly once
 *   - stored in the agent runtime's secrets manager
 *   - never persisted by Sigil and never logged
 *
 * For Phase 5b sponsored registrations, the API server's pending-registration
 * store keeps the key in memory (single-shot delivery) until the principal
 * approves and the runtime fetches it.
 */

import { Wallet } from 'ethers';
import { redactSensitiveFields } from './logger';

export interface MintedAgentKeypair {
  agentAddress: string;
  agentPrivateKey: string;
}

export function mintAgentKeypair(): MintedAgentKeypair {
  const wallet = Wallet.createRandom();
  return {
    agentAddress: wallet.address,
    agentPrivateKey: wallet.privateKey,
  };
}

/**
 * Returns a redacted view of a minted keypair safe to log / surface in
 * error responses. Use this whenever a caller needs the address but not the
 * private key in the same payload.
 */
export function redactMintedKeypair(kp: MintedAgentKeypair): MintedAgentKeypair {
  return redactSensitiveFields(kp);
}
