import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load .env from repo root (not contracts/.env). Anti-Hallucination Rule 6:
// chain ID + RPC come from config/networks.ts; the only thing pulled from .env
// here is the deployer key.
const repoRoot = path.resolve(__dirname, '..');
const envPath = path.join(repoRoot, '.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

// Lazy-import config/networks.ts so type errors in the config don't break
// hardhat compile when the deployer key is unset (CI / fresh clones).
import { NETWORKS } from '../config/networks';

const galileo = NETWORKS['galileo-testnet'];

const deployerKey = process.env.ZERO_G_PRIVATE_KEY?.trim();
const galileoAccounts = deployerKey && deployerKey.length > 0 ? [deployerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      // OpenZeppelin v5 latest uses `mcopy` (Cancun opcode). 0G's EVM tracks
      // upstream Ethereum forks, so Cancun is safe for testnet deployment.
      evmVersion: 'cancun',
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // notarize() has many params (passportId, hashes, signature, etc.);
      // viaIR avoids "stack too deep" without contortion.
      viaIR: true,
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    galileo: {
      url: galileo.rpcUrl,
      chainId: galileo.chainId,
      accounts: galileoAccounts,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === 'true',
    currency: 'USD',
  },
  mocha: {
    timeout: 120_000,
  },
};

export default config;
