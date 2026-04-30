/**
 * Sigil demo — Scenario 3: Living Resume.
 *
 * The narrative. An agent doesn't get a CV the way a human does. Its
 * "experience" is whatever it has actually done, signed, and notarized —
 * verifiable by anyone who can read the chain. This scenario materialises
 * that idea with the RiskScorerAgent: it scores a couple of additional
 * DeFi protocols, then re-resolves itself from chain to print the full,
 * chronological resume.
 *
 *   pnpm --filter sigil-demo run scenario3 [<slug1> <slug2> ...]
 *
 * Default slugs (if no args): "compound-v3 lido". Skip slugs already in
 * the resume by passing different ones; the agent re-runs against any
 * slug each time and notarizes a fresh record.
 *
 * What this script does, top to bottom:
 *
 *   1. Load the RiskScorerAgent fixture from `.fixtures/risk-scorer.json`
 *      (registered + funded in the very first demo run).
 *   2. Snapshot the on-chain PassportRecord BEFORE any new work.
 *   3. For each slug, run RiskScorerAgent.scoreProtocol(...) — real
 *      DefiLlama fetch, real 0G Compute sealed inference, real on-chain
 *      ProvenanceNotary.notarize() — and print the assessment.
 *   4. After each notarization, re-read the PassportRecord and show the
 *      delta (provenanceRecordCount tick, reputation if attestations had
 *      fired, etc.).
 *   5. Read every record this passport has ever produced via
 *      notary.recordsByAgent(...) and print the resume.
 *
 * Inference is billed to the principal (0G compute ledger requires 3 OG
 * minimum); notarize gas is paid by the agent wallet from the 0.05 OG
 * funded at registration time. If either runs out, the script errors
 * loudly instead of silently faking data (Anti-Hallucination Rule 3).
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import {
  SigilClient,
  ZeroGComputeAdapter,
  ArtifactType,
  type PassportId,
  type PassportRecord,
  type RecordId,
  type ProvenanceRecord,
} from 'sigil-protocol';
import { RiskScorerAgent } from '../agents/RiskScorerAgent';

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
function warn(t: string) {
  console.log(`  WARN ${t}`);
}
function fail(t: string, err?: unknown): never {
  console.log(`  FAIL ${t}`);
  if (err) console.log('  ', err);
  process.exit(1);
}

function shortHex(h: string, prefix = 6, suffix = 4): string {
  if (!h || h.length < prefix + suffix + 4) return h;
  return `${h.slice(0, 2 + prefix)}…${h.slice(-suffix)}`;
}

function fmtUnixSeconds(s: bigint): string {
  if (s === 0n) return 'n/a';
  return new Date(Number(s) * 1000).toISOString();
}

function buildProvider(rpc: string, chainId: number): ethers.JsonRpcProvider {
  const fetchReq = new ethers.FetchRequest(rpc);
  fetchReq.timeout = 60_000;
  return new ethers.JsonRpcProvider(fetchReq, {
    chainId,
    name: '0g-galileo-testnet',
  });
}

function loadFixture(): RiskScorerFixture {
  if (!fs.existsSync(FIXTURE_FILE)) {
    fail(
      `RiskScorerAgent fixture missing: ${path.relative(process.cwd(), FIXTURE_FILE)}\n` +
        `  Run \`pnpm --filter sigil-demo run risk-scorer\` first to register the agent.`,
    );
  }
  return JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8')) as RiskScorerFixture;
}

function printSnapshot(label: string, r: PassportRecord) {
  console.log(`  ${label}:`);
  console.log(`    active                    = ${r.active}`);
  console.log(`    reputationScore           = ${r.reputationScore}`);
  console.log(`    taskCount                 = ${r.taskCount}`);
  console.log(`    failureCount              = ${r.failureCount}`);
  console.log(`    provenanceRecordCount     = ${r.provenanceRecordCount}`);
  console.log(`    executionFingerprintCount = ${r.executionFingerprintCount}`);
}

function printDelta(before: PassportRecord, after: PassportRecord) {
  const fields: Array<keyof PassportRecord> = [
    'reputationScore',
    'taskCount',
    'failureCount',
    'provenanceRecordCount',
    'executionFingerprintCount',
  ];
  for (const field of fields) {
    const a = after[field] as bigint;
    const b = before[field] as bigint;
    if (a !== b) {
      const sign = a > b ? '+' : '';
      info(`  Δ ${field}: ${b} → ${a} (${sign}${a - b})`);
    }
  }
}

async function main() {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) slugs.push('compound-v3', 'lido');

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
  info(`principal:  ${principal.address}`);
  info(`balance:    ${ethers.formatEther(await provider.getBalance(principal.address))} OG`);
  info(`registry:   ${registryAddress}`);
  info(`notary:     ${notaryAddress}`);
  info(`slugs:      ${slugs.join(', ')}`);

  header('1. Load RiskScorerAgent fixture');
  const fixture = loadFixture();
  pass(`loaded ${path.relative(process.cwd(), FIXTURE_FILE)}`);
  info(`passportId:    ${fixture.passportId}`);
  info(`agentAddress:  ${fixture.agentAddress}`);
  info(`registeredAt:  ${fixture.registeredAt}`);

  const agentWallet = new ethers.Wallet(fixture.agentPrivateKey, provider);
  const agentBalance = await provider.getBalance(agentWallet.address);
  info(`agent balance: ${ethers.formatEther(agentBalance)} OG`);
  if (agentBalance < ethers.parseEther('0.005')) {
    fail(
      `agent ${agentWallet.address} is underfunded (needs ≥ 0.005 OG for notarize gas).\n` +
        `  Top up with: cast send --rpc-url ${rpc} --private-key $ZERO_G_PRIVATE_KEY ${agentWallet.address} --value 0.05ether`,
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
  pass(`agent signer = ${agentWallet.address}`);

  const principalCompute = new ZeroGComputeAdapter({
    signer: principal,
    defaultModel: model,
  });
  pass(`compute signer = ${principal.address} (principal funds inference)`);

  header('3. Snapshot BEFORE');
  const beforeRecord = await agentSigil.passport.resolve(fixture.passportId);
  printSnapshot('before', beforeRecord);

  // --------------------------------------------------------------------
  // Score each slug, take a snapshot delta after each.
  // --------------------------------------------------------------------
  const agent = new RiskScorerAgent({
    sigil: agentSigil,
    compute: principalCompute,
    passportId: fixture.passportId,
    model,
  });

  const newRunSummaries: Array<{
    slug: string;
    name: string;
    riskScore: number;
    confidence: number;
    recordId: RecordId;
    txHash: string;
  }> = [];

  let runningRecord = beforeRecord;
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    header(`4.${i + 1} RiskScorerAgent.scoreProtocol("${slug}")`);
    let assessment;
    try {
      const start = Date.now();
      assessment = await agent.scoreProtocol(slug);
      const elapsedMs = Date.now() - start;
      pass(`completed in ${elapsedMs}ms`);
    } catch (err) {
      fail(`scoreProtocol("${slug}") failed`, err);
    }

    info(`protocol             = ${assessment.metrics.name} (${assessment.metrics.slug})`);
    info(`category             = ${assessment.metrics.category ?? 'n/a'}`);
    info(`currentTvlUsd        = $${assessment.metrics.currentTvlUsd.toLocaleString()}`);
    info(`riskScore            = ${assessment.score.riskScore}`);
    info(`confidence           = ${assessment.score.confidence}`);
    info(`reasoning            = ${assessment.score.reasoning}`);
    info(`TEE verified         = ${String(assessment.verified)}`);
    info(`recordId             = ${assessment.notarized.recordId}`);
    info(`notarizeTx           = ${assessment.notarized.txHash}`);

    newRunSummaries.push({
      slug,
      name: assessment.metrics.name,
      riskScore: assessment.score.riskScore,
      confidence: assessment.score.confidence,
      recordId: assessment.notarized.recordId,
      txHash: assessment.notarized.txHash,
    });

    // Re-read the on-chain passport state to show the resume growing.
    const after = await agentSigil.passport.resolve(fixture.passportId);
    printDelta(runningRecord, after);
    runningRecord = after;
  }

  // --------------------------------------------------------------------
  // 5. Print the full chronological resume.
  // --------------------------------------------------------------------
  header('5. Living resume (every record this agent has ever produced)');

  const recordsAbi = [
    'function recordsByAgent(bytes32 passportId, uint256 offset, uint256 limit) external view returns (bytes32[])',
  ] as const;
  const notary = new ethers.Contract(notaryAddress as string, recordsAbi, provider);
  const recordIds = (await notary.recordsByAgent(fixture.passportId, 0, 100)) as RecordId[];
  pass(`recordsByAgent → ${recordIds.length} record${recordIds.length === 1 ? '' : 's'}`);

  // Resolve each so we can sort by timestamp + render a clean line.
  const resolved: ProvenanceRecord[] = [];
  for (const id of recordIds) {
    resolved.push(await agentSigil.provenance.resolve(id));
  }
  resolved.sort((a, b) => Number(a.timestamp - b.timestamp));

  console.log('');
  console.log('  #  | timestamp                | type            | model                        | recordId');
  console.log('  ---|--------------------------|-----------------|------------------------------|-------------------');
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    const idx = String(i + 1).padStart(2, ' ');
    const ts = fmtUnixSeconds(r.timestamp);
    const type = ArtifactType[r.artifactType].padEnd(15, ' ');
    const model = (r.modelId || '?').padEnd(28, ' ');
    console.log(`  ${idx} | ${ts} | ${type} | ${model} | ${shortHex(r.recordId, 8, 6)}`);
  }

  // --------------------------------------------------------------------
  // Snapshot AFTER (cumulative)
  // --------------------------------------------------------------------
  header('6. Snapshot AFTER (cumulative)');
  const afterRecord = await agentSigil.passport.resolve(fixture.passportId);
  printSnapshot('after', afterRecord);
  printDelta(beforeRecord, afterRecord);

  // --------------------------------------------------------------------
  // Verifiable on-chain footer.
  // --------------------------------------------------------------------
  header('Verifiable on-chain');
  console.log(`  registry: ${explorer}/address/${registryAddress}`);
  console.log(`  notary:   ${explorer}/address/${notaryAddress}`);
  console.log('');
  console.log('  notarize transactions from THIS run:');
  for (const r of newRunSummaries) {
    console.log(`    [${r.slug}] risk=${r.riskScore} conf=${r.confidence}`);
    console.log(`      recordId: ${r.recordId}`);
    console.log(`      tx:       ${explorer}/tx/${r.txHash}`);
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
