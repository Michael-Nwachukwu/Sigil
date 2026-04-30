/**
 * Sigil demo — AuditAgent.
 *
 * Real autonomous agent. Given a Solidity contract (name + source), it:
 *   1. Sends the source to 0G Compute (qwen-2.5-7b-instruct) with a
 *      structured-output prompt asking for security findings.
 *   2. Parses + schema-checks the JSON response (overall severity + up to N
 *      findings, each with severity/category/description/lines).
 *   3. Notarizes the JSON output via Sigil ProvenanceNotary, anchoring the
 *      sealed-inference proof + input-context hash on 0G Chain. The signed
 *      input context contains the contract name, source, and prompt — so a
 *      verifier can re-run the model on the same source and reason about
 *      whether the auditor was honest.
 *
 * No mocks (Anti-Hallucination Rule 3): every external call hits a real
 * network. If 0G Compute or 0G Storage is down, the agent errors instead of
 * faking findings.
 *
 * Same dual-wallet split as RiskScorerAgent: `sigil` is agent-signed (used
 * for notarize), `compute` is principal-signed (funds inference). The 0G
 * broker keys ledgers per-signer with a 3 OG minimum; agents only hold
 * gas money for notarize.
 */

import {
  ArtifactType,
  ZeroGComputeAdapter,
  type PassportId,
  type SigilClient,
  type NotarizeResult,
  type SealedInferenceReceipt,
} from 'sigil-protocol';

/** Severity levels the model is asked to use. Order matters — used for `max`. */
export const SEVERITIES = ['none', 'low', 'medium', 'high', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface AuditFinding {
  severity: Severity;
  /** Free-text bucket: "reentrancy", "access control", "arithmetic", etc. */
  category: string;
  /** One- or two-sentence description of the issue. */
  description: string;
  /** Optional line range (e.g., "12-18") if the model can localize it. */
  lines: string | null;
}

export interface AuditReport {
  summary: string;
  overallSeverity: Severity;
  findings: AuditFinding[];
}

export interface AuditAssessment {
  /** Echo of the input — name + size, NOT the full source (logs stay small). */
  input: { name: string; sourceBytes: number };
  report: AuditReport;
  /** Raw model output (the JSON string). */
  rawOutput: string;
  receipt: SealedInferenceReceipt;
  /** TEE verification result from `processResponse`. */
  verified: boolean | null;
  notarized: NotarizeResult;
}

export interface AuditAgentConfig {
  /** Sigil client built with the AGENT wallet (msg.sender for notarize). */
  sigil: SigilClient;
  /** Compute adapter funded by the principal. See RiskScorerAgent for why. */
  compute: ZeroGComputeAdapter;
  passportId: PassportId;
  model?: string;
  /** Token budget for the audit response. Default 600 — fits 3-5 findings. */
  maxTokens?: number;
}

/** Hard cap on source size we'll send to the model. ~16K char ≈ 4K tokens. */
const MAX_SOURCE_CHARS = 16_000;

export class AuditAgent {
  constructor(private readonly config: AuditAgentConfig) {}

  async auditContract(params: { name: string; source: string }): Promise<AuditAssessment> {
    if (!params?.name) throw new Error('AuditAgent.auditContract: name required');
    if (!params.source || !params.source.trim()) {
      throw new Error('AuditAgent.auditContract: source must be non-empty');
    }
    if (params.source.length > MAX_SOURCE_CHARS) {
      throw new Error(
        `AuditAgent.auditContract: source too large (${params.source.length} > ${MAX_SOURCE_CHARS} chars). Trim before submitting.`,
      );
    }

    const prompt = buildPrompt(params);
    const result = await this.config.compute.runSealedInference({
      model: this.config.model,
      messages: prompt,
      maxTokens: this.config.maxTokens ?? 600,
      temperature: 0,
    });

    const report = parseAuditJson(result.output);

    // Bytes anchored on-chain. Includes name + full source + prompt so a
    // verifier can re-run the model and reason about findings consistency.
    const inputContext = JSON.stringify({
      schema: 'sigil.audit-agent-input/1',
      name: params.name,
      source: params.source,
      prompt,
    });

    const notarized = await this.config.sigil.provenance.notarize({
      passportId: this.config.passportId,
      inferenceReceipt: result.receipt,
      inputContext,
      output: result.output,
      artifactType: ArtifactType.CODE_AUDIT,
    });

    return {
      input: { name: params.name, sourceBytes: Buffer.byteLength(params.source, 'utf8') },
      report,
      rawOutput: result.output,
      receipt: result.receipt,
      verified: result.verified,
      notarized,
    };
  }
}

function buildPrompt(params: { name: string; source: string }) {
  const system = `You are a deterministic Solidity security auditor. Read the contract and return ONLY a single JSON object with these exact keys and types — no prose outside the JSON, no markdown fences:
{
  "summary": string (≤200 chars overview),
  "overallSeverity": one of "none" | "low" | "medium" | "high" | "critical",
  "findings": [
    {
      "severity": one of "none" | "low" | "medium" | "high" | "critical",
      "category": string (e.g. "reentrancy", "access-control", "arithmetic", "denial-of-service", "front-running"),
      "description": string (≤300 chars),
      "lines": string or null (e.g. "12-18" if localizable, else null)
    }
  ]
}
Return at most 5 findings. If the contract appears safe, return findings=[] and overallSeverity="none". Only flag real issues — do not invent vulnerabilities. Focus on common patterns: reentrancy, missing access control, integer issues, unchecked external calls, denial-of-service, oracle manipulation, front-running.`;

  const user = `Contract name: ${params.name}

Source:
\`\`\`solidity
${params.source}
\`\`\`

Audit this contract. Return JSON only.`;

  return [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: user },
  ];
}

function parseAuditJson(raw: string): AuditReport {
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
      `AuditAgent: model output is not valid JSON: ${(err as Error).message}\nraw=${raw.slice(0, 400)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`AuditAgent: model output not an object: ${raw.slice(0, 200)}`);
  }
  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj.summary === 'string' ? obj.summary : '';
  const overallSeverity = coerceSeverity(obj.overallSeverity, 'overallSeverity');
  const findingsRaw = Array.isArray(obj.findings) ? obj.findings : [];
  const findings: AuditFinding[] = findingsRaw.map((f, i) => {
    if (!f || typeof f !== 'object') {
      throw new Error(`AuditAgent: findings[${i}] is not an object`);
    }
    const fo = f as Record<string, unknown>;
    return {
      severity: coerceSeverity(fo.severity, `findings[${i}].severity`),
      category: typeof fo.category === 'string' && fo.category ? fo.category : 'uncategorized',
      description:
        typeof fo.description === 'string' && fo.description
          ? fo.description
          : '(no description)',
      lines:
        typeof fo.lines === 'string' && fo.lines.trim() ? fo.lines.trim() : null,
    };
  });
  if (!summary) {
    throw new Error('AuditAgent: model output missing summary');
  }
  return { summary, overallSeverity, findings };
}

function coerceSeverity(value: unknown, label: string): Severity {
  const v = String(value ?? '').toLowerCase();
  if ((SEVERITIES as readonly string[]).includes(v)) {
    return v as Severity;
  }
  throw new Error(
    `AuditAgent: invalid ${label}="${value}" (must be one of ${SEVERITIES.join('|')})`,
  );
}

/**
 * Built-in fixtures — real, well-known vulnerable patterns. Used by the demo
 * runner when no `--file` is provided. Each one is small enough to fit in the
 * model's context with room for a structured response.
 */
export const AUDIT_FIXTURES: Record<string, { name: string; source: string }> = {
  'vault-reentrancy': {
    name: 'Vault.sol (textbook reentrancy)',
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Naive ETH vault. Looks innocent at first glance.
contract Vault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external {
        uint256 bal = balances[msg.sender];
        require(bal > 0, "no balance");
        // External call BEFORE state update — classic reentrancy.
        (bool ok, ) = msg.sender.call{value: bal}("");
        require(ok, "send failed");
        balances[msg.sender] = 0;
    }

    function totalBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
`,
  },
  'unchecked-owner': {
    name: 'TokenSink.sol (missing access control)',
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address who) external view returns (uint256);
}

/// "Treasury" that lets the owner withdraw deposited tokens.
contract TokenSink {
    address public owner;
    IERC20 public token;

    constructor(IERC20 _token) {
        owner = msg.sender;
        token = _token;
    }

    function setOwner(address newOwner) external {
        // BUG: no onlyOwner check — anyone can become owner.
        owner = newOwner;
    }

    function sweep(address to, uint256 amount) external {
        require(msg.sender == owner, "not owner");
        token.transfer(to, amount);
    }
}
`,
  },
  'safe-counter': {
    name: 'Counter.sol (clean reference contract)',
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// Trivial counter — no external calls, no funds, no access control matters.
/// Included as a "safe" reference so the auditor doesn't always cry wolf.
contract Counter {
    uint256 public count;

    function increment() external {
        unchecked { count = count + 1; }
    }

    function value() external view returns (uint256) {
        return count;
    }
}
`,
  },
};
