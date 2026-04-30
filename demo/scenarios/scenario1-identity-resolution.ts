/**
 * Sigil demo — Scenario 1: Identity Resolution.
 *
 * The narrative. Some counterparty wants to talk to one of our agents.
 * They have a PassportID (or an agent's wallet address). They have NOTHING
 * else — no API key, no off-chain database, no Sigil-issued credentials.
 * Can they discover who is behind that agent and what it's authorized to do?
 *
 * Answer: yes. Sigil is read-open. Anyone with an Ethereum RPC can resolve
 * the full identity record straight from chain. This script proves it by
 * spinning up a freshly-generated random "verifier" wallet (zero funds,
 * never seen before, never signs anything) and using it to walk every
 * cached agent fixture in `.fixtures/`:
 *
 *   1. `passport.resolve(passportId)` — on-chain PassportRecord (principal,
 *      agentAddress, reputation, taskCount, etc.)
 *   2. `passport.passportOfAgent(agentAddress)` — reverse lookup
 *      (agent wallet → passportId)
 *   3. `passport.isAuthorizedSigner(passportId, agentAddress)` — confirms
 *      the agent wallet is the active signer for notarizations
 *
 * Run:
 *   pnpm --filter sigil-demo run scenario1
 *
 * Prerequisites: at least one fixture file in `demo/.fixtures/` (created by
 * any of risk-scorer / audit-agent / prompt / notarize-output runners).
 *
 * NOT in this scenario: decrypting permission manifests. The encrypted
 * permission manifest lives in 0G Storage, keyed by an HKDF-derived symkey
 * that only the principal can produce. A counterparty CAN see the manifest
 * hash on-chain and verify the principal hasn't tampered with it, but the
 * plaintext is private by design. Scenario 2 covers principal-side decrypt.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import { SigilClient, type PassportId } from 'sigil-protocol';

const FIXTURE_DIR = path.resolve(__dirname, '../.fixtures');

interface AgentFixture {
  passportId: PassportId;
  agentAddress: string;
  agentPrivateKey: string;
  registerTx: string;
  fundTx: string;
  registeredAt: string;
}

interface FixtureEntry {
  label: string;
  file: string;
  fixture: AgentFixture;
}

const KNOWN_FIXTURES: Array<{ label: string; file: string }> = [
  { label: 'RiskScorerAgent', file: 'risk-scorer.json' },
  { label: 'AuditAgent', file: 'audit-agent.json' },
  { label: 'PromptAgent', file: 'prompt-agent.json' },
  { label: 'NotarizeOnly (ExternalAgent)', file: 'notarize-only.json' },
];

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

function buildProvider(rpc: string, chainId: number): ethers.JsonRpcProvider {
  const fetchReq = new ethers.FetchRequest(rpc);
  fetchReq.timeout = 60_000;
  return new ethers.JsonRpcProvider(fetchReq, {
    chainId,
    name: '0g-galileo-testnet',
  });
}

function loadFixtures(): FixtureEntry[] {
  const found: FixtureEntry[] = [];
  for (const { label, file } of KNOWN_FIXTURES) {
    const full = path.join(FIXTURE_DIR, file);
    if (!fs.existsSync(full)) continue;
    const fixture = JSON.parse(fs.readFileSync(full, 'utf8')) as AgentFixture;
    found.push({ label, file, fixture });
  }
  return found;
}

function shortHex(h: string, prefix = 6, suffix = 4): string {
  if (!h || h.length < prefix + suffix + 4) return h;
  return `${h.slice(0, 2 + prefix)}…${h.slice(-suffix)}`;
}

function fmtUnixSeconds(s: bigint): string {
  if (s === 0n) return 'n/a';
  return new Date(Number(s) * 1000).toISOString();
}

function reputationLine(r: { reputationScore: bigint; taskCount: bigint; failureCount: bigint }) {
  // Sigil reputation formula (CLAUDE.md):
  //   1000 * (taskCount - 2*failureCount) / max(taskCount, 1), clamped [0,1000]
  // Stored on-chain by SigilRegistry.appendAttestation. Keepers hadn't fired
  // attestations during the demo window so most agents read 0/0/0 — we
  // surface that explicitly so the demo doesn't lie about it.
  return `score=${r.reputationScore} taskCount=${r.taskCount} failureCount=${r.failureCount}`;
}

async function resolveOne(
  entry: FixtureEntry,
  verifierSigil: SigilClient,
): Promise<void> {
  const { label, file, fixture } = entry;
  header(`Resolving "${label}" from fixture ${file}`);
  info(`passportId   = ${fixture.passportId}`);
  info(`agentAddress = ${fixture.agentAddress}`);

  // (1) Forward resolve — passportId → PassportRecord.
  let record;
  try {
    record = await verifierSigil.passport.resolve(fixture.passportId);
  } catch (err) {
    fail(`passport.resolve failed for ${shortHex(fixture.passportId)}`, err);
  }
  pass('passport.resolve OK');
  info(`  principal              = ${record.principal}`);
  info(`  agentAddress (on-chain)= ${record.agentAddress}`);
  info(`  active                 = ${record.active}`);
  info(`  tokenId                = ${record.tokenId}`);
  info(`  createdBlock           = ${record.createdBlock}`);
  info(`  createdAt              = ${fmtUnixSeconds(record.createdAt)}`);
  info(`  reputation             = ${reputationLine(record)}`);
  info(`  provenanceRecordCount  = ${record.provenanceRecordCount}`);
  info(`  executionFingerprintCount = ${record.executionFingerprintCount}`);
  info(`  permissionManifestHash = ${shortHex(record.permissionManifestHash, 8, 6)}`);

  // Cross-check: on-chain agentAddress matches the fixture's agentAddress.
  if (record.agentAddress.toLowerCase() !== fixture.agentAddress.toLowerCase()) {
    warn(`fixture agentAddress != on-chain agentAddress (rotated?)`);
  } else {
    pass('fixture agentAddress matches on-chain record');
  }

  // (2) Reverse lookup — agentAddress → passportId.
  const reverseId = await verifierSigil.passport.passportOfAgent(fixture.agentAddress);
  if (!reverseId) {
    fail(`passportOfAgent returned null for ${fixture.agentAddress}`);
  }
  if (reverseId.toLowerCase() !== fixture.passportId.toLowerCase()) {
    fail(
      `reverse lookup mismatch: passportOfAgent=${reverseId} fixture=${fixture.passportId}`,
    );
  }
  pass(`passportOfAgent reverse lookup OK (${shortHex(reverseId)})`);

  // (3) Authority check — would this agent's signature be accepted by
  // ProvenanceNotary.notarize()?  This is the on-chain gate every
  // notarization passes through.
  const authorized = await verifierSigil.passport.isAuthorizedSigner(
    fixture.passportId,
    fixture.agentAddress,
  );
  if (!authorized) {
    fail(`isAuthorizedSigner returned false — passport revoked or rotated`);
  }
  pass('isAuthorizedSigner OK — agent wallet is the active signer');

}

async function main() {
  const rpc = process.env.ZERO_G_RPC_URL ?? fail('ZERO_G_RPC_URL not set');
  const chainId = Number(process.env.ZERO_G_CHAIN_ID ?? '16602');
  const registryAddress = process.env.SIGIL_REGISTRY_ADDRESS ?? fail('SIGIL_REGISTRY_ADDRESS not set');
  const notaryAddress = process.env.PROVENANCE_NOTARY_ADDRESS ?? fail('PROVENANCE_NOTARY_ADDRESS not set');
  const explorer = process.env.ZERO_G_EXPLORER_URL ?? 'https://chainscan-galileo.0g.ai';

  header('Setup — fresh "verifier" wallet (no funds, no prior history)');
  const provider = buildProvider(rpc as string, chainId);

  // The whole point: a stranger to this protocol can resolve identities.
  // We model that stranger by minting a brand-new wallet that has never
  // been seen before and connecting it to the provider. It can call view
  // functions; it can't write. NOTE: we use `new Wallet(randomBytes)`
  // rather than `Wallet.createRandom()` because the latter returns an
  // `HDNodeWallet` and the SDK's `SigilSigner` type is the narrower
  // `Wallet | JsonRpcSigner`.
  const verifierKey = ethers.hexlify(ethers.randomBytes(32));
  const verifier = new ethers.Wallet(verifierKey, provider);
  info(`verifier address: ${verifier.address}`);
  info(`verifier balance: 0 OG (read-only — never signs a tx in this scenario)`);
  info(`registry:         ${registryAddress}`);
  info(`notary:           ${notaryAddress}`);

  const verifierSigil = new SigilClient({
    rpcUrl: rpc as string,
    chainId,
    registryAddress: registryAddress as string,
    notaryAddress: notaryAddress as string,
    signer: verifier,
  });

  header('Loading fixtures');
  const fixtures = loadFixtures();
  if (fixtures.length === 0) {
    fail(
      `no fixtures found in ${path.relative(process.cwd(), FIXTURE_DIR)}.\n` +
        `  Run any of: pnpm --filter sigil-demo run risk-scorer | audit-agent | prompt | notarize-output\n` +
        `  to register an agent first, then re-run this scenario.`,
    );
  }
  for (const f of fixtures) {
    info(`found ${f.label}: ${path.relative(process.cwd(), path.join(FIXTURE_DIR, f.file))}`);
  }

  for (const entry of fixtures) {
    await resolveOne(entry, verifierSigil);
  }

  header('Summary');
  pass(`resolved ${fixtures.length} agent identit${fixtures.length === 1 ? 'y' : 'ies'} from on-chain alone`);
  info('the verifier wallet never signed a transaction — Sigil identity is read-open');
  info(`registry contract: ${explorer}/address/${registryAddress}`);
  info(`notary contract:   ${explorer}/address/${notaryAddress}`);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
