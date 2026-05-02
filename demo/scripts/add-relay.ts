/**
 * Sigil demo — register a keeper relay address on SigilRegistry.
 *
 * Supports two modes for specifying the relay:
 *   1. SIGIL_KEEPER_RELAY_ADDRESS   (direct address — use for KeeperHub Para MPC wallet)
 *   2. SIGIL_KEEPER_RELAY_PRIVATE_KEY (derives address from key — use for local relay wallet)
 *
 * SIGIL_KEEPER_RELAY_ADDRESS takes precedence if both are set.
 *
 *   pnpm --filter sigil-demo run add-relay
 *
 * Reads:
 *   - ZERO_G_PRIVATE_KEY              (deployer / contract owner — pays gas)
 *   - SIGIL_KEEPER_RELAY_ADDRESS      (relay address — KeeperHub Para MPC wallet)
 *     OR SIGIL_KEEPER_RELAY_PRIVATE_KEY (relay key — local wallet)
 *   - ZERO_G_RPC_URL, ZERO_G_CHAIN_ID, SIGIL_REGISTRY_ADDRESS
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import { Contract, JsonRpcProvider, Wallet, isAddress } from 'ethers';

const REGISTRY_ABI = [
  'function addRelay(address relay) external',
  'function isRelay(address relay) external view returns (bool)',
  'function owner() external view returns (address)',
] as const;

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    process.stderr.write(`missing required env var: ${key}\n`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const rpc = requireEnv('ZERO_G_RPC_URL');
  const chainId = Number(process.env.ZERO_G_CHAIN_ID ?? '16602');
  const ownerKey = requireEnv('ZERO_G_PRIVATE_KEY');
  const registryAddress = requireEnv('SIGIL_REGISTRY_ADDRESS');
  const explorer = process.env.ZERO_G_EXPLORER_URL ?? 'https://chainscan-galileo.0g.ai';

  if (!isAddress(registryAddress)) {
    process.stderr.write(`SIGIL_REGISTRY_ADDRESS not a valid address: ${registryAddress}\n`);
    process.exit(1);
  }

  // Resolve relay address: direct address takes precedence over derived-from-key
  const relayAddressEnv = process.env.SIGIL_KEEPER_RELAY_ADDRESS;
  const relayKeyEnv = process.env.SIGIL_KEEPER_RELAY_PRIVATE_KEY;

  let relayAddress: string;
  if (relayAddressEnv) {
    if (!isAddress(relayAddressEnv)) {
      process.stderr.write(`SIGIL_KEEPER_RELAY_ADDRESS is not a valid address: ${relayAddressEnv}\n`);
      process.exit(1);
    }
    relayAddress = relayAddressEnv;
    process.stdout.write(`  relay source  SIGIL_KEEPER_RELAY_ADDRESS (KeeperHub Para MPC wallet)\n`);
  } else if (relayKeyEnv) {
    relayAddress = new Wallet(relayKeyEnv).address;
    process.stdout.write(`  relay source  SIGIL_KEEPER_RELAY_PRIVATE_KEY (local wallet)\n`);
  } else {
    process.stderr.write(
      `missing relay config — set SIGIL_KEEPER_RELAY_ADDRESS (for KeeperHub Para MPC wallet)\n` +
        `or SIGIL_KEEPER_RELAY_PRIVATE_KEY (for local relay wallet)\n`,
    );
    process.exit(1);
  }

  const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
  const ownerWallet = new Wallet(ownerKey, provider);
  const registry = new Contract(registryAddress, REGISTRY_ABI, ownerWallet);

  process.stdout.write(`\nadd-relay\n`);
  process.stdout.write(`  registry      ${registryAddress}\n`);
  process.stdout.write(`  owner signer  ${ownerWallet.address}\n`);
  process.stdout.write(`  relay address ${relayAddress}\n`);

  const onChainOwner: string = await registry.owner();
  if (onChainOwner.toLowerCase() !== ownerWallet.address.toLowerCase()) {
    process.stderr.write(
      `\nERROR: ZERO_G_PRIVATE_KEY (${ownerWallet.address}) is not the registry owner (${onChainOwner}).\n` +
        `addRelay is onlyOwner — re-run from the deployer key.\n`,
    );
    process.exit(1);
  }

  const already: boolean = await registry.isRelay(relayAddress);
  if (already) {
    process.stdout.write(`\n  relay already registered — nothing to do.\n`);
    return;
  }

  process.stdout.write(`\n  submitting addRelay…\n`);
  const tx = await registry.addRelay(relayAddress);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    process.stderr.write(`addRelay failed (status ${receipt?.status})\n`);
    process.exit(1);
  }
  process.stdout.write(`  relay added in tx ${explorer}/tx/${receipt.hash}\n`);

  const relayBalance = await provider.getBalance(relayAddress);
  process.stdout.write(
    `  relay balance ${relayBalance.toString()} wei\n`,
  );
  if (relayAddressEnv && relayBalance === 0n) {
    process.stdout.write(
      `  NOTE: KeeperHub Para MPC wallet needs OG to pay gas for appendAttestation calls.\n` +
        `  Send at least 0.05 OG to ${relayAddress} before running the demo.\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${(err as Error).message}\n`);
  process.exit(1);
});
