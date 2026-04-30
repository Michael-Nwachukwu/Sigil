/**
 * Sigil demo — notarize-output runner.
 *
 *   pnpm --filter sigil-demo run notarize-output [flags]
 *
 * Demonstrates the THINNEST possible Sigil integration. The script does NOT
 * call any LLM — it pretends some external agent (OpenAI, Anthropic, a local
 * Llama, whatever) already produced an output, and just anchors that output
 * on-chain as a Sigil ProvenanceRecord.
 *
 * Two paths:
 *   - Default: synthesizes an UNSEALED attestation receipt. Use this to
 *     onboard agents not running on 0G Compute. The agent's signature
 *     still notarizes the output; only the model→output cryptographic
 *     binding is missing.
 *   - With `--use-prompt-fixture`: re-uses the cached PromptAgent fixture
 *     so a single passport accumulates both sealed (from `pnpm run prompt`)
 *     AND unsealed records, demonstrating the mixed-evidence reputation
 *     model.
 *
 * CLI:
 *   pnpm run notarize-output                                 # default scenario
 *   pnpm run notarize-output -- \
 *     --model "gpt-4o" \
 *     --system "You are a helpful assistant." \
 *     --user "Capital of France?" \
 *     --output "Paris."
 *   pnpm run notarize-output -- --output-file ./report.md \
 *     --system-file ./sys.md --user-file ./user.md --model "claude-sonnet-4"
 *   pnpm run notarize-output -- --use-prompt-fixture        # share PromptAgent passport
 *
 * Setup-or-load: by default registers a fresh "ExternalAgent" passport in
 * `.fixtures/notarize-only.json`. With `--use-prompt-fixture`, loads the
 * existing `prompt-agent.json` instead.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import { SigilClient, type PassportId } from 'sigil-protocol';
import { NotarizeOnlyAdapter } from '../agents/NotarizeOnly';

const FIXTURE_DIR = path.resolve(__dirname, '../.fixtures');
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'notarize-only.json');
const PROMPT_FIXTURE_FILE = path.join(FIXTURE_DIR, 'prompt-agent.json');

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
function fail(t: string, err?: unknown): never {
  console.log(`  FAIL ${t}`);
  if (err) console.log('  ', err);
  process.exit(1);
}

function buildProvider(rpc: string, chainId: number): ethers.JsonRpcProvider {
  const fetchReq = new ethers.FetchRequest(rpc);
  fetchReq.timeout = 60_000;
  return new ethers.JsonRpcProvider(fetchReq, { chainId, name: '0g-galileo-testnet' });
}

interface CliArgs {
  model?: string;
  system?: string;
  user?: string;
  output?: string;
  systemFile?: string;
  userFile?: string;
  outputFile?: string;
  name?: string;
  usePromptFixture?: boolean;
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
      // pnpm separator — ignore.
    } else if (a === '--model') args.model = next(a);
    else if (a === '--system') args.system = next(a);
    else if (a === '--user') args.user = next(a);
    else if (a === '--output') args.output = next(a);
    else if (a === '--system-file') args.systemFile = next(a);
    else if (a === '--user-file') args.userFile = next(a);
    else if (a === '--output-file') args.outputFile = next(a);
    else if (a === '--name') args.name = next(a);
    else if (a === '--use-prompt-fixture') args.usePromptFixture = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      fail(`unknown arg: ${a}`);
    }
    i++;
  }
  return args;
}

function printHelp() {
  console.log(`pnpm run notarize-output [flags]

Notarize an externally-produced LLM output as a Sigil ProvenanceRecord. The
script does NOT call any LLM — you provide the model name, prompts, and
output.

Flags:
  --model NAME              what model produced this (e.g. "gpt-4o")
  --system "..."            system prompt
  --user "..."              user prompt
  --output "..."            model output
  --system-file PATH        system prompt from file
  --user-file PATH          user prompt from file
  --output-file PATH        output from file
  --name LABEL              label in inputContext (default: "external-output")
  --use-prompt-fixture      reuse the PromptAgent passport (mixed sealed+unsealed
                            history) instead of registering a new one
  -h, --help                show this help

If you don't pass --system / --user / --output, a built-in demo trio is
used so the script runs out of the box.`);
}

function readFile(p: string, label: string): string {
  if (!fs.existsSync(p)) fail(`${label} file not found: ${p}`);
  if (!fs.statSync(p).isFile()) fail(`${label} path is not a file: ${p}`);
  return fs.readFileSync(p, 'utf8');
}

const DEFAULT_DEMO = {
  model: 'gpt-4o-mini',
  system: 'You are a concise technical writer. Answer in one sentence.',
  user: 'In one sentence, what is the capital of France?',
  output: 'The capital of France is Paris.',
};

function resolveScenario(args: CliArgs): {
  model: string;
  system: string;
  user: string;
  output: string;
  name: string;
} {
  const model = args.model ?? DEFAULT_DEMO.model;
  const system = args.systemFile
    ? readFile(args.systemFile, '--system-file')
    : (args.system ?? DEFAULT_DEMO.system);
  const user = args.userFile
    ? readFile(args.userFile, '--user-file')
    : (args.user ?? DEFAULT_DEMO.user);
  const output = args.outputFile
    ? readFile(args.outputFile, '--output-file')
    : (args.output ?? DEFAULT_DEMO.output);
  const name = args.name ?? 'external-output';
  return { model, system, user, output, name };
}

async function setupOrLoad(opts: {
  rpc: string;
  chainId: number;
  registryAddress: string;
  notaryAddress: string;
  model: string;
  principal: ethers.Wallet;
  usePromptFixture: boolean;
}): Promise<{ fixture: AgentFixture; source: 'new' | 'cached' | 'shared-prompt' }> {
  if (opts.usePromptFixture) {
    if (!fs.existsSync(PROMPT_FIXTURE_FILE)) {
      fail(
        `--use-prompt-fixture requires ${path.relative(process.cwd(), PROMPT_FIXTURE_FILE)} (run \`pnpm run prompt\` first)`,
      );
    }
    const fixture = JSON.parse(
      fs.readFileSync(PROMPT_FIXTURE_FILE, 'utf8'),
    ) as AgentFixture;
    pass(
      `loaded shared PromptAgent fixture: ${path.relative(process.cwd(), PROMPT_FIXTURE_FILE)}`,
    );
    info(`passportId   = ${fixture.passportId}`);
    info(`agentAddress = ${fixture.agentAddress}`);
    return { fixture, source: 'shared-prompt' };
  }

  if (fs.existsSync(FIXTURE_FILE)) {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8')) as AgentFixture;
    pass(`loaded fixture: ${path.relative(process.cwd(), FIXTURE_FILE)}`);
    info(`passportId   = ${fixture.passportId}`);
    info(`agentAddress = ${fixture.agentAddress}`);
    info(`registeredAt = ${fixture.registeredAt}`);
    return { fixture, source: 'cached' };
  }

  info('no fixture found — registering a fresh ExternalAgent passport');
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
      'Sigil demo ExternalAgent — notarize-only adapter. Produces no inference itself; receives outputs from external LLM stacks (OpenAI, Anthropic, local models) and anchors them as ProvenanceRecords. Reference shape for off-0G agents onboarding to Sigil.',
    permissions: {
      whitelistedContracts: [],
      maxTxValuePerWindow: { OG: 0 },
      authorizedApis: [],
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
  const fixture: AgentFixture = {
    passportId: registration.passportId,
    agentAddress: registration.agentAddress,
    agentPrivateKey: registration.agentPrivateKey,
    registerTx: registration.txHash,
    fundTx: fundTx.hash,
    registeredAt: new Date().toISOString(),
  };
  fs.writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  pass(`fixture written: ${path.relative(process.cwd(), FIXTURE_FILE)} (mode 0600)`);
  return { fixture, source: 'new' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenario = resolveScenario(args);

  const rpc = process.env.ZERO_G_RPC_URL ?? fail('ZERO_G_RPC_URL not set');
  const chainId = Number(process.env.ZERO_G_CHAIN_ID ?? '16602');
  const principalKey = process.env.ZERO_G_PRIVATE_KEY ?? fail('ZERO_G_PRIVATE_KEY not set');
  const registryAddress =
    process.env.SIGIL_REGISTRY_ADDRESS ?? fail('SIGIL_REGISTRY_ADDRESS not set');
  const notaryAddress =
    process.env.PROVENANCE_NOTARY_ADDRESS ?? fail('PROVENANCE_NOTARY_ADDRESS not set');
  const computeModel =
    process.env.ZERO_G_COMPUTE_DEFAULT_MODEL ?? 'qwen/qwen-2.5-7b-instruct';
  const explorer = process.env.ZERO_G_EXPLORER_URL ?? 'https://chainscan-galileo.0g.ai';

  const provider = buildProvider(rpc as string, chainId);
  const principal = new ethers.Wallet(principalKey as string, provider);

  header('Setup');
  info(`principal:   ${principal.address}`);
  info(`balance:     ${ethers.formatEther(await provider.getBalance(principal.address))} OG`);
  info(`registry:    ${registryAddress}`);
  info(`notary:      ${notaryAddress}`);
  info(`scenario:    name="${scenario.name}" model="${scenario.model}"`);
  info(`system:      ${scenario.system.length} chars`);
  info(`user:        ${scenario.user.length} chars`);
  info(`output:      ${scenario.output.length} chars`);
  info(`flow:        UNSEALED (no 0G Compute call — synthesized attestation)`);

  header('1. Register or load passport');
  const { fixture, source } = await setupOrLoad({
    rpc: rpc as string,
    chainId,
    registryAddress: registryAddress as string,
    notaryAddress: notaryAddress as string,
    model: computeModel,
    principal,
    usePromptFixture: args.usePromptFixture ?? false,
  });
  info(`passport source: ${source}`);

  const agentWallet = new ethers.Wallet(fixture.agentPrivateKey, provider);
  const agentBalance = await provider.getBalance(agentWallet.address);
  info(`agent balance: ${ethers.formatEther(agentBalance)} OG`);
  if (agentBalance < ethers.parseEther('0.005')) {
    fail(
      `agent ${agentWallet.address} is underfunded (needs ≥ 0.005 OG for notarize gas); top up from principal`,
    );
  }

  header('2. Build agent-side SigilClient');
  const agentSigil = new SigilClient({
    rpcUrl: rpc as string,
    chainId,
    registryAddress: registryAddress as string,
    notaryAddress: notaryAddress as string,
    signer: agentWallet,
    computeDefaultModel: computeModel,
  });
  pass(`notarize signer = ${agentWallet.address} (registered agent)`);
  pass(`no compute adapter built — this flow does NOT call 0G Compute`);

  header(`3. NotarizeOnlyAdapter.notarizeExternalOutput("${scenario.name}")`);
  const adapter = new NotarizeOnlyAdapter({
    sigil: agentSigil,
    passportId: fixture.passportId,
  });
  const start = Date.now();
  const result = await adapter.notarizeExternalOutput({
    name: scenario.name,
    modelId: scenario.model,
    systemPrompt: scenario.system,
    userPrompt: scenario.user,
    output: scenario.output,
    extra: { source: 'demo-cli', flow: 'unsealed' },
  });
  const elapsedMs = Date.now() - start;
  pass(`completed in ${elapsedMs}ms`);

  header('4. Result');
  pass(`receiptKind           = ${result.receiptKind}`);
  pass(`modelId               = ${result.modelId}`);
  pass(`recordId              = ${result.notarized.recordId}`);
  pass(`notarizeTx            = ${result.notarized.txHash}`);
  pass(`proofRootHash         = ${result.notarized.proofRootHash}`);
  pass(`inputContextRootHash  = ${result.notarized.inputContextRootHash}`);
  console.log('');
  console.log('  ----- echoed output -----');
  for (const line of scenario.output.split('\n').slice(0, 10)) {
    console.log(`  ${line}`);
  }
  if (scenario.output.split('\n').length > 10) console.log(`  ... (truncated)`);
  console.log('  ----- end output -----');

  console.log('\n=== Verifiable on-chain ===');
  console.log(`  notarize tx:       ${explorer}/tx/${result.notarized.txHash}`);
  console.log(`  notary contract:   ${explorer}/address/${notaryAddress}`);
  console.log(`  registry contract: ${explorer}/address/${registryAddress}`);
  if (result.receiptKind === 'unsealed') {
    console.log('');
    console.log('  NOTE: this record is UNSEALED. The agent attests to the model + input + output,');
    console.log('  but no TEE proof binds them. Verifiers should fetch the proof envelope from');
    console.log(`  0G Storage (rootHash ${result.notarized.proofRootHash})`);
    console.log('  and check the "verified" field — they will see verified=false, proofType=unsealed-external.');
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
