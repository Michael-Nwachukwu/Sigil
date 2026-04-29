/**
 * Sigil demo — RiskScorerAgent.
 *
 * Real autonomous agent. Given a DefiLlama protocol slug:
 *   1. Fetches the protocol's current metrics from the public DefiLlama API
 *      (TVL, per-chain breakdown, 1d/7d/30d change, mcap). DefiLlama derives
 *      these from on-chain reads against the protocol's deployed contracts —
 *      the agent treats the API response as the canonical input bytes.
 *   2. Calls 0G Compute sealed inference (qwen-2.5-7b-instruct) with the
 *      metrics as context, asking for a JSON risk score.
 *   3. Notarizes the JSON output via Sigil ProvenanceNotary, anchoring the
 *      sealed-inference proof + input-context hash on 0G Chain.
 *
 * The `inputContext` we sign over includes the DefiLlama snapshot and the
 * exact prompt — a verifier can later re-fetch DefiLlama (caveat: TVL drifts
 * over time) and re-run the model to confirm the agent didn't fabricate
 * inputs. The TEE-backed `verified=true` on the receipt is the cryptographic
 * binding between input + output for THIS specific run.
 *
 * No mocks (Anti-Hallucination Rule 3): every external call hits a real
 * network. If DefiLlama is down, the agent errors out instead of inventing
 * data.
 */

import {
  ArtifactType,
  ZeroGComputeAdapter,
  type PassportId,
  type SigilClient,
  type NotarizeResult,
  type SealedInferenceReceipt,
} from 'sigil-protocol';

const DEFILLAMA_BASE = 'https://api.llama.fi';
const FETCH_TIMEOUT_MS = 30_000;

export interface ProtocolMetrics {
  /** DefiLlama slug (e.g., "aave-v3", "compound-v3", "lido"). */
  slug: string;
  /** Display name from DefiLlama. */
  name: string;
  /** Category — "Lending", "Liquid Staking", etc. */
  category: string | null;
  /** Current total TVL in USD across all chains. */
  currentTvlUsd: number;
  /** Per-chain TVL breakdown (top 6, sorted descending). */
  chainTvl: Array<{ chain: string; tvlUsd: number }>;
  /** Percentage TVL change. */
  change_1d: number | null;
  change_7d: number | null;
  change_30d: number | null;
  /** Market cap in USD if DefiLlama has it. */
  mcapUsd: number | null;
  /** Where the protocol is deployed. */
  chains: string[];
  /** Audit count (DefiLlama's `audits` field — 0–3 scale, sometimes string). */
  audits: string | null;
  /** ISO timestamp of fetch — bound into the signed input context. */
  fetchedAt: string;
}

export interface RiskScore {
  /** [0, 1]. 0 = trivial risk, 1 = catastrophic. */
  riskScore: number;
  /** [0, 1]. Model's self-reported confidence. */
  confidence: number;
  /** Free-text justification from the model. */
  reasoning: string;
}

export interface RiskAssessment {
  metrics: ProtocolMetrics;
  score: RiskScore;
  /** Raw model output (the JSON string the model produced). */
  rawOutput: string;
  /** Sealed inference receipt from 0G Compute. */
  receipt: SealedInferenceReceipt;
  /** TEE verification result from `processResponse`. */
  verified: boolean | null;
  /** On-chain provenance record. */
  notarized: NotarizeResult;
}

export interface RiskScorerAgentConfig {
  /**
   * Sigil client built with the AGENT wallet (msg.sender for notarize).
   * Used for `provenance.notarize()`. The compute adapter on this client is
   * NOT used — see `compute` below.
   */
  sigil: SigilClient;
  /**
   * Compute adapter funded by the PRINCIPAL wallet (or another payer). The
   * 0G broker keys ledgers per-signer and enforces a 3 OG minimum, so we do
   * NOT bill inference to the agent (which only holds gas-money for
   * notarize). See CLAUDE.md "dual wallet model" + ZeroGComputeAdapter
   * docstring: "The principal funds inference; agents do NOT need their
   * own ledger."
   */
  compute: ZeroGComputeAdapter;
  /** Passport this agent is registered under. */
  passportId: PassportId;
  /** Override compute model. Defaults to client config (`qwen/qwen-2.5-7b-instruct`). */
  model?: string;
}

export class RiskScorerAgent {
  constructor(private readonly config: RiskScorerAgentConfig) {}

  async scoreProtocol(slug: string): Promise<RiskAssessment> {
    if (!slug) throw new Error('RiskScorerAgent.scoreProtocol: slug required');

    const metrics = await fetchProtocolMetrics(slug);
    const prompt = buildPrompt(metrics);

    const result = await this.config.compute.runSealedInference({
      model: this.config.model,
      messages: prompt,
      maxTokens: 220,
      temperature: 0,
    });

    const score = parseRiskJson(result.output);

    // The bytes we anchor on-chain. Includes the prompt + the DefiLlama
    // snapshot, so a verifier can re-derive the LLM's exact view of the
    // world at scoring time.
    const inputContext = JSON.stringify({
      schema: 'sigil.risk-scorer-input/1',
      prompt,
      metrics,
    });

    const notarized = await this.config.sigil.provenance.notarize({
      passportId: this.config.passportId,
      inferenceReceipt: result.receipt,
      inputContext,
      output: result.output,
      artifactType: ArtifactType.RISK_ASSESSMENT,
    });

    return {
      metrics,
      score,
      rawOutput: result.output,
      receipt: result.receipt,
      verified: result.verified,
      notarized,
    };
  }
}

async function fetchProtocolMetrics(slug: string): Promise<ProtocolMetrics> {
  const url = `${DEFILLAMA_BASE}/protocol/${encodeURIComponent(slug)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `DefiLlama HTTP ${res.status} for slug "${slug}": ${text.slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as DefiLlamaProtocolResponse;
  if (!body || !body.name) {
    throw new Error(`DefiLlama returned no protocol for slug "${slug}"`);
  }

  const chainTvl = Object.entries(body.currentChainTvls ?? {})
    .filter(([chain]) => !chain.includes('-')) // skip "<chain>-borrowed", "<chain>-staking" etc.
    .map(([chain, tvl]) => ({ chain, tvlUsd: Number(tvl) }))
    .sort((a, b) => b.tvlUsd - a.tvlUsd)
    .slice(0, 6);
  const currentTvlUsd = chainTvl.reduce((sum, c) => sum + c.tvlUsd, 0);

  return {
    slug,
    name: body.name,
    category: body.category ?? null,
    currentTvlUsd,
    chainTvl,
    change_1d: body.change_1d ?? null,
    change_7d: body.change_7d ?? null,
    change_30d: body.change_30d ?? null,
    mcapUsd: body.mcap ?? null,
    chains: Array.isArray(body.chains) ? body.chains.slice(0, 12) : [],
    audits: body.audits != null ? String(body.audits) : null,
    fetchedAt: new Date().toISOString(),
  };
}

function buildPrompt(metrics: ProtocolMetrics) {
  const system = `You are a deterministic DeFi risk scoring oracle. Analyze the protocol metrics provided and return ONLY a single JSON object with these exact keys and types:
{"riskScore": number in [0,1], "confidence": number in [0,1], "reasoning": string}
No prose outside the JSON. No markdown fences. riskScore higher = more risk.
Consider: TVL magnitude, recent TVL change (sharp drops are risk signals), chain concentration (single-chain = higher risk), audit count, category-specific norms.`;

  const user = `Protocol: ${metrics.name} (slug=${metrics.slug})
Category: ${metrics.category ?? 'unknown'}
Current TVL: $${formatUsd(metrics.currentTvlUsd)}
TVL change: 1d=${formatPct(metrics.change_1d)} 7d=${formatPct(metrics.change_7d)} 30d=${formatPct(metrics.change_30d)}
Market cap: ${metrics.mcapUsd != null ? '$' + formatUsd(metrics.mcapUsd) : 'n/a'}
Chains (top 6 by TVL): ${metrics.chainTvl.map((c) => `${c.chain}=$${formatUsd(c.tvlUsd)}`).join(', ')}
Deployed on: ${metrics.chains.join(', ') || 'n/a'}
Audits reported: ${metrics.audits ?? 'n/a'}

Score this protocol's risk for a depositor today. Be terse — under 60 words in reasoning.`;

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

function parseRiskJson(raw: string): RiskScore {
  // Models occasionally wrap JSON in ```json fences despite instructions.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `RiskScorerAgent: model output is not valid JSON: ${(err as Error).message}\nraw=${raw.slice(0, 300)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`RiskScorerAgent: model output not an object: ${raw.slice(0, 200)}`);
  }
  const obj = parsed as Record<string, unknown>;
  const riskScore = Number(obj.riskScore);
  const confidence = Number(obj.confidence);
  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';
  if (!isFiniteIn01(riskScore) || !isFiniteIn01(confidence) || !reasoning) {
    throw new Error(
      `RiskScorerAgent: model output failed schema check (riskScore=${obj.riskScore}, confidence=${obj.confidence}, reasoning length=${reasoning.length})`,
    );
  }
  return { riskScore, confidence, reasoning };
}

function isFiniteIn01(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

function formatPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return 'n/a';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

interface DefiLlamaProtocolResponse {
  name?: string;
  category?: string;
  currentChainTvls?: Record<string, number>;
  change_1d?: number;
  change_7d?: number;
  change_30d?: number;
  mcap?: number;
  chains?: string[];
  audits?: number | string;
}
