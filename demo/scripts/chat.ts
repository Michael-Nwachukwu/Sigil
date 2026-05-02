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

// Pino writes via SonicBoom directly to file descriptors and bypasses the
// process.stdout/stderr capture this REPL uses to render clean turns. Force
// error level so info/warn lines never leak as JSON between prompts.
process.env.LOG_LEVEL = 'error';

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

// ---------------------------------------------------------------------------
// Terminal colors (ANSI — no external dep needed)
// ---------------------------------------------------------------------------
const R = '\x1b[0m';  // reset
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const BWHITE = '\x1b[97m';
const BGREEN = '\x1b[92m';
const BCYAN = '\x1b[96m';

function label(s: string): string {
  return `${DIM}${s}${R}`;
}
function val(s: string): string {
  return `${BCYAN}${s}${R}`;
}
function link(s: string): string {
  return `${BLUE}${s}${R}`;
}
function sep(): string {
  return `${DIM}${'─'.repeat(60)}${R}`;
}

function printIdentity(args: {
  passportId: string;
  agentAddress: string;
  principal: string;
  description?: string;
}) {
  const w = process.stdout.write.bind(process.stdout);
  w(`  ${label('passportId')}  ${val(args.passportId)}\n`);
  w(`  ${label('agent      ')}  ${CYAN}${args.agentAddress}${R}\n`);
  w(`  ${label('principal  ')}  ${DIM}${args.principal}${R}\n`);
  if (args.description) w(`  ${label('description')}  ${DIM}${args.description}${R}\n`);
}

function printTurn(turn: ChatTurn, explorer: string, elapsed: string) {
  const w = process.stdout.write.bind(process.stdout);
  w(`\n${sep()}\n`);
  w(`${BWHITE}${turn.output.trim()}${R}\n`);
  w(`${sep()}\n\n`);

  w(`  ${label('recordId  ')}  ${val(turn.notarized.recordId)}\n`);
  w(`  ${label('outputHash')}  ${val(turn.notarized.outputHash)}\n`);
  w(`  ${label('notarizeTx')}  ${link(explorerTx(explorer, turn.notarized.txHash))}\n`);

  const att = turn.notarized.attestation;
  if (att) {
    w(
      `  ${label('attestTx  ')}  ${link(explorerTx(explorer, att.txHash))} ` +
      `${DIM}(${AttestationType[att.attestationType]} ${att.passed ? `${BGREEN}passed${R}${DIM}` : `${RED}failed${R}${DIM}`} · demo-simulated)${R}\n`,
    );
  }

  const teeStr =
    turn.verified === true
      ? `${BGREEN}✓ TEE verified${R}`
      : turn.verified === false
        ? `${YELLOW}⚠ TEE unverified${R}`
        : `${DIM}TEE unknown${R}`;
  w(`  ${teeStr}  ${DIM}${elapsed}s${R}\n\n`);
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
      return `${YELLOW}⟳${R} ${DIM}planning response...${R}`;
    case 'running-sealed-inference':
      return `${YELLOW}⟳${R} ${DIM}running sealed inference...${R}`;
    case 'notarizing-response':
      return `${YELLOW}⟳${R} ${DIM}notarizing response...${R}`;
    case 'attesting-response':
      return `${YELLOW}⟳${R} ${DIM}appending fingerprint + attestation...${R}`;
    case 'completed':
      return `${BGREEN}✓${R} ${DIM}response notarized${R}`;
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

  // Auto-attest sidecar selection. Direct mode is preferred when a relay
  // private key is set: the chat owns the keypair, signs locally, and gets a
  // confirmed tx hash back without depending on KeeperHub workflow plumbing.
  // KeeperHub workflow mode stays in the SDK for future use but is not used
  // here — the Webhook trigger doesn't receive body via the execute API, so
  // the workflow rejects every call as "passportId missing". See
  // sdk/src/passport/AutoAttest.ts for the open issue.
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
      ? { mode: 'direct', relaySigner: relayWallet, defaultPassed: true }
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

  const w = process.stdout.write.bind(process.stdout);
  w(`\n${BOLD}${CYAN}Sigil${R} ${BOLD}chat${R}  ${DIM}agent "${args.name}"${R}\n`);
  w(`${DIM}${'─'.repeat(60)}${R}\n`);
  printIdentity({
    passportId: fixture.passportId,
    agentAddress: fixture.agentAddress,
    principal: principal.address,
    description,
  });
  w(`  ${label('model      ')}  ${DIM}${model}${R}\n`);
  w(`  ${label('notary     ')}  ${DIM}${notaryAddress}${R}\n`);
  w(
    `  ${label('auto-attest')}  ${
      relayWallet
        ? `${MAGENTA}ON direct${R} ${DIM}(relay ${relayWallet.address}) — DEMO SIMULATOR${R}`
        : `${DIM}OFF${R}`
    }\n`,
  );

  // Each turn spends ~0.005 OG on 0G Storage submits + a notarize tx. When the
  // agent wallet runs dry, 0G's flow contract reverts during `estimateGas`
  // with an opaque `require(false)` and the chat looks "stuck at notarizing".
  // Catch it up front instead.
  const agentBal = await provider.getBalance(agentWallet.address);
  const minAgentBal = ethers.parseEther('0.01');
  const balStr = ethers.formatEther(agentBal);
  w(
    `  ${label('balance    ')}  ${agentBal < minAgentBal ? RED : BGREEN}${balStr} OG${R}\n`,
  );
  if (agentBal < minAgentBal) {
    w(
      `\n  ${YELLOW}⚠ agent wallet low${R} ${DIM}— each turn needs ~0.005 OG for 0G Storage fees${R}\n` +
        `  ${DIM}top up:  pnpm --filter sigil-demo run top-up -- --name ${args.name} --amount 0.1${R}\n`,
    );
  }
  w(`${DIM}${'─'.repeat(60)}${R}\n`);
  w(`${DIM}Type anything to chat. /help for commands. Ctrl-D to quit.${R}\n\n`);

  let lastTurn: ChatTurn | null = null;
  let lastTrace = '';
  let busy = false;
  let traceMode = false;
  const directOut = process.stdout.write.bind(process.stdout) as WriteFn;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${CYAN}>${R} `,
  });
  rl.prompt();

  rl.on('line', async (rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      rl.prompt();
      return;
    }
    if (busy) {
      process.stdout.write(`  ${YELLOW}busy — wait for the previous turn to finish${R}\n`);
      return;
    }

    if (line.startsWith('/')) {
      const cmd = line.slice(1).split(/\s+/)[0];
      switch (cmd) {
        case 'help':
        case 'h':
        case '?':
          process.stdout.write(
            `\n${BOLD}Commands${R}\n` +
              `  ${CYAN}/whoami${R}      ${DIM}print agent passport, address, principal${R}\n` +
              `  ${CYAN}/last${R}        ${DIM}show the most recent notarization${R}\n` +
              `  ${CYAN}/trace${R}       ${DIM}toggle raw trace output on/off${R}\n` +
              `  ${CYAN}/last-trace${R}  ${DIM}show the raw trace from the previous turn${R}\n` +
              `  ${CYAN}/help${R}        ${DIM}this list${R}\n` +
              `  ${CYAN}/exit${R}        ${DIM}quit${R}\n\n`,
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
            process.stdout.write(`\n  ${DIM}no notarizations yet in this session.${R}\n\n`);
          } else {
            printTurn(lastTurn, explorer, '—');
          }
          break;
        case 'trace':
          traceMode = !traceMode;
          process.stdout.write(
            `\n  ${DIM}raw trace ${traceMode ? 'enabled' : 'hidden'} for future turns.${R}\n\n`,
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
          process.stdout.write(`\n  ${RED}unknown command:${R} /${cmd}  ${DIM}(try /help)${R}\n\n`);
      }
      rl.prompt();
      return;
    }

    busy = true;
    const start = Date.now();
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
      printTurn(turn, explorer, elapsed);
      if (traceMode) {
        printTrace(trace);
      } else {
        const lines = traceLineCount(trace);
        if (lines > 0) {
          process.stdout.write(
            `  ${DIM}raw trace hidden (${lines} lines) — /last-trace to inspect · /trace to always show${R}\n\n`,
          );
        }
      }
    } catch (err) {
      process.stdout.write(`\n  ${RED}ERROR:${R} ${(err as Error).message}\n\n`);
    } finally {
      busy = false;
      rl.prompt();
    }
  });

  rl.on('close', () => {
    process.stdout.write(`\n${DIM}bye.${R}\n`);
    process.exit(0);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FATAL:', err);
  process.exit(1);
});
