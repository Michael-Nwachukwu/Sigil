/**
 * Sigil demo — Scenario 2: Provenance Notarization (Forward + Backward).
 *
 * The narrative. A regulator, an exchange, a counterparty's compliance bot
 * — pick your verifier — has just been handed an AI-generated artifact
 * (audit report, risk score, contract clause). They need to answer two
 * questions:
 *
 *   FORWARD : "Given this agent's PassportID, what has it produced?"
 *   BACKWARD: "Given this output, who produced it and were they authorized?"
 *
 * Sigil answers both with three on-chain reads, no off-chain database, no
 * trusted Sigil-API dependency. This script demonstrates the full chain.
 *
 *   pnpm --filter sigil-demo run scenario2 [<fixture-name>]
 *
 * `<fixture-name>` defaults to "audit-agent" — the AuditAgent passport has
 * the most narratively useful records (a real reentrancy finding on the
 * vulnerable Vault.sol). Pass "risk-scorer", "prompt-agent", or
 * "notarize-only" to walk a different agent.
 *
 * What we read on-chain (all view calls — no gas, no signing):
 *
 *   1. notary.recordsByAgent(passportId, 0, 50)
 *      → enumerate every notarization this agent has ever produced.
 *
 *   2. For each recordId:
 *        notary.resolve(recordId)         — full ProvenanceRecord
 *        notary.verify(recordId)          — on-chain signature + nonce check
 *        registry.isAuthorizedSigner(...) — was the agent active when it signed?
 *
 *   3. notary.resolveByOutput(outputHash) → recordId
 *      → BACKWARD direction: prove that an output hash uniquely identifies
 *      a record without needing to know which agent produced it.
 *
 * What we DO NOT do here: download or decrypt the input context. That
 * blob is encrypted with the agent's HKDF-derived symkey and lives in 0G
 * Storage. A regulator who needs the plaintext can compel the agent's
 * principal to disclose it; the on-chain `inputContextHash` lets them
 * prove the disclosed bytes match what was signed.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import {
  SigilClient,
  ArtifactType,
  type PassportId,
  type RecordId,
  type ProvenanceRecord,
} from 'sigil-protocol';

const FIXTURE_DIR = path.resolve(__dirname, '../.fixtures');

const KNOWN_FIXTURES: Record<string, { label: string; file: string }> = {
  'audit-agent': { label: 'AuditAgent', file: 'audit-agent.json' },
  'risk-scorer': { label: 'RiskScorerAgent', file: 'risk-scorer.json' },
  'prompt-agent': { label: 'PromptAgent', file: 'prompt-agent.json' },
  'notarize-only': { label: 'NotarizeOnly (ExternalAgent)', file: 'notarize-only.json' },
};

interface AgentFixture {
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

function loadFixture(key: string): { label: string; file: string; fixture: AgentFixture } {
  const meta = KNOWN_FIXTURES[key];
  if (!meta) {
    fail(
      `unknown fixture "${key}". Valid: ${Object.keys(KNOWN_FIXTURES).join(', ')}`,
    );
  }
  const full = path.join(FIXTURE_DIR, meta.file);
  if (!fs.existsSync(full)) {
    fail(
      `fixture missing: ${path.relative(process.cwd(), full)}.\n` +
        `  Run \`pnpm --filter sigil-demo run ${key.replace('-agent', '').replace('notarize-only', 'notarize-output').replace('prompt-agent', 'prompt')}\` first.`,
    );
  }
  const fixture = JSON.parse(fs.readFileSync(full, 'utf8')) as AgentFixture;
  return { label: meta.label, file: meta.file, fixture };
}

function describeRecord(record: ProvenanceRecord): string {
  const type = ArtifactType[record.artifactType] ?? `artifactType=${record.artifactType}`;
  return `${type} | model=${record.modelId} | block=${record.blockNumber} | nonce=${record.nonce}`;
}

async function main() {
  const fixtureKey = process.argv[2] ?? 'audit-agent';

  const rpc = process.env.ZERO_G_RPC_URL ?? fail('ZERO_G_RPC_URL not set');
  const chainId = Number(process.env.ZERO_G_CHAIN_ID ?? '16602');
  const registryAddress = process.env.SIGIL_REGISTRY_ADDRESS ?? fail('SIGIL_REGISTRY_ADDRESS not set');
  const notaryAddress = process.env.PROVENANCE_NOTARY_ADDRESS ?? fail('PROVENANCE_NOTARY_ADDRESS not set');
  const explorer = process.env.ZERO_G_EXPLORER_URL ?? 'https://chainscan-galileo.0g.ai';

  header('Setup — fresh "verifier" wallet (no funds, no prior history)');
  const provider = buildProvider(rpc as string, chainId);
  // Fresh stranger wallet — same rationale as scenario1: use
  // `new Wallet(randomBytes)` rather than `createRandom()` to match the
  // SigilSigner type (Wallet | JsonRpcSigner, not HDNodeWallet).
  const verifierKey = ethers.hexlify(ethers.randomBytes(32));
  const verifier = new ethers.Wallet(verifierKey, provider);
  info(`verifier address: ${verifier.address}`);
  info(`fixture target:   ${fixtureKey}`);
  info(`registry:         ${registryAddress}`);
  info(`notary:           ${notaryAddress}`);

  const sigil = new SigilClient({
    rpcUrl: rpc as string,
    chainId,
    registryAddress: registryAddress as string,
    notaryAddress: notaryAddress as string,
    signer: verifier,
  });

  header(`Loading fixture "${fixtureKey}"`);
  const { label, file, fixture } = loadFixture(fixtureKey);
  pass(`loaded ${label} from ${path.relative(process.cwd(), path.join(FIXTURE_DIR, file))}`);
  info(`passportId   = ${fixture.passportId}`);
  info(`agentAddress = ${fixture.agentAddress}`);

  // --------------------------------------------------------------------
  // FORWARD direction: passportId → list of records → resolve each.
  // --------------------------------------------------------------------
  header('FORWARD — passportId → recordsByAgent → resolve()');

  const recordsByAgentAbi = [
    'function recordsByAgent(bytes32 passportId, uint256 offset, uint256 limit) external view returns (bytes32[])',
    'function resolveByOutput(bytes32 outputHash) external view returns (bytes32)',
  ] as const;
  const notary = new ethers.Contract(notaryAddress as string, recordsByAgentAbi, provider);

  const recordIds = (await notary.recordsByAgent(fixture.passportId, 0, 50)) as RecordId[];
  if (recordIds.length === 0) {
    warn(`no records for ${label} yet — nothing to walk in this scenario.`);
    info(
      `  Run the matching agent runner first (e.g. \`pnpm --filter sigil-demo run ${fixtureKey.replace(
        '-agent',
        '',
      )}\`) to produce a notarization.`,
    );
    return;
  }
  pass(`recordsByAgent returned ${recordIds.length} record id${recordIds.length === 1 ? '' : 's'}`);

  const resolved: ProvenanceRecord[] = [];
  for (let i = 0; i < recordIds.length; i++) {
    const recordId = recordIds[i];
    const record = await sigil.provenance.resolve(recordId);
    resolved.push(record);
    info(`  [${i}] ${shortHex(recordId, 8, 6)}  ${describeRecord(record)}`);
  }

  // --------------------------------------------------------------------
  // For each record: full unpacked card + on-chain verify() + signer-check.
  // --------------------------------------------------------------------
  header('Per-record: notary.verify() + isAuthorizedSigner()');
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    console.log(`\n  --- record [${i}] ${shortHex(r.recordId, 8, 6)} ---`);
    console.log(`    recordId             = ${r.recordId}`);
    console.log(`    passportId           = ${r.passportId}`);
    console.log(`    principal            = ${r.principal}`);
    console.log(`    agent                = ${r.agent}`);
    console.log(`    modelId              = ${r.modelId}`);
    console.log(`    artifactType         = ${ArtifactType[r.artifactType]}`);
    console.log(`    outputHash           = ${r.outputHash}`);
    console.log(`    inputContextHash     = ${r.inputContextHash}`);
    console.log(`    inputContextSize     = ${r.inputContextSize} bytes`);
    console.log(`    modelFingerprintHash = ${r.modelFingerprintHash}`);
    console.log(`    proofRootHash (0G)   = ${r.executionFingerprintRef}`);
    console.log(`    nonce                = ${r.nonce}`);
    console.log(`    timestamp            = ${fmtUnixSeconds(r.timestamp)}`);
    console.log(`    blockNumber          = ${r.blockNumber}`);

    // On-chain verify: re-runs the signer-and-hash gate inside the contract.
    const v = await sigil.provenance.verify(r.recordId);
    if (!v.valid) {
      fail(`notary.verify FAILED for record ${i}: ${v.reason}`);
    }
    pass(`notary.verify OK — "${v.reason}"`);

    // Cross-check: the agent that signed THIS record must still be the
    // active authorized signer for the passport. (If the principal had
    // rotated keys after notarization, the historical record stays valid
    // — the on-chain signer check uses the snapshot at notarize time —
    // but `isAuthorizedSigner` for the CURRENT agent could be false for
    // the OLD agent address. We surface both.)
    const currentlyAuthorized = await sigil.passport.isAuthorizedSigner(r.passportId, r.agent);
    if (currentlyAuthorized) {
      pass(`isAuthorizedSigner(${shortHex(r.agent)}) = true (still active)`);
    } else {
      warn(
        `isAuthorizedSigner(${shortHex(r.agent)}) = false — agent has been rotated/revoked since this record was signed (record itself remains valid)`,
      );
    }
  }

  // --------------------------------------------------------------------
  // BACKWARD direction: outputHash → recordId.
  // --------------------------------------------------------------------
  header('BACKWARD — outputHash → resolveByOutput → record');
  const target = resolved[0];
  info(`taking outputHash from record [0]: ${target.outputHash}`);
  const reverseRecordId = (await notary.resolveByOutput(target.outputHash)) as RecordId;
  if (reverseRecordId.toLowerCase() !== target.recordId.toLowerCase()) {
    fail(
      `resolveByOutput mismatch: ${reverseRecordId} != ${target.recordId}`,
    );
  }
  pass(`resolveByOutput → ${shortHex(reverseRecordId, 8, 6)} (matches record [0])`);
  info(`  → principal: ${target.principal}`);
  info(`  → agent:     ${target.agent}`);
  info(`  → passport:  ${target.passportId}`);

  // --------------------------------------------------------------------
  // Print the full accountability chain. This is the SIGIL_DEMO.md punchline.
  // --------------------------------------------------------------------
  header('Accountability chain (artifact → agent → principal)');
  console.log(`  artifact (outputHash)   ${target.outputHash}`);
  console.log(`        ↓ notary.resolveByOutput`);
  console.log(`  recordId                ${target.recordId}`);
  console.log(`        ↓ notary.resolve`);
  console.log(`  signed by agent         ${target.agent}`);
  console.log(`        ↓ registry.isAuthorizedSigner`);
  console.log(`  authorized under passport ${target.passportId}`);
  console.log(`        ↓ registry.resolve`);
  console.log(`  controlled by principal ${target.principal}`);

  header('Verifiable on-chain');
  console.log(`  registry: ${explorer}/address/${registryAddress}`);
  console.log(`  notary:   ${explorer}/address/${notaryAddress}`);
  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i];
    console.log(
      `  record[${i}]  block=${r.blockNumber}  ${explorer}/block/${r.blockNumber}  (recordId ${shortHex(r.recordId, 8, 6)})`,
    );
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
