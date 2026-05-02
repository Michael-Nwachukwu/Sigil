/**
 * Sigil demo — interactive audit-agent REPL.
 *
 * Point the agent at a Solidity file and interrogate it in natural language.
 * Every audit run and every follow-up question is sealed-inferred via 0G
 * Compute and notarized on the ProvenanceNotary contract.
 *
 *   pnpm --filter sigil-demo run audit-chat
 *
 * Slash commands:
 *   /audit <path>      audit a .sol file on disk
 *   /audit <fixture>   audit a built-in fixture (vault-reentrancy | unchecked-owner | safe-counter)
 *   /audit             re-audit the last file/fixture
 *   /fixtures          list built-in fixtures
 *   /whoami            print the agent's passport identity
 *   /last              show the most recent result (audit or chat turn)
 *   /trace             toggle raw trace output
 *   /last-trace        show raw trace from previous turn
 *   /help              this list
 *   /exit              quit (Ctrl-D also works)
 *
 * Anything not starting with / is sent to the ChatAgent as a free-text
 * question — useful for follow-up questions about findings.
 *
 * Reuses the audit-agent fixture under demo/.fixtures/audit-agent.json.
 * First run registers a fresh AuditAgent passport; subsequent runs load it.
 */

import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
loadEnv({ path: path.resolve(__dirname, '../../.env') });

// Force pino to error level so info/warn JSON never leaks into the REPL output.
process.env.LOG_LEVEL = 'error';

import { ethers } from 'ethers';
import {
  SigilClient,
  ZeroGComputeAdapter,
  type PassportId,
} from 'sigil-protocol';
import { AuditAgent, AUDIT_FIXTURES, type AuditAssessment, type Severity } from '../agents/AuditAgent';
import { ChatAgent, buildChatSystemPrompt, type ChatTurn, type ChatProgressEvent } from '../agents/ChatAgent';

// ---------------------------------------------------------------------------
// ANSI colours
// ---------------------------------------------------------------------------
const R       = '\x1b[0m';
const DIM     = '\x1b[2m';
const BOLD    = '\x1b[1m';
const RED     = '\x1b[31m';
const GREEN   = '\x1b[32m';
const YELLOW  = '\x1b[33m';
const BLUE    = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN    = '\x1b[36m';
const BWHITE  = '\x1b[97m';
const BGREEN  = '\x1b[92m';
const BRED    = '\x1b[91m';

function label(s: string) { return `${DIM}${s}${R}`; }
function val(s: string)   { return `\x1b[96m${s}${R}`; }
function link(s: string)  { return `${BLUE}${s}${R}`; }
function sep()            { return `${DIM}${'─'.repeat(60)}${R}`; }

function severityColor(s: Severity): string {
  switch (s) {
    case 'none':     return BGREEN;
    case 'low':      return GREEN;
    case 'medium':   return YELLOW;
    case 'high':     return RED;
    case 'critical': return BRED + BOLD;
  }
}

function colorSeverity(s: Severity): string {
  return `${severityColor(s)}${s.toUpperCase()}${R}`;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
interface AuditAgentFixture {
  passportId: PassportId;
  agentAddress: string;
  agentPrivateKey: string;
  registerTx: string;
  fundTx: string;
  registeredAt: string;
}

const FIXTURE_DIR  = path.resolve(__dirname, '../.fixtures');
const FIXTURE_FILE = path.join(FIXTURE_DIR, 'audit-agent.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildProvider(rpc: string, chainId: number): ethers.JsonRpcProvider {
  const fr = new ethers.FetchRequest(rpc);
  fr.timeout = 60_000;
  return new ethers.JsonRpcProvider(fr, { chainId, name: '0g-galileo-testnet' });
}

function explorerTx(explorer: string, hash: string) {
  return `${explorer}/tx/${hash}`;
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) { process.stderr.write(`missing required env var: ${key}\n`); process.exit(1); }
  return v;
}

// ---------------------------------------------------------------------------
// Printers
// ---------------------------------------------------------------------------
function printIdentity(args: {
  passportId: string; agentAddress: string; principal: string; description?: string;
}) {
  const w = process.stdout.write.bind(process.stdout);
  w(`  ${label('passportId')}  ${val(args.passportId)}\n`);
  w(`  ${label('agent      ')}  ${CYAN}${args.agentAddress}${R}\n`);
  w(`  ${label('principal  ')}  ${DIM}${args.principal}${R}\n`);
  if (args.description) w(`  ${label('description')}  ${DIM}${args.description}${R}\n`);
}

function printAuditResult(a: AuditAssessment, explorer: string, elapsed: string) {
  const w = process.stdout.write.bind(process.stdout);
  w(`\n${sep()}\n`);

  // Overall severity banner
  const sc = severityColor(a.report.overallSeverity);
  w(`${sc}${BOLD}  ${a.report.overallSeverity.toUpperCase()} SEVERITY${R}  ${DIM}${a.input.name} · ${a.input.sourceBytes} bytes${R}\n`);
  w(`\n  ${BWHITE}${a.report.summary}${R}\n`);

  // Findings
  if (a.report.findings.length === 0) {
    w(`\n  ${BGREEN}No findings.${R}\n`);
  } else {
    w(`\n`);
    for (const [i, f] of a.report.findings.entries()) {
      const loc = f.lines ? ` ${DIM}L${f.lines}${R}` : '';
      w(`  ${colorSeverity(f.severity)} ${BOLD}${f.category}${R}${loc}\n`);
      w(`  ${DIM}${f.description}${R}\n`);
      if (i < a.report.findings.length - 1) w(`\n`);
    }
  }

  w(`\n${sep()}\n\n`);

  // Provenance
  w(`  ${label('recordId  ')}  ${val(a.notarized.recordId)}\n`);
  w(`  ${label('outputHash')}  ${val(a.notarized.outputHash)}\n`);
  w(`  ${label('notarizeTx')}  ${link(explorerTx(explorer, a.notarized.txHash))}\n`);
  if (a.notarized.attestation) {
    const att = a.notarized.attestation;
    w(
      `  ${label('attestTx  ')}  ${link(explorerTx(explorer, att.txHash))} ` +
      `${DIM}(${att.passed ? `${BGREEN}passed${R}${DIM}` : `${RED}failed${R}${DIM}`} · demo-simulated)${R}\n`,
    );
  }
  const teeStr = a.verified === true
    ? `${BGREEN}✓ TEE verified${R}`
    : a.verified === false
      ? `${YELLOW}⚠ TEE unverified${R}`
      : `${DIM}TEE unknown${R}`;
  w(`  ${teeStr}  ${DIM}${elapsed}s${R}\n\n`);
}

function printChatTurn(turn: ChatTurn, explorer: string, elapsed: string) {
  const w = process.stdout.write.bind(process.stdout);
  w(`\n${sep()}\n`);
  w(`${BWHITE}${turn.output.trim()}${R}\n`);
  w(`${sep()}\n\n`);
  w(`  ${label('recordId  ')}  ${val(turn.notarized.recordId)}\n`);
  w(`  ${label('outputHash')}  ${val(turn.notarized.outputHash)}\n`);
  w(`  ${label('notarizeTx')}  ${link(explorerTx(explorer, turn.notarized.txHash))}\n`);
  if (turn.notarized.attestation) {
    const att = turn.notarized.attestation;
    w(
      `  ${label('attestTx  ')}  ${link(explorerTx(explorer, att.txHash))} ` +
      `${DIM}(${att.passed ? `${BGREEN}passed${R}${DIM}` : `${RED}failed${R}${DIM}`} · demo-simulated)${R}\n`,
    );
  }
  const teeStr = turn.verified === true
    ? `${BGREEN}✓ TEE verified${R}`
    : turn.verified === false
      ? `${YELLOW}⚠ TEE unverified${R}`
      : `${DIM}TEE unknown${R}`;
  w(`  ${teeStr}  ${DIM}${elapsed}s${R}\n\n`);
}

function phaseLabel(event: ChatProgressEvent): string {
  switch (event.phase) {
    case 'planning-response':        return `${YELLOW}⟳${R} ${DIM}planning response...${R}`;
    case 'running-sealed-inference': return `${YELLOW}⟳${R} ${DIM}running sealed inference...${R}`;
    case 'notarizing-response':      return `${YELLOW}⟳${R} ${DIM}notarizing response...${R}`;
    case 'attesting-response':       return `${YELLOW}⟳${R} ${DIM}appending fingerprint + attestation...${R}`;
    case 'completed':                return `${BGREEN}✓${R} ${DIM}response notarized${R}`;
  }
}

// ---------------------------------------------------------------------------
// stdout/stderr capture (keeps pino JSON off the screen during async work)
// ---------------------------------------------------------------------------
type WriteFn = typeof process.stdout.write;

function chunkToString(chunk: string | Uint8Array): string {
  return typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
}

async function captureProcessTrace<T>(fn: () => Promise<T>): Promise<{ result: T; trace: string }> {
  const origOut = process.stdout.write.bind(process.stdout) as WriteFn;
  const origErr = process.stderr.write.bind(process.stderr) as WriteFn;
  let trace = '';
  const capture =
    (_w: WriteFn) =>
    (
      chunk: string | Uint8Array,
      encOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void,
    ): boolean => {
      trace += chunkToString(chunk);
      (typeof encOrCb === 'function' ? encOrCb : cb)?.(null);
      return true;
    };
  process.stdout.write = capture(origOut) as WriteFn;
  process.stderr.write = capture(origErr) as WriteFn;
  try {
    const result = await fn();
    return { result, trace };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

function traceLineCount(trace: string): number {
  return trace.split('\n').map(l => l.trim()).filter(Boolean).length;
}

function printTrace(trace: string): void {
  const t = trace.trim();
  if (!t) { process.stdout.write('\n  (no raw trace captured)\n\n'); return; }
  process.stdout.write('\n  ----- raw agent trace -----\n');
  for (const line of t.split('\n')) process.stdout.write(`  ${line}\n`);
  process.stdout.write('  ----- end raw agent trace -----\n\n');
}

// ---------------------------------------------------------------------------
// Register-or-load
// ---------------------------------------------------------------------------
async function setupOrLoad(opts: {
  rpc: string; chainId: number;
  registryAddress: string; notaryAddress: string;
  model: string; principal: ethers.Wallet;
}): Promise<AuditAgentFixture> {
  const w = process.stdout.write.bind(process.stdout);

  if (fs.existsSync(FIXTURE_FILE)) {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8')) as AuditAgentFixture;
    w(`  ${label('passportId')}  ${val(fixture.passportId)}\n`);
    w(`  ${label('agent     ')}  ${CYAN}${fixture.agentAddress}${R}\n`);
    w(`  ${label('registered')}  ${DIM}${fixture.registeredAt}${R}\n`);
    return fixture;
  }

  w(`  ${DIM}no fixture found — registering a fresh AuditAgent...${R}\n`);
  const principalSigil = new SigilClient({
    rpcUrl: opts.rpc, chainId: opts.chainId,
    registryAddress: opts.registryAddress, notaryAddress: opts.notaryAddress,
    signer: opts.principal, computeDefaultModel: opts.model,
  });
  const reg = await principalSigil.passport.register({
    agentDescription: 'Sigil demo AuditAgent — Solidity security audits via 0G Compute (qwen-2.5-7b-instruct)',
    permissions: {
      whitelistedContracts: [], maxTxValuePerWindow: { OG: 0 },
      authorizedApis: ['0g.compute'], allowedTokens: ['OG'], timeWindowSeconds: 3600,
    },
  });
  w(`  ${BGREEN}registered${R}  ${val(reg.passportId)}\n`);

  const fundTx = await opts.principal.sendTransaction({ to: reg.agentAddress, value: ethers.parseEther('0.05') });
  const fundReceipt = await fundTx.wait();
  if (!fundReceipt || fundReceipt.status !== 1) throw new Error(`fund tx ${fundTx.hash} failed`);
  w(`  ${BGREEN}funded${R}      ${DIM}0.05 OG → ${reg.agentAddress}${R}\n`);

  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const fixture: AuditAgentFixture = {
    passportId: reg.passportId, agentAddress: reg.agentAddress,
    agentPrivateKey: reg.agentPrivateKey, registerTx: reg.txHash,
    fundTx: fundTx.hash, registeredAt: new Date().toISOString(),
  };
  fs.writeFileSync(FIXTURE_FILE, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  return fixture;
}

// ---------------------------------------------------------------------------
// Resolve /audit argument → { name, source }
// ---------------------------------------------------------------------------
function resolveAuditTarget(
  arg: string | undefined,
  lastTarget: { name: string; source: string } | null,
): { name: string; source: string } | null {
  if (!arg && lastTarget) return lastTarget;
  if (!arg) return null;

  // Disk path
  const abs = path.resolve(arg);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    return { name: path.basename(abs), source: fs.readFileSync(abs, 'utf8') };
  }
  // Built-in fixture
  const fixture = AUDIT_FIXTURES[arg];
  if (fixture) return fixture;

  return null; // unknown
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const w = process.stdout.write.bind(process.stdout);

  const rpc             = requireEnv('ZERO_G_RPC_URL');
  const chainId         = Number(process.env.ZERO_G_CHAIN_ID ?? '16602');
  const principalKey    = requireEnv('ZERO_G_PRIVATE_KEY');
  const registryAddress = requireEnv('SIGIL_REGISTRY_ADDRESS');
  const notaryAddress   = requireEnv('PROVENANCE_NOTARY_ADDRESS');
  const model           = process.env.ZERO_G_COMPUTE_DEFAULT_MODEL ?? 'qwen/qwen-2.5-7b-instruct';
  const explorer        = process.env.ZERO_G_EXPLORER_URL ?? 'https://chainscan-galileo.0g.ai';

  const provider  = buildProvider(rpc, chainId);
  const principal = new ethers.Wallet(principalKey, provider);

  const relayKey    = process.env.SIGIL_KEEPER_RELAY_PRIVATE_KEY;
  const relayWallet = relayKey ? new ethers.Wallet(relayKey, provider) : undefined;

  // Banner
  w(`\n${sep()}\n`);
  w(`  ${BOLD}${CYAN}Sigil audit-chat${R}  ${DIM}interactive Solidity security auditor${R}\n`);
  w(`${sep()}\n\n`);
  w(`  ${label('principal  ')}  ${DIM}${principal.address}${R}\n`);
  w(`  ${label('model      ')}  ${DIM}${model}${R}\n`);
  w(
    `  ${label('auto-attest')}  ${
      relayWallet
        ? `${MAGENTA}ON direct${R} ${DIM}(relay ${relayWallet.address}) — DEMO SIMULATOR${R}`
        : `${DIM}OFF${R}`
    }\n`,
  );
  w(`\n`);

  // Setup
  w(`  ${DIM}Loading agent...${R}\n`);
  const fixture = await setupOrLoad({ rpc, chainId, registryAddress, notaryAddress, model, principal });

  const agentWallet = new ethers.Wallet(fixture.agentPrivateKey, provider);
  const agentBal    = await provider.getBalance(agentWallet.address);
  w(
    `  ${label('balance    ')}  ${agentBal < ethers.parseEther('0.01') ? RED : BGREEN}` +
    `${ethers.formatEther(agentBal)} OG${R}\n`,
  );
  if (agentBal < ethers.parseEther('0.01')) {
    w(
      `\n  ${YELLOW}⚠ agent wallet low${R} ${DIM}— each turn needs ~0.005 OG${R}\n` +
      `  ${DIM}top up:  pnpm --filter sigil-demo run top-up -- --name audit-agent --amount 0.1${R}\n`,
    );
  }

  w(`${sep()}\n`);
  w(`${DIM}  /audit <path.sol>  to audit a file   ·  /audit <fixture>  for built-in examples${R}\n`);
  w(`${DIM}  /fixtures  list built-ins  ·  /help  all commands  ·  Ctrl-D to quit${R}\n\n`);

  // Build agents
  const agentSigil = new SigilClient({
    rpcUrl: rpc, chainId, registryAddress, notaryAddress,
    signer: agentWallet, computeDefaultModel: model,
    autoAttest: relayWallet
      ? { mode: 'direct', relaySigner: relayWallet, defaultPassed: true }
      : undefined,
  });
  const principalCompute = new ZeroGComputeAdapter({ signer: principal, defaultModel: model });

  const auditAgent = new AuditAgent({ sigil: agentSigil, compute: principalCompute, passportId: fixture.passportId, model });
  const chatAgent  = new ChatAgent({
    sigil: agentSigil, compute: principalCompute,
    passportId: fixture.passportId,
    identity: {
      passportId: fixture.passportId,
      agentAddress: fixture.agentAddress,
      principal: principal.address,
      description: 'Sigil demo AuditAgent — Solidity security auditor',
    },
    model,
  });

  // REPL state
  type LastResult =
    | { kind: 'audit'; assessment: AuditAssessment; elapsed: string }
    | { kind: 'chat';  turn: ChatTurn;               elapsed: string };

  let lastResult: LastResult | null = null;
  let lastTrace  = '';
  let lastTarget: { name: string; source: string } | null = null;
  let busy       = false;
  let traceMode  = false;

  const directOut = process.stdout.write.bind(process.stdout) as WriteFn;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${CYAN}>${R} `,
  });
  rl.prompt();

  rl.on('line', async (rawLine) => {
    const line = rawLine.trim();
    if (!line) { rl.prompt(); return; }

    if (busy) {
      process.stdout.write(`  ${YELLOW}busy — wait for the current operation to finish${R}\n`);
      rl.prompt();
      return;
    }

    // ── slash commands ───────────────────────────────────────────────────────
    if (line.startsWith('/')) {
      const parts = line.slice(1).split(/\s+/);
      const cmd   = parts[0];
      const rest  = parts.slice(1).join(' ').trim();

      switch (cmd) {

        case 'audit': {
          const target = resolveAuditTarget(rest || undefined, lastTarget);
          if (!target) {
            if (rest) {
              process.stdout.write(
                `\n  ${RED}not found:${R} ${rest}\n` +
                `  ${DIM}Pass a .sol file path or a fixture name. Try /fixtures.${R}\n\n`,
              );
            } else {
              process.stdout.write(
                `\n  ${DIM}usage: /audit <path.sol> | /audit <fixture-name>${R}\n` +
                `  ${DIM}Try /fixtures to see built-in examples.${R}\n\n`,
              );
            }
            rl.prompt();
            return;
          }

          lastTarget = target;
          busy = true;
          const start = Date.now();
          process.stdout.write(`\n  ${YELLOW}⟳${R} ${DIM}running sealed audit: ${target.name}...${R}\n`);
          process.stdout.write(`  ${YELLOW}⟳${R} ${DIM}running sealed inference...${R}\n`);
          try {
            const { result: assessment, trace } = await captureProcessTrace(() =>
              auditAgent.auditContract(target),
            );
            lastTrace = trace;
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            lastResult = { kind: 'audit', assessment, elapsed };
            process.stdout.write(`  ${BGREEN}✓${R} ${DIM}audit notarized${R}\n`);
            printAuditResult(assessment, explorer, elapsed);
            if (traceMode) {
              printTrace(trace);
            } else {
              const lc = traceLineCount(trace);
              if (lc > 0)
                process.stdout.write(`  ${DIM}raw trace hidden (${lc} lines) — /last-trace to inspect${R}\n\n`);
            }
          } catch (err) {
            process.stdout.write(`\n  ${RED}audit failed:${R} ${(err as Error).message}\n\n`);
          } finally {
            busy = false;
          }
          rl.prompt();
          return;
        }

        case 'fixtures': {
          process.stdout.write(`\n${BOLD}  Built-in fixtures${R}\n`);
          for (const [key, f] of Object.entries(AUDIT_FIXTURES)) {
            process.stdout.write(`  ${CYAN}/audit ${key}${R}  ${DIM}${f.name}${R}\n`);
          }
          process.stdout.write('\n');
          rl.prompt();
          return;
        }

        case 'whoami':
        case 'me':
          process.stdout.write('\n');
          printIdentity({ passportId: fixture.passportId, agentAddress: fixture.agentAddress, principal: principal.address, description: 'Solidity security auditor' });
          process.stdout.write('\n');
          rl.prompt();
          return;

        case 'last':
          if (!lastResult) {
            process.stdout.write(`\n  ${DIM}no results yet in this session.${R}\n\n`);
          } else if (lastResult.kind === 'audit') {
            printAuditResult(lastResult.assessment, explorer, lastResult.elapsed);
          } else {
            printChatTurn(lastResult.turn, explorer, lastResult.elapsed);
          }
          rl.prompt();
          return;

        case 'trace':
          traceMode = !traceMode;
          process.stdout.write(`\n  ${DIM}raw trace ${traceMode ? 'enabled' : 'hidden'} for future turns.${R}\n\n`);
          rl.prompt();
          return;

        case 'last-trace':
          printTrace(lastTrace);
          rl.prompt();
          return;

        case 'help':
        case 'h':
        case '?':
          process.stdout.write(
            `\n${BOLD}Commands${R}\n` +
            `  ${CYAN}/audit <path.sol>${R}   ${DIM}audit a file on disk${R}\n` +
            `  ${CYAN}/audit <fixture>${R}    ${DIM}run a built-in fixture${R}\n` +
            `  ${CYAN}/audit${R}              ${DIM}re-run the last audit${R}\n` +
            `  ${CYAN}/fixtures${R}           ${DIM}list built-in fixtures${R}\n` +
            `  ${CYAN}/whoami${R}             ${DIM}print passport identity${R}\n` +
            `  ${CYAN}/last${R}               ${DIM}show last audit or chat result${R}\n` +
            `  ${CYAN}/trace${R}              ${DIM}toggle raw trace output${R}\n` +
            `  ${CYAN}/last-trace${R}         ${DIM}show raw trace from previous turn${R}\n` +
            `  ${CYAN}/help${R}               ${DIM}this list${R}\n` +
            `  ${CYAN}/exit${R}               ${DIM}quit${R}\n` +
            `\n  ${DIM}Anything else is sent to the agent as a chat message.${R}\n\n`,
          );
          rl.prompt();
          return;

        case 'exit':
        case 'quit':
        case 'q':
          rl.close();
          return;

        default:
          process.stdout.write(`\n  ${RED}unknown command:${R} /${cmd}  ${DIM}(try /help)${R}\n\n`);
          rl.prompt();
          return;
      }
    }

    // ── free-text chat ───────────────────────────────────────────────────────
    busy = true;
    const start = Date.now();
    try {
      const { result: turn, trace } = await captureProcessTrace(() =>
        chatAgent.ask(line, {
          onProgress: async (event) => {
            writeChunk(directOut, `  ${phaseLabel(event)}\n`);
          },
        }),
      );
      lastTrace = trace;
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      lastResult = { kind: 'chat', turn, elapsed };
      printChatTurn(turn, explorer, elapsed);
      if (traceMode) {
        printTrace(trace);
      } else {
        const lc = traceLineCount(trace);
        if (lc > 0)
          process.stdout.write(`  ${DIM}raw trace hidden (${lc} lines) — /last-trace to inspect · /trace to always show${R}\n\n`);
      }
    } catch (err) {
      process.stdout.write(`\n  ${RED}error:${R} ${(err as Error).message}\n\n`);
    } finally {
      busy = false;
    }
    rl.prompt();
  });

  rl.on('close', () => {
    process.stdout.write(`\n  ${DIM}bye.${R}\n\n`);
    process.exit(0);
  });
}

function writeChunk(writer: WriteFn, text: string): void { writer(text); }

main().catch((err) => {
  process.stderr.write(`\nFATAL: ${(err as Error).message}\n`);
  process.exit(1);
});
