/**
 * Sigil demo — audit-agent runner.
 *
 *   pnpm --filter sigil-demo run audit-agent [<fixture-or-path>]
 *
 * Argument resolution:
 *   - If the arg is a path that exists on disk, read it as Solidity.
 *   - Else if it matches a built-in fixture name, use that.
 *   - Else default to "vault-reentrancy" (textbook reentrancy bug).
 *
 * Reuses the same setup-or-load pattern as risk-scorer.ts: first run
 * registers a fresh "AuditAgent" passport + funds it with 0.05 OG; later
 * runs load `.fixtures/audit-agent.json`.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import { SigilClient, ZeroGComputeAdapter, type PassportId } from 'sigil-protocol';
import { AuditAgent, AUDIT_FIXTURES } from '../agents/AuditAgent';

const FIXTURE_DIR = path.resolve(__dirname, '../.fixtures');
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'audit-agent.json');

interface AuditAgentFixture {
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

function resolveTarget(arg: string | undefined): { name: string; source: string } {
  // Disk path?
  if (arg && fs.existsSync(arg) && fs.statSync(arg).isFile()) {
    const source = fs.readFileSync(arg, 'utf8');
    return { name: path.basename(arg), source };
  }
  // Built-in fixture?
  const key = arg ?? 'vault-reentrancy';
  const fixture = AUDIT_FIXTURES[key];
  if (!fixture) {
    fail(
      `unknown fixture "${key}". Available: ${Object.keys(AUDIT_FIXTURES).join(', ')}, or pass a .sol file path`,
    );
  }
  return fixture;
}

async function setupOrLoad(opts: {
  rpc: string;
  chainId: number;
  registryAddress: string;
  notaryAddress: string;
  model: string;
  principal: ethers.Wallet;
}): Promise<AuditAgentFixture> {
  if (fs.existsSync(FIXTURE_FILE)) {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8')) as AuditAgentFixture;
    pass(`loaded fixture: ${path.relative(process.cwd(), FIXTURE_FILE)}`);
    info(`passportId   = ${fixture.passportId}`);
    info(`agentAddress = ${fixture.agentAddress}`);
    info(`registeredAt = ${fixture.registeredAt}`);
    return fixture;
  }
  info('no fixture found — registering a fresh AuditAgent');

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
      'Sigil demo AuditAgent — Solidity security audits via 0G Compute (qwen-2.5-7b-instruct)',
    permissions: {
      whitelistedContracts: [],
      maxTxValuePerWindow: { OG: 0 },
      authorizedApis: ['0g.compute'],
      allowedTokens: ['OG'],
      timeWindowSeconds: 3600,
    },
  });
  pass(`registered passportId   = ${registration.passportId}`);
  pass(`agentAddress            = ${registration.agentAddress}`);
  pass(`registerTx              = ${registration.txHash}`);

  const fundAmount = ethers.parseEther('0.05');
  const fundTx = await opts.principal.sendTransaction({
    to: registration.agentAddress,
    value: fundAmount,
  });
  const fundReceipt = await fundTx.wait();
  if (!fundReceipt || fundReceipt.status !== 1) {
    fail(`fund-agent tx ${fundTx.hash} did not confirm cleanly`);
  }
  pass(`funded agent with 0.05 OG (tx ${fundTx.hash})`);

  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const fixture: AuditAgentFixture = {
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
  const target = resolveTarget(process.argv[2]);

  const rpc = process.env.ZERO_G_RPC_URL ?? fail('ZERO_G_RPC_URL not set');
  const chainId = Number(process.env.ZERO_G_CHAIN_ID ?? '16602');
  const principalKey = process.env.ZERO_G_PRIVATE_KEY ?? fail('ZERO_G_PRIVATE_KEY not set');
  const registryAddress =
    process.env.SIGIL_REGISTRY_ADDRESS ?? fail('SIGIL_REGISTRY_ADDRESS not set');
  const notaryAddress =
    process.env.PROVENANCE_NOTARY_ADDRESS ?? fail('PROVENANCE_NOTARY_ADDRESS not set');
  const model = process.env.ZERO_G_COMPUTE_DEFAULT_MODEL ?? 'qwen/qwen-2.5-7b-instruct';
  const explorer = process.env.ZERO_G_EXPLORER_URL ?? 'https://chainscan-galileo.0g.ai';

  const provider = buildProvider(rpc as string, chainId);
  const principal = new ethers.Wallet(principalKey as string, provider);

  header('Setup');
  info(`principal: ${principal.address}`);
  info(`balance:   ${ethers.formatEther(await provider.getBalance(principal.address))} OG`);
  info(`registry:  ${registryAddress}`);
  info(`notary:    ${notaryAddress}`);
  info(`target:    ${target.name} (${target.source.length} chars)`);

  header('1. Register or load AuditAgent');
  const fixture = await setupOrLoad({
    rpc: rpc as string,
    chainId,
    registryAddress: registryAddress as string,
    notaryAddress: notaryAddress as string,
    model,
    principal,
  });

  const agentWallet = new ethers.Wallet(fixture.agentPrivateKey, provider);
  const agentBalance = await provider.getBalance(agentWallet.address);
  info(`agent balance: ${ethers.formatEther(agentBalance)} OG`);
  if (agentBalance < ethers.parseEther('0.005')) {
    fail(
      `agent ${agentWallet.address} is underfunded (needs ≥ 0.005 OG for notarize gas); top up from principal`,
    );
  }

  header('2. Build agent-side SigilClient + principal-side compute');
  const agentSigil = new SigilClient({
    rpcUrl: rpc as string,
    chainId,
    registryAddress: registryAddress as string,
    notaryAddress: notaryAddress as string,
    signer: agentWallet,
    computeDefaultModel: model,
  });
  const principalCompute = new ZeroGComputeAdapter({
    signer: principal,
    defaultModel: model,
  });
  pass(`notarize signer = ${agentWallet.address} (registered agent)`);
  pass(`compute  signer = ${principal.address} (principal funds inference)`);

  header(`3. AuditAgent.auditContract("${target.name}")`);
  const agent = new AuditAgent({
    sigil: agentSigil,
    compute: principalCompute,
    passportId: fixture.passportId,
    model,
  });
  const start = Date.now();
  const assessment = await agent.auditContract(target);
  const elapsedMs = Date.now() - start;
  pass(`completed in ${elapsedMs}ms`);

  header('4. Audit Report');
  pass(`contract              = ${assessment.input.name}`);
  pass(`sourceBytes           = ${assessment.input.sourceBytes}`);
  pass(`overallSeverity       = ${assessment.report.overallSeverity}`);
  pass(`findings              = ${assessment.report.findings.length}`);
  info(`summary               = ${assessment.report.summary}`);
  for (const [i, f] of assessment.report.findings.entries()) {
    info(`  [${i + 1}] ${f.severity.toUpperCase()} · ${f.category}${f.lines ? ' · L' + f.lines : ''}`);
    info(`      ${f.description}`);
  }
  info('');
  pass(`receipt.modelId       = ${assessment.receipt.modelId}`);
  pass(`receipt.outputHash    = ${assessment.receipt.outputHash}`);
  pass(`TEE verified          = ${String(assessment.verified)}`);
  info('');
  pass(`recordId              = ${assessment.notarized.recordId}`);
  pass(`notarizeTx            = ${assessment.notarized.txHash}`);
  pass(`proofRootHash         = ${assessment.notarized.proofRootHash}`);
  pass(`inputContextRootHash  = ${assessment.notarized.inputContextRootHash}`);

  console.log('\n=== Verifiable on-chain ===');
  console.log(`  notarize tx:       ${explorer}/tx/${assessment.notarized.txHash}`);
  console.log(`  notary contract:   ${explorer}/address/${notaryAddress}`);
  console.log(`  registry contract: ${explorer}/address/${registryAddress}`);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
