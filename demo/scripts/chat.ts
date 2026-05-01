/**
 * Sigil demo — interactive chat agent (REPL).
 *
 * Talks to a registered Sigil agent in natural language. Every reply is
 * sealed-inferred via 0G Compute and notarized on the ProvenanceNotary
 * contract — so you can verify any of the agent's answers later by pasting
 * the recordId into /passport in the demo UI or onto the explorer.
 *
 *   pnpm --filter sigil-demo run chat                       # default: risk-scorer fixture
 *   pnpm --filter sigil-demo run chat -- --name audit-agent
 *   pnpm --filter sigil-demo run chat -- --name prompt-agent --model qwen/qwen-2.5-7b-instruct
 *
 * Slash commands inside the REPL:
 *   /whoami    print the agent's stored identity (passport, agent, principal)
 *   /last      print the most recent notarization
 *   /help      list commands
 *   /exit      quit (Ctrl-D also works)
 *
 * Anything not starting with `/` is sent to the agent. The agent's system
 * prompt embeds its passport identity, so natural-language identity questions
 * ("what's your passport id?") get answered correctly AND notarized.
 *
 * Reuses an existing demo fixture under demo/.fixtures/<name>.json (created
 * by `pnpm run risk-scorer` / `audit-agent` / `prompt`). Does NOT register
 * fresh agents — keeps the chat zero-cost to launch.
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
loadEnv({ path: path.resolve(__dirname, '../../.env') });

import { ethers } from 'ethers';
import {
  AttestationType,
  SigilClient,
  ZeroGComputeAdapter,
  readCredential,
  type PassportId,
} from 'sigil-protocol';
import { ChatAgent, type ChatTurn, type ChatProgressEvent } from '../agents/ChatAgent';

interface DemoFixture {
  passportId: `0x${string}`;
  agentAddress: `0x${string}`;
  agentPrivateKey: `0x${string}`;
  registerTx?: string;
  fundTx?: string;
  registeredAt?: string;
}

interface ParsedArgs {
  name: string;
  model?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  let name = 'risk-scorer';
  let model: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '-n') name = argv[++i] ?? name;
    else if (a === '--model' || a === '-m') model = argv[++i];
  }
  return { name, model };
}

function fixturePath(name: string): string {
  return path.resolve(__dirname, `../.fixtures/${name}.json`);
}

function loadFixture(name: string): DemoFixture {
  const p = fixturePath(name);
  if (!fs.existsSync(p)) {
    process.stderr.write(`no fixture at ${p}\n`);
    process.stderr.write(
      `register an agent first:\n` +
        `  pnpm --filter sigil-demo run risk-scorer    # creates risk-scorer fixture\n` +
        `  pnpm --filter sigil-demo run audit-agent    # creates audit-agent fixture\n` +
        `  pnpm --filter sigil-demo run prompt          # creates prompt-agent fixture\n` +
        `then re-run:\n` +
        `  pnpm --filter sigil-demo run chat -- --name <fixture>\n`,
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as DemoFixture;
}

function buildProvider(rpc: string, chainId: number): ethers.JsonRpcProvider {
  const fr = new ethers.FetchRequest(rpc);
  fr.timeout = 60_000;
  return new ethers.JsonRpcProvider(fr, { chainId, name: '0g-galileo-testnet' });
}

function explorerTx(explorer: string, hash: string): string {
  return `${explorer}/tx/${hash}`;
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    process.stderr.write(`missing required env var: ${key}\n`);
    process.exit(1);
  }
  return v;
}

function printIdentity(args: {
  passportId: string;
  agentAddress: string;
  principal: string;
  description?: string;
}) {
  process.stdout.write(`  passportId  ${args.passportId}\n`);
  process.stdout.write(`  agent       ${args.agentAddress}\n`);
  process.stdout.write(`  principal   ${args.principal}\n`);
  if (args.description) process.stdout.write(`  description ${args.description}\n`);
}

function printTurn(turn: ChatTurn, explorer: string) {
  process.stdout.write(`\n${turn.output.trim()}\n\n`);
  const verified =
    turn.verified === true
      ? 'TEE verified'
      : turn.verified === false
        ? 'TEE unverified'
        : 'TEE unknown';
  process.stdout.write(`  recordId    ${turn.notarized.recordId}\n`);
  process.stdout.write(`  outputHash  ${turn.notarized.outputHash}\n`);
  process.stdout.write(`  notarizeTx  ${explorerTx(explorer, turn.notarized.txHash)}\n`);
  process.stdout.write(`  ${verified}\n`);
  const att = turn.notarized.attestation;
  if (att) {
    process.stdout.write(
      `  attestTx    ${explorerTx(explorer, att.txHash)} (${AttestationType[att.attestationType]} ${
        att.passed ? 'passed' : 'failed'
      } · demo-simulated)\n`,
    );
  }
}

type WriteFn = typeof process.stdout.write;

function writeChunk(writer: WriteFn, text: string): void {
  writer(text);
}

function chunkToString(chunk: string | Uint8Array): string {
  if (typeof chunk === 'string') {
    return chunk;
  }
  return Buffer.from(chunk).toString('utf8');
}

async function captureProcessTrace<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; trace: string }> {
  const originalStdout = process.stdout.write.bind(process.stdout) as WriteFn;
  const originalStderr = process.stderr.write.bind(process.stderr) as WriteFn;
  let trace = '';

  const capture =
    (_writer: WriteFn) =>
    (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((err?: Error | null) => void),
      callback?: (err?: Error | null) => void,
    ): boolean => {
      trace += chunkToString(chunk);
      const done =
        typeof encodingOrCallback === 'function'
          ? encodingOrCallback
          : callback;
      done?.(null);
      return true;
    };

  process.stdout.write = capture(originalStdout) as WriteFn;
  process.stderr.write = capture(originalStderr) as WriteFn;

  try {
    const result = await fn();
    return { result, trace };
  } finally {
    process.stdout.write = originalStdout;
    process.stderr.write = originalStderr;
  }
}

function traceLineCount(trace: string): number {
  return trace
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function printTrace(trace: string): void {
  const trimmed = trace.trim();
  if (!trimmed) {
    process.stdout.write('\n  (no raw trace captured)\n\n');
    return;
  }
  process.stdout.write('\n  ----- raw agent trace -----\n');
  for (const line of trimmed.split('\n')) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write('  ----- end raw agent trace -----\n\n');
}

function phaseLabel(event: ChatProgressEvent): string {
  switch (event.phase) {
    case 'planning-response':
      return 'planning response...';
    case 'running-sealed-inference':
      return 'running sealed inference...';
    case 'notarizing-response':
      return 'notarizing response...';
    case 'attesting-response':
      return 'attesting response...';
    case 'completed':
      return 'response notarized.';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const rpc = requireEnv('ZERO_G_RPC_URL');
  const chainId = Number(process.env.ZERO_G_CHAIN_ID ?? '16602');
  const principalKey = requireEnv('ZERO_G_PRIVATE_KEY');
  const registryAddress = requireEnv('SIGIL_REGISTRY_ADDRESS');
  const notaryAddress = requireEnv('PROVENANCE_NOTARY_ADDRESS');
  const defaultModel =
    process.env.ZERO_G_COMPUTE_DEFAULT_MODEL ?? 'qwen/qwen-2.5-7b-instruct';
  const model = args.model ?? defaultModel;
  const explorer = process.env.ZERO_G_EXPLORER_URL ?? 'https://chainscan-galileo.0g.ai';

  const fixture = loadFixture(args.name);
  const provider = buildProvider(rpc, chainId);
  const principal = new ethers.Wallet(principalKey, provider);
  const agentWallet = new ethers.Wallet(fixture.agentPrivateKey, provider);

  // Auto-attest sidecar — only enabled if the relay key is set in the env
  // AND the demo operator has registered that address with `add-relay`.
  // Falls back silently to "no sidecar" so the chat still works on a fresh
  // checkout without setup.
  const relayKey = process.env.SIGIL_KEEPER_RELAY_PRIVATE_KEY;
  const relayWallet = relayKey ? new ethers.Wallet(relayKey, provider) : undefined;

  // Best-effort enrich the system prompt with the agent description from
  // the credential file (~/.sigil/credentials/<name>.json) if it exists.
  // The chat works with or without it.
  let description: string | undefined;
  try {
    const cred = readCredential(args.name);
    description = cred.agentDescription;
  } catch {
    /* credential file is optional */
  }

  const agentSigil = new SigilClient({
    rpcUrl: rpc,
    chainId,
    registryAddress,
    notaryAddress,
    signer: agentWallet,
    computeDefaultModel: model,
    autoAttest: relayWallet
      ? { relaySigner: relayWallet, defaultPassed: true }
      : undefined,
  });
  const principalCompute = new ZeroGComputeAdapter({
    signer: principal,
    defaultModel: model,
  });

  const agent = new ChatAgent({
    sigil: agentSigil,
    compute: principalCompute,
    passportId: fixture.passportId as PassportId,
    identity: {
      passportId: fixture.passportId as PassportId,
      agentAddress: fixture.agentAddress,
      principal: principal.address,
      description,
    },
    model,
  });

  process.stdout.write(`\nSigil chat — agent "${args.name}"\n`);
  printIdentity({
    passportId: fixture.passportId,
    agentAddress: fixture.agentAddress,
    principal: principal.address,
    description,
  });
  process.stdout.write(`  model       ${model}\n`);
  process.stdout.write(`  notary      ${notaryAddress}\n`);
  process.stdout.write(
    `  auto-attest ${
      relayWallet
        ? `ON (relay ${relayWallet.address}) — DEMO SIMULATOR`
        : 'OFF (set SIGIL_KEEPER_RELAY_PRIVATE_KEY + run add-relay to enable)'
    }\n`,
  );

  // Each turn spends ~0.005 OG on 0G Storage submits + a notarize tx. When the
  // agent wallet runs dry, 0G's flow contract reverts during `estimateGas`
  // with an opaque `require(false)` and the chat looks "stuck at notarizing".
  // Catch it up front instead.
  const agentBal = await provider.getBalance(agentWallet.address);
  const minAgentBal = ethers.parseEther('0.01');
  process.stdout.write(`  balance     ${ethers.formatEther(agentBal)} OG\n`);
  if (agentBal < minAgentBal) {
    process.stdout.write(
      `\n  WARNING: agent wallet is low — each turn needs ~0.005 OG for 0G Storage fees.\n` +
        `  top up before chatting:\n` +
        `    pnpm --filter sigil-demo run top-up -- --name ${args.name} --amount 0.1\n`,
    );
  }
  process.stdout.write(
    `\nType a task in plain English. /help for commands. /exit (or Ctrl-D) to quit.\n\n`,
  );

  let lastTurn: ChatTurn | null = null;
  let lastTrace = '';
  let busy = false;
  let traceMode = false;
  const directOut = process.stdout.write.bind(process.stdout) as WriteFn;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });
  rl.prompt();

  rl.on('line', async (rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      rl.prompt();
      return;
    }
    if (busy) {
      process.stdout.write('  (busy — wait for the previous turn to finish)\n');
      return;
    }

    if (line.startsWith('/')) {
      const cmd = line.slice(1).split(/\s+/)[0];
      switch (cmd) {
        case 'help':
        case 'h':
        case '?':
          process.stdout.write(
            `\nCommands:\n` +
              `  /whoami    print agent passport, address, principal\n` +
              `  /last      show the most recent notarization\n` +
              `  /trace     toggle raw trace output on/off\n` +
              `  /last-trace show the raw trace from the previous turn\n` +
              `  /help      this list\n` +
              `  /exit      quit\n\n`,
          );
          break;
        case 'whoami':
        case 'me':
          process.stdout.write('\n');
          printIdentity({
            passportId: fixture.passportId,
            agentAddress: fixture.agentAddress,
            principal: principal.address,
            description,
          });
          process.stdout.write('\n');
          break;
        case 'last':
          if (!lastTurn) {
            process.stdout.write('\n  no notarizations yet in this session.\n\n');
          } else {
            printTurn(lastTurn, explorer);
            process.stdout.write('\n');
          }
          break;
        case 'trace':
          traceMode = !traceMode;
          process.stdout.write(
            `\n  raw trace ${traceMode ? 'enabled' : 'hidden'} for future turns.\n\n`,
          );
          break;
        case 'last-trace':
          printTrace(lastTrace);
          break;
        case 'exit':
        case 'quit':
        case 'q':
          rl.close();
          return;
        default:
          process.stdout.write(`\n  unknown command: /${cmd}  (try /help)\n\n`);
      }
      rl.prompt();
      return;
    }

    busy = true;
    const start = Date.now();
    process.stdout.write(`  planning response...\n`);
    const attestationHint =
      relayWallet != null
        ? setTimeout(() => {
            if (busy) {
              process.stdout.write(`  attesting response...\n`);
            }
          }, 20_000)
        : null;
    try {
      const { result: turn, trace } = await captureProcessTrace(() =>
        agent.ask(line, {
          onProgress: async (event) => {
            writeChunk(directOut, `  ${phaseLabel(event)}\n`);
          },
        }),
      );
      lastTurn = turn;
      lastTrace = trace;
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      printTurn(turn, explorer);
      if (traceMode) {
        printTrace(trace);
      } else {
        const lines = traceLineCount(trace);
        if (lines > 0) {
          process.stdout.write(
            `  raw trace hidden (${lines} lines) — use /last-trace to inspect or /trace to always show it.\n`,
          );
        }
      }
      process.stdout.write(`  (${elapsed}s)\n\n`);
    } catch (err) {
      process.stdout.write(`\n  ERROR: ${(err as Error).message}\n\n`);
    } finally {
      if (attestationHint != null) {
        clearTimeout(attestationHint);
      }
      busy = false;
      rl.prompt();
    }
  });

  rl.on('close', () => {
    process.stdout.write('\nbye.\n');
    process.exit(0);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FATAL:', err);
  process.exit(1);
});
