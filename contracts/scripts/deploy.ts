/**
 * Sigil Protocol — deployment script.
 *
 * Deploys SigilRegistry + ProvenanceNotary, wires the registry's
 * provenance-notary pointer, optionally adds a relay, and writes addresses
 * to `deployments/<network>.json` per CLAUDE.md memory rule (deployments are
 * tracked in git).
 *
 * Usage:
 *   pnpm --filter @sigil/contracts run deploy:testnet
 *   pnpm --filter @sigil/contracts run deploy:local
 */

import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { NETWORKS } from '../../config/networks';

interface DeploymentRecord {
  network: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  deployer: string;
  contracts: {
    SigilRegistry: string;
    ProvenanceNotary: string;
  };
  relays: string[];
  blockNumber: number;
  timestamp: number;
}

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const balance = await ethers.provider.getBalance(deployerAddress);

  console.log(`Network:       ${network.name} (chainId=${network.config.chainId})`);
  console.log(`Deployer:      ${deployerAddress}`);
  console.log(`Balance:       ${ethers.formatEther(balance)} OG`);

  if (balance === 0n && network.name !== 'hardhat') {
    throw new Error(
      `Deployer ${deployerAddress} has zero balance on ${network.name}. ` +
        'Top up before deploying. (https://faucet.0g.ai for galileo)',
    );
  }

  // ------- SigilRegistry -------
  const Registry = await ethers.getContractFactory('SigilRegistry');
  const registry = await Registry.deploy(deployerAddress);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`SigilRegistry: ${registryAddress}`);

  // ------- ProvenanceNotary -------
  const Notary = await ethers.getContractFactory('ProvenanceNotary');
  const notary = await Notary.deploy(registryAddress);
  await notary.waitForDeployment();
  const notaryAddress = await notary.getAddress();
  console.log(`Notary:        ${notaryAddress}`);

  // ------- Wire registry → notary -------
  const wireTx = await registry.setProvenanceNotary(notaryAddress);
  const wireReceipt = await wireTx.wait();
  if (!wireReceipt || wireReceipt.status !== 1) {
    throw new Error('setProvenanceNotary failed');
  }
  console.log(`Wired notary in registry (tx=${wireTx.hash})`);

  // ------- Optional relay registration from env -------
  const relayList = (process.env.KEEPERHUB_RELAY_ADDRESSES ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => ethers.isAddress(s));

  for (const relay of relayList) {
    const tx = await registry.addRelay(relay);
    const r = await tx.wait();
    if (!r || r.status !== 1) {
      throw new Error(`addRelay ${relay} failed`);
    }
    console.log(`Added relay:   ${relay}`);
  }

  // ------- Persist deployment record -------
  const blockNumber = await ethers.provider.getBlockNumber();

  const deploymentKey =
    network.name === 'galileo'
      ? 'galileo-testnet'
      : network.name === 'hardhat'
        ? 'hardhat'
        : network.name;

  const cfg = NETWORKS[deploymentKey as keyof typeof NETWORKS];

  const record: DeploymentRecord = {
    network: deploymentKey,
    chainId: Number(network.config.chainId ?? cfg?.chainId ?? 0),
    rpcUrl: cfg?.rpcUrl ?? '',
    explorerUrl: cfg?.explorerUrl ?? '',
    deployer: deployerAddress,
    contracts: {
      SigilRegistry: registryAddress,
      ProvenanceNotary: notaryAddress,
    },
    relays: relayList,
    blockNumber,
    timestamp: Math.floor(Date.now() / 1000),
  };

  const deploymentsDir = path.resolve(__dirname, '..', '..', 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const outFile = path.join(deploymentsDir, `${deploymentKey}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2) + '\n');

  console.log(`\nDeployment record written → ${outFile}`);
  if (cfg?.explorerUrl) {
    console.log(`Registry on explorer: ${cfg.explorerUrl}/address/${registryAddress}`);
    console.log(`Notary on explorer:   ${cfg.explorerUrl}/address/${notaryAddress}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
