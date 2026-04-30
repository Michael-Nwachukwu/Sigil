/**
 * Sigil demo — PromptAgent runner.
 *
 *   pnpm --filter sigil-demo run prompt [<fixture>] [flags]
 *
 * The whole point of this script is to demonstrate that Sigil works for
 * arbitrary, dynamically-prompted agents — not just the deterministic-oracle
 * shape used by RiskScorerAgent and AuditAgent. You bring your own prompt;
 * Sigil handles the sealed inference + on-chain notarization.
 *
 * CLI shapes (all combinable):
 *   pnpm run prompt                               default fixture (solidity-explainer)
 *   pnpm run prompt haiku                         a named fixture
 *   pnpm run prompt --user "your question here"   override user prompt only
 *   pnpm run prompt --system "..." --user "..."   fully ad-hoc
 *   pnpm run prompt --system-file path/sys.md     read system prompt from file
 *   pnpm run prompt --user-file path/in.txt       read user prompt from file
 *   pnpm run prompt --json                        flag output as JSON (parse-check)
 *   pnpm run prompt --max-tokens 800              override token budget
 *   pnpm run prompt --temp 0.3                    override sampling temperature
 *   pnpm run prompt --name custom-label           override the inputContext name
 *
 * Same setup-or-load pattern as risk-scorer / audit-agent: first run registers
 * a fresh "PromptAgent" passport + funds it with 0.05 OG; later runs load
 * `.fixtures/prompt-agent.json` and reuse the existing passport.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import { SigilClient, ZeroGComputeAdapter, type PassportId } from 'sigil-protocol';
import { PromptAgent, PROMPT_FIXTURES } from '../agents/PromptAgent';

const FIXTURE_DIR = path.resolve(__dirname, '../.fixtures');
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'prompt-agent.json');

interface PromptAgentFixture {
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

interface CliArgs {
  fixture?: string;
  system?: string;
  user?: string;
  systemFile?: string;
  userFile?: string;
  expectJson?: boolean;
  maxTokens?: number;
  temperature?: number;
  name?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    const next = (label: string) => {
      const v = argv[++i];
      if (v == null) fail(`flag ${label} requires a value`);
      return v;
    };
    if (a === '--') {
      // pnpm-style separator — ignore.
    } else if (a === '--system') args.system = next(a);
    else if (a === '--user') args.user = next(a);
    else if (a === '--system-file') args.systemFile = next(a);
    else if (a === '--user-file') args.userFile = next(a);
    else if (a === '--json') args.expectJson = true;
    else if (a === '--max-tokens') args.maxTokens = Number(next(a));
    else if (a === '--temp' || a === '--temperature') args.temperature = Number(next(a));
    else if (a === '--name') args.name = next(a);
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else if (a.startsWith('--')) {
      fail(`unknown flag: ${a}`);
    } else if (!args.fixture) {
      args.fixture = a;
    } else {
      fail(`unexpected positional argument: ${a}`);
    }
    i++;
  }
  return args;
}

function printHelp() {
  console.log(`pnpm run prompt [<fixture>] [flags]

Fixtures: ${Object.keys(PROMPT_FIXTURES).join(', ')}

Flags:
  --system "..."        system prompt (overrides fixture)
  --user "..."          user prompt (overrides fixture)
  --system-file PATH    read system prompt from a file
  --user-file PATH      read user prompt from a file
  --json                parse-check the model output as JSON
  --max-tokens N        token budget (default 600)
  --temp F              sampling temperature (default 0)
  --name LABEL          label for inputContext + logs
  -h, --help            show this help`);
}

function readPromptFile(p: string, label: string): string {
  if (!fs.existsSync(p)) fail(`${label} file not found: ${p}`);
  if (!fs.statSync(p).isFile()) fail(`${label} path is not a file: ${p}`);
  return fs.readFileSync(p, 'utf8');
}

function resolvePromptInput(args: CliArgs): {
  name: string;
  displayName: string;
  systemPrompt: string;
  userPrompt: string;
  expectJson: boolean;
  maxTokens?: number;
  temperature?: number;
} {
  // Start from a fixture (or the default).
  const fixtureKey = args.fixture ?? 'solidity-explainer';
  const fixture = PROMPT_FIXTURES[fixtureKey];
  if (
    !fixture &&
    !args.system &&
    !args.user &&
    !args.systemFile &&
    !args.userFile
  ) {
    fail(
      `unknown fixture "${fixtureKey}". Available: ${Object.keys(PROMPT_FIXTURES).join(', ')}, or pass --system / --user / --system-file / --user-file`,
    );
  }

  const baseSystem = fixture?.systemPrompt ?? '';
  const baseUser = fixture?.userPrompt ?? '';
  const displayName = fixture?.displayName ?? args.name ?? fixtureKey;

  const systemPrompt = args.systemFile
    ? readPromptFile(args.systemFile, '--system-file')
    : (args.system ?? baseSystem);
  const userPrompt = args.userFile
    ? readPromptFile(args.userFile, '--user-file')
    : (args.user ?? baseUser);

  if (!systemPrompt.trim()) fail('no system prompt resolved (use a fixture or --system / --system-file)');
  if (!userPrompt.trim()) fail('no user prompt resolved (use a fixture or --user / --user-file)');

  const name = args.name ?? (fixture ? fixtureKey : 'ad-hoc');
  const expectJson = args.expectJson ?? false;

  return {
    name,
    displayName,
    systemPrompt,
    userPrompt,
    expectJson,
    maxTokens: args.maxTokens,
    temperature: args.temperature,
  };
}

async function setupOrLoad(opts: {
  rpc: string;
  chainId: number;
  registryAddress: string;
  notaryAddress: string;
  model: string;
  principal: ethers.Wallet;
}): Promise<PromptAgentFixture> {
  if (fs.existsSync(FIXTURE_FILE)) {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8')) as PromptAgentFixture;
    pass(`loaded fixture: ${path.relative(process.cwd(), FIXTURE_FILE)}`);
    info(`passportId   = ${fixture.passportId}`);
    info(`agentAddress = ${fixture.agentAddress}`);
    info(`registeredAt = ${fixture.registeredAt}`);
    return fixture;
  }
  info('no fixture found — registering a fresh PromptAgent');

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
      'Sigil demo PromptAgent — generic LLM agent. Accepts arbitrary system+user prompts at call time and notarizes the output via Sigil. Reference shape for pre-existing agents onboarding through SKILL.md / MCP.',
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
  const fixture: PromptAgentFixture = {
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
  const args = parseArgs(process.argv.slice(2));
  const promptInput = resolvePromptInput(args);

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
  info(`principal:    ${principal.address}`);
  info(`balance:      ${ethers.formatEther(await provider.getBalance(principal.address))} OG`);
  info(`registry:     ${registryAddress}`);
  info(`notary:       ${notaryAddress}`);
  info(`prompt:       ${promptInput.displayName} (name="${promptInput.name}")`);
  info(`system bytes: ${Buffer.byteLength(promptInput.systemPrompt, 'utf8')}`);
  info(`user bytes:   ${Buffer.byteLength(promptInput.userPrompt, 'utf8')}`);
  info(`expectJson:   ${promptInput.expectJson}`);
  if (promptInput.maxTokens != null) info(`maxTokens:    ${promptInput.maxTokens}`);
  if (promptInput.temperature != null) info(`temperature:  ${promptInput.temperature}`);

  header('1. Register or load PromptAgent');
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

  header(`3. PromptAgent.runPrompt("${promptInput.name}")`);
  const agent = new PromptAgent({
    sigil: agentSigil,
    compute: principalCompute,
    passportId: fixture.passportId,
    model,
  });
  const start = Date.now();
  const assessment = await agent.runPrompt({
    name: promptInput.name,
    systemPrompt: promptInput.systemPrompt,
    userPrompt: promptInput.userPrompt,
    expectJson: promptInput.expectJson,
    maxTokens: promptInput.maxTokens,
    temperature: promptInput.temperature,
  });
  const elapsedMs = Date.now() - start;
  pass(`completed in ${elapsedMs}ms`);

  header('4. Model Output');
  pass(`prompt name           = ${assessment.input.name}`);
  pass(`systemBytes           = ${assessment.input.systemBytes}`);
  pass(`userBytes             = ${assessment.input.userBytes}`);
  pass(`maxTokens             = ${assessment.input.maxTokens}`);
  pass(`temperature           = ${assessment.input.temperature}`);
  pass(`outputBytes           = ${Buffer.byteLength(assessment.output, 'utf8')}`);
  if (promptInput.expectJson) {
    pass(`parsedJson            = ${assessment.parsedJson != null ? 'OK' : 'PARSE FAILED (still notarized as raw)'}`);
  }
  console.log('');
  console.log('  ----- model output -----');
  for (const line of assessment.output.split('\n')) {
    console.log(`  ${line}`);
  }
  console.log('  ----- end output -----');
  console.log('');
  pass(`receipt.modelId       = ${assessment.receipt.modelId}`);
  pass(`receipt.outputHash    = ${assessment.receipt.outputHash}`);
  pass(`TEE verified          = ${String(assessment.verified)}`);
  console.log('');
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
