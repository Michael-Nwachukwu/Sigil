/**
 * Sigil demo — top up an agent wallet from the principal.
 *
 * Each chat/notarize turn burns OG on:
 *   - 2× 0G Storage submit txs (input context + sealed receipt) ≈ ~0.005 OG
 *   - 1× notarize tx on ProvenanceNotary
 * The fund-on-register flow only seeds 0.05 OG, which runs dry after a handful
 * of turns and surfaces as opaque `require(false)` reverts inside 0G's flow
 * contract during `estimateGas` on the next storage upload.
 *
 *   pnpm --filter sigil-demo run top-up -- --name prompt-agent
 *   pnpm --filter sigil-demo run top-up -- --name prompt-agent --amount 0.1
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { ethers } from 'ethers';

loadEnv({ path: path.resolve(__dirname, '../../.env') });

interface Args {
  name: string;
  amount: string;
}

function parseArgs(argv: string[]): Args {
  let name = 'prompt-agent';
  let amount = '0.1';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '-n') name = argv[++i] ?? name;
    else if (a === '--amount' || a === '-a') amount = argv[++i] ?? amount;
  }
  return { name, amount };
}

function fixturePath(name: string): string {
  return path.resolve(__dirname, `../.fixtures/${name}.json`);
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    process.stderr.write(`missing required env var: ${key}\n`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fp = fixturePath(args.name);
  if (!fs.existsSync(fp)) {
    process.stderr.write(`no fixture at ${fp}\n`);
    process.exit(1);
  }
  const fixture = JSON.parse(fs.readFileSync(fp, 'utf8')) as {
    agentAddress: string;
  };

  const rpc = requireEnv('ZERO_G_RPC_URL');
  const principalKey = requireEnv('ZERO_G_PRIVATE_KEY');
  const chainId = Number(process.env.ZERO_G_CHAIN_ID ?? '16602');

  const fr = new ethers.FetchRequest(rpc);
  fr.timeout = 60_000;
  const provider = new ethers.JsonRpcProvider(fr, { chainId, name: '0g-galileo-testnet' });
  const principal = new ethers.Wallet(principalKey, provider);

  const before = await provider.getBalance(fixture.agentAddress);
  process.stdout.write(`agent ${fixture.agentAddress}\n`);
  process.stdout.write(`  before: ${ethers.formatEther(before)} OG\n`);

  const value = ethers.parseEther(args.amount);
  const principalBal = await provider.getBalance(principal.address);
  if (principalBal < value) {
    process.stderr.write(
      `principal ${principal.address} only has ${ethers.formatEther(principalBal)} OG, ` +
        `cannot send ${args.amount} OG\n`,
    );
    process.exit(1);
  }

  const tx = await principal.sendTransaction({
    to: fixture.agentAddress,
    value,
  });
  process.stdout.write(`  fund tx: ${tx.hash}\n`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    process.stderr.write(`fund tx ${tx.hash} did not confirm cleanly\n`);
    process.exit(1);
  }

  const after = await provider.getBalance(fixture.agentAddress);
  process.stdout.write(`  after:  ${ethers.formatEther(after)} OG\n`);
  process.stdout.write(`  added:  ${args.amount} OG\n`);
}

main().catch((err) => {
  process.stderr.write(`top-up failed: ${(err as Error).message}\n`);
  process.exit(1);
});
