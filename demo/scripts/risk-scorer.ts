/**
 * Sigil demo — risk-scorer runner.
 *
 * One command, end-to-end. On first run it registers a fresh "RiskScorer"
 * agent under the principal wallet, funds it from the principal, and caches
 * the agent keypair + passportId in `demo/.fixtures/risk-scorer.json`. On
 * subsequent runs it loads the fixture and reuses the existing passport so
 * we don't pay registration gas every time.
 *
 *   pnpm --filter sigil-demo run risk-scorer [<defillama-slug>]
 *
 * Default slug is "aave-v3". Try "lido", "compound-v3", "uniswap", etc.
 *
 * Env (read from repo-root .env):
 *   ZERO_G_RPC_URL, ZERO_G_CHAIN_ID, ZERO_G_PRIVATE_KEY (principal),
 *   SIGIL_REGISTRY_ADDRESS, PROVENANCE_NOTARY_ADDRESS,
 *   ZERO_G_COMPUTE_DEFAULT_MODEL, ZERO_G_EXPLORER_URL.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import { SigilClient, ZeroGComputeAdapter, type PassportId } from 'sigil-protocol';
import { RiskScorerAgent } from '../agents/RiskScorerAgent';
import { autoAttestFromEnv, describeAutoAttest } from './_autoAttest';

const FIXTURE_DIR = path.resolve(__dirname, '../.fixtures');
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'risk-scorer.json');

interface RiskScorerFixture {
  passportId: PassportId;
  agentAddress: string;
  agentPrivateKey: string;
  registerTx: string;
  fundTx: string;
  registeredAt: string;
}

function header(t: string) {
  console.log(`\n=== ${t} ===`);
}
function pass(t: string) {
  console.log(`  PASS ${t}`);
}
function info(t: string) {
  console.log(`  · ${t}`);
}
function fail(t: string, err?: unknown): never {
  console.log(`  FAIL ${t}`);
  if (err) console.log('  ', err);
  process.exit(1);
}

function buildProvider(rpc: string, chainId: number): ethers.JsonRpcProvider {
  const fetchReq = new ethers.FetchRequest(rpc);
  fetchReq.timeout = 60_000;
  return new ethers.JsonRpcProvider(fetchReq, {
    chainId,
    name: '0g-galileo-testnet',
  });
}

async function setupOrLoad(opts: {
  rpc: string;
  chainId: number;
  registryAddress: string;
  notaryAddress: string;
  model: string;
  principal: ethers.Wallet;
  provider: ethers.JsonRpcProvider;
}): Promise<RiskScorerFixture> {
  if (fs.existsSync(FIXTURE_FILE)) {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8')) as RiskScorerFixture;
    pass(`loaded fixture: ${path.relative(process.cwd(), FIXTURE_FILE)}`);
    info(`passportId   = ${fixture.passportId}`);
    info(`agentAddress = ${fixture.agentAddress}`);
    info(`registeredAt = ${fixture.registeredAt}`);
    return fixture;
  }
  info('no fixture found — registering a fresh RiskScorer agent');

  const principalSigil = new SigilClient({
    rpcUrl: opts.rpc,
    chainId: opts.chainId,
    registryAddress: opts.registryAddress,
    notaryAddress: opts.notaryAddress,
    signer: opts.principal,
    computeDefaultModel: opts.model,
  });

  const registration = await principalSigil.passport.register({
    agentDescription:
      'Sigil demo RiskScorerAgent — DeFi protocol risk scoring via 0G Compute (qwen-2.5-7b-instruct), inputs from DefiLlama public API',
    permissions: {
      whitelistedContracts: [],
      maxTxValuePerWindow: { OG: 0 },
      authorizedApis: ['0g.compute', 'defillama.api'],
      allowedTokens: ['OG'],
      timeWindowSeconds: 3600,
    },
  });
  pass(`registered passportId   = ${registration.passportId}`);
  pass(`agentAddress            = ${registration.agentAddress}`);
  pass(`registerTx              = ${registration.txHash}`);

  const agentAddr = registration.agentAddress;
  const fundAmount = ethers.parseEther('0.05');
  const fundTx = await opts.principal.sendTransaction({ to: agentAddr, value: fundAmount });
  const fundReceipt = await fundTx.wait();
  if (!fundReceipt || fundReceipt.status !== 1) {
    fail(`fund-agent tx ${fundTx.hash} did not confirm cleanly`);
  }
  pass(`funded agent with 0.05 OG (tx ${fundTx.hash})`);

  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const fixture: RiskScorerFixture = {
    passportId: registration.passportId,
    agentAddress: registration.agentAddress,
    agentPrivateKey: registration.agentPrivateKey,
    registerTx: registration.txHash,
    fundTx: fundTx.hash,
    registeredAt: new Date().toISOString(),
  };
  fs.writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  pass(`fixture written: ${path.relative(process.cwd(), FIXTURE_FILE)} (mode 0600)`);
  return fixture;
}

async function main() {
  const slug = process.argv[2] ?? 'aave-v3';

  const rpc = process.env.ZERO_G_RPC_URL ?? fail('ZERO_G_RPC_URL not set');
  const chainId = Number(process.env.ZERO_G_CHAIN_ID ?? '16602');
  const principalKey = process.env.ZERO_G_PRIVATE_KEY ?? fail('ZERO_G_PRIVATE_KEY not set');
  const registryAddress = process.env.SIGIL_REGISTRY_ADDRESS ?? fail('SIGIL_REGISTRY_ADDRESS not set');
  const notaryAddress = process.env.PROVENANCE_NOTARY_ADDRESS ?? fail('PROVENANCE_NOTARY_ADDRESS not set');
  const model = process.env.ZERO_G_COMPUTE_DEFAULT_MODEL ?? 'qwen/qwen-2.5-7b-instruct';
  const explorer = process.env.ZERO_G_EXPLORER_URL ?? 'https://chainscan-galileo.0g.ai';

  const provider = buildProvider(rpc as string, chainId);
  const principal = new ethers.Wallet(principalKey as string, provider);

  header('Setup');
  info(`principal: ${principal.address}`);
  info(`balance:   ${ethers.formatEther(await provider.getBalance(principal.address))} OG`);
  info(`registry:  ${registryAddress}`);
  info(`notary:    ${notaryAddress}`);
  info(`slug:      ${slug}`);

  header('1. Register or load RiskScorer agent');
  const fixture = await setupOrLoad({
    rpc: rpc as string,
    chainId,
    registryAddress: registryAddress as string,
    notaryAddress: notaryAddress as string,
    model,
    principal,
    provider,
  });

  const agentWallet = new ethers.Wallet(fixture.agentPrivateKey, provider);
  const agentBalance = await provider.getBalance(agentWallet.address);
  info(`agent balance: ${ethers.formatEther(agentBalance)} OG`);
  if (agentBalance < ethers.parseEther('0.005')) {
    fail(`agent ${agentWallet.address} is underfunded (needs ≥ 0.005 OG for notarize gas); top up from principal`);
  }

  header('2. Build agent-side SigilClient');
  const autoAttest = autoAttestFromEnv(provider);
  const agentSigil = new SigilClient({
    rpcUrl: rpc as string,
    chainId,
    registryAddress: registryAddress as string,
    notaryAddress: notaryAddress as string,
    signer: agentWallet,
    computeDefaultModel: model,
    autoAttest,
  });
  pass(`signer = ${agentWallet.address} (the registered agent)`);
  pass(`auto-attest ${describeAutoAttest(autoAttest)}`);

  header('3. Build principal-side ZeroGComputeAdapter');
  // Inference is billed to the principal's funded ledger (3 OG min). The
  // agent only holds gas money for notarize() — it does NOT have its own
  // compute ledger. See ZeroGComputeAdapter docstring + CLAUDE.md dual
  // wallet model.
  const principalCompute = new ZeroGComputeAdapter({
    signer: principal,
    defaultModel: model,
  });
  pass(`compute signer = ${principal.address} (principal funds inference)`);

  header(`4. RiskScorerAgent.scoreProtocol("${slug}")`);
  const agent = new RiskScorerAgent({
    sigil: agentSigil,
    compute: principalCompute,
    passportId: fixture.passportId,
    model,
  });
  const start = Date.now();
  const assessment = await agent.scoreProtocol(slug);
  const elapsedMs = Date.now() - start;
  pass(`completed in ${elapsedMs}ms`);

  header('5. Result');
  pass(`protocol             = ${assessment.metrics.name} (${assessment.metrics.slug})`);
  pass(`category             = ${assessment.metrics.category ?? 'n/a'}`);
  pass(`currentTvlUsd        = $${assessment.metrics.currentTvlUsd.toLocaleString()}`);
  pass(`riskScore            = ${assessment.score.riskScore}`);
  pass(`confidence           = ${assessment.score.confidence}`);
  info(`reasoning            = ${assessment.score.reasoning}`);
  info('');
  pass(`receipt.modelId      = ${assessment.receipt.modelId}`);
  pass(`receipt.outputHash   = ${assessment.receipt.outputHash}`);
  pass(`TEE verified         = ${String(assessment.verified)}`);
  info('');
  pass(`recordId             = ${assessment.notarized.recordId}`);
  pass(`notarizeTx           = ${assessment.notarized.txHash}`);
  pass(`proofRootHash        = ${assessment.notarized.proofRootHash}`);
  pass(`inputContextRootHash = ${assessment.notarized.inputContextRootHash}`);
  if (assessment.notarized.attestation) {
    pass(`attestationTx        = ${assessment.notarized.attestation.txHash} (demo-simulated)`);
  }

  console.log('\n=== Verifiable on-chain ===');
  console.log(`  notarize tx:  ${explorer}/tx/${assessment.notarized.txHash}`);
  if (assessment.notarized.attestation) {
    console.log(`  attest tx:    ${explorer}/tx/${assessment.notarized.attestation.txHash}`);
  }
  console.log(`  notary contract: ${explorer}/address/${notaryAddress}`);
  console.log(`  registry contract: ${explorer}/address/${registryAddress}`);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
