/**
 * Sigil demo — register the auto-attest sidecar's keeper relay address on
 * SigilRegistry. One-shot, idempotent: re-running with the same key is a
 * cheap no-op (the contract just records `_keeperRelays[relay] = true`
 * again and emits another RelayAdded event).
 *
 *   pnpm --filter sigil-demo run add-relay
 *
 * Reads:
 *   - ZERO_G_PRIVATE_KEY            (deployer / contract owner — pays gas)
 *   - SIGIL_KEEPER_RELAY_PRIVATE_KEY (relay key the sidecar will sign with)
 *   - ZERO_G_RPC_URL, ZERO_G_CHAIN_ID, SIGIL_REGISTRY_ADDRESS
 *
 * Why this exists: AutoAttestSidecar calls `appendAttestation`, which is
 * gated by `onlyKeeperRelay`. Without registering the relay address first,
 * every notarize() in the demo would log a sidecar warning and the
 * counters/reputation on the resolve page would stay at zero. Registering
 * once at setup time fixes that for the rest of the hackathon.
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
  const relayKey = requireEnv('SIGIL_KEEPER_RELAY_PRIVATE_KEY');
  const registryAddress = requireEnv('SIGIL_REGISTRY_ADDRESS');
  const explorer = process.env.ZERO_G_EXPLORER_URL ?? 'https://chainscan-galileo.0g.ai';

  if (!isAddress(registryAddress)) {
    process.stderr.write(`SIGIL_REGISTRY_ADDRESS not a valid address: ${registryAddress}\n`);
    process.exit(1);
  }

  const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
  const ownerWallet = new Wallet(ownerKey, provider);
  const relayWallet = new Wallet(relayKey, provider);
  const registry = new Contract(registryAddress, REGISTRY_ABI, ownerWallet);

  process.stdout.write(`\nadd-relay\n`);
  process.stdout.write(`  registry      ${registryAddress}\n`);
  process.stdout.write(`  owner signer  ${ownerWallet.address}\n`);
  process.stdout.write(`  relay address ${relayWallet.address}\n`);

  const onChainOwner: string = await registry.owner();
  if (onChainOwner.toLowerCase() !== ownerWallet.address.toLowerCase()) {
    process.stderr.write(
      `\nERROR: ZERO_G_PRIVATE_KEY (${ownerWallet.address}) is not the registry owner (${onChainOwner}).\n` +
        `addRelay is onlyOwner — re-run from the deployer key.\n`,
    );
    process.exit(1);
  }

  const already: boolean = await registry.isRelay(relayWallet.address);
  if (already) {
    process.stdout.write(`\n  relay already registered — nothing to do.\n`);
    return;
  }

  process.stdout.write(`\n  submitting addRelay…\n`);
  const tx = await registry.addRelay(relayWallet.address);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    process.stderr.write(`addRelay failed (status ${receipt?.status})\n`);
    process.exit(1);
  }
  process.stdout.write(`  relay added in tx ${explorer}/tx/${receipt.hash}\n`);

  const relayBalance = await provider.getBalance(relayWallet.address);
  process.stdout.write(
    `  relay balance ${relayBalance.toString()} wei (fund via faucet if 0; appendAttestation costs gas)\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`FATAL: ${(err as Error).message}\n`);
  process.exit(1);
});
