/**
 * Sigil demo — PromptAgent.
 *
 * Generic, free-form LLM agent. Where RiskScorerAgent and AuditAgent encapsulate
 * a fixed system prompt + a structured-output schema as part of their identity,
 * PromptAgent is the opposite: it accepts ANY system + user prompt at call time
 * and notarizes whatever the model returns. The output may be free-form text
 * or, optionally, JSON (in which case we still parse-check it for log clarity
 * but do NOT enforce a schema).
 *
 * Why this exists. The structured agents prove "Sigil works for deterministic
 * oracle-style agents." This one proves the larger claim: "Sigil works for
 * arbitrary agent shapes." That matters because Phase 5b (SKILL.md + MCP
 * onboarding) is going to attract pre-existing agents that already have their
 * own prompts and schemas. Sigil cannot dictate prompt structure to them — it
 * has to ride along on whatever they're already doing. PromptAgent is the
 * canonical reference for that integration shape.
 *
 * Same dual-wallet split as the other two agents:
 *   - `sigil`   — agent-signed, used for `provenance.notarize()`.
 *   - `compute` — principal-signed, funds inference (3 OG broker minimum).
 *
 * What lands on-chain. The full system prompt, full user prompt, model name,
 * maxTokens, temperature — all bundled into the signed `inputContext` and
 * anchored via 0G Storage. A verifier with the same model can re-run the
 * exact prompt and reason about whether the output is consistent.
 */

import {
  ArtifactType,
  ZeroGComputeAdapter,
  type PassportId,
  type SigilClient,
  type NotarizeResult,
  type SealedInferenceReceipt,
} from 'sigil-protocol';

export interface PromptInput {
  /** Short identifier for this run — shows up in logs + as a label in inputContext. */
  name: string;
  /** The system message — defines the agent's role / constraints. */
  systemPrompt: string;
  /** The user message — the actual question / task. */
  userPrompt: string;
  /**
   * If true, the model output is parsed as JSON for log presentation. We do
   * NOT enforce any schema beyond `JSON.parse` succeeding; this is for caller
   * convenience. Default false.
   */
  expectJson?: boolean;
  /** Token budget. Default 600 (fits a paragraph or a small JSON object). */
  maxTokens?: number;
  /**
   * Sampling temperature. Default 0 (deterministic) so re-runs of the same
   * prompt produce the same output, which makes verifier replay meaningful.
   */
  temperature?: number;
}

export interface PromptAssessment {
  input: {
    name: string;
    systemBytes: number;
    userBytes: number;
    maxTokens: number;
    temperature: number;
  };
  /** Raw model output (string). */
  output: string;
  /** If `expectJson` was true and parsing succeeded, the parsed value. Else null. */
  parsedJson: unknown | null;
  receipt: SealedInferenceReceipt;
  /** TEE verification result from `processResponse`. */
  verified: boolean | null;
  notarized: NotarizeResult;
}

export interface PromptAgentConfig {
  /** Sigil client built with the AGENT wallet (msg.sender for notarize). */
  sigil: SigilClient;
  /** Compute adapter funded by the principal. See RiskScorerAgent for why. */
  compute: ZeroGComputeAdapter;
  passportId: PassportId;
  model?: string;
}

/** Hard cap on combined system+user prompt size. ~24K char ≈ 6K tokens. */
const MAX_PROMPT_CHARS = 24_000;

export class PromptAgent {
  constructor(private readonly config: PromptAgentConfig) {}

  async runPrompt(input: PromptInput): Promise<PromptAssessment> {
    if (!input?.name) throw new Error('PromptAgent.runPrompt: name required');
    if (!input.systemPrompt || !input.systemPrompt.trim()) {
      throw new Error('PromptAgent.runPrompt: systemPrompt must be non-empty');
    }
    if (!input.userPrompt || !input.userPrompt.trim()) {
      throw new Error('PromptAgent.runPrompt: userPrompt must be non-empty');
    }
    const totalChars = input.systemPrompt.length + input.userPrompt.length;
    if (totalChars > MAX_PROMPT_CHARS) {
      throw new Error(
        `PromptAgent.runPrompt: combined prompt too large (${totalChars} > ${MAX_PROMPT_CHARS} chars). Trim before submitting.`,
      );
    }

    const maxTokens = input.maxTokens ?? 600;
    const temperature = input.temperature ?? 0;

    const messages = [
      { role: 'system' as const, content: input.systemPrompt },
      { role: 'user' as const, content: input.userPrompt },
    ];

    const result = await this.config.compute.runSealedInference({
      model: this.config.model,
      messages,
      maxTokens,
      temperature,
    });

    // Optional JSON parse — non-fatal. If the agent claimed it'd return JSON
    // and didn't, we still notarize the raw output and surface the parse
    // failure to the caller via parsedJson=null.
    let parsedJson: unknown | null = null;
    if (input.expectJson) {
      try {
        const cleaned = result.output
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
        parsedJson = JSON.parse(cleaned);
      } catch {
        parsedJson = null;
      }
    }

    // Bytes anchored on-chain. Includes the full prompt, sampling params, and
    // the model name. A verifier can re-run with the same inputs and check
    // whether the output is reproducible (modulo provider drift).
    const inputContext = JSON.stringify({
      schema: 'sigil.prompt-agent-input/1',
      name: input.name,
      model: this.config.model ?? null,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      maxTokens,
      temperature,
      expectJson: input.expectJson ?? false,
    });

    const notarized = await this.config.sigil.provenance.notarize({
      passportId: this.config.passportId,
      inferenceReceipt: result.receipt,
      inputContext,
      output: result.output,
      artifactType: ArtifactType.GENERIC_REPORT,
    });

    return {
      input: {
        name: input.name,
        systemBytes: Buffer.byteLength(input.systemPrompt, 'utf8'),
        userBytes: Buffer.byteLength(input.userPrompt, 'utf8'),
        maxTokens,
        temperature,
      },
      output: result.output,
      parsedJson,
      receipt: result.receipt,
      verified: result.verified,
      notarized,
    };
  }
}

/**
 * Built-in fixtures for the demo runner. Each one is a complete
 * `PromptInput` minus the `name` (the runner sets that). They're picked so
 * the model produces something visibly different per fixture, which makes
 * the demo footage interesting without needing user-typed prompts.
 */
export const PROMPT_FIXTURES: Record<string, Omit<PromptInput, 'name'> & { displayName: string }> =
  {
    'solidity-explainer': {
      displayName: 'Plain-English Solidity explainer (Vault.sol)',
      systemPrompt:
        'You are a senior smart-contract engineer. Explain Solidity code to a non-technical audience in plain English. Keep your answer under 6 sentences. Do not include code in your answer. No markdown headings.',
      userPrompt: `Explain what this contract does and what could go wrong:

\`\`\`solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Vault {
    mapping(address => uint256) public balances;
    function deposit() external payable { balances[msg.sender] += msg.value; }
    function withdraw() external {
        uint256 bal = balances[msg.sender];
        require(bal > 0, "no balance");
        (bool ok, ) = msg.sender.call{value: bal}("");
        require(ok, "send failed");
        balances[msg.sender] = 0;
    }
}
\`\`\``,
    },
    haiku: {
      displayName: 'Haiku poet',
      systemPrompt:
        'You are a haiku poet. Output exactly one haiku (5-7-5 syllables, three lines). Output the haiku and nothing else — no commentary, no preface, no explanation, no quotation marks.',
      userPrompt: 'Write a haiku about smart contract reentrancy.',
    },
    summarizer: {
      displayName: 'Two-sentence summarizer (Sigil pitch)',
      systemPrompt:
        'You are a technical writer. Summarize the user-provided text in exactly two sentences. Plain prose, no bullet points.',
      userPrompt:
        "Sigil is identity and provenance infrastructure for autonomous AI agents on 0G. It uses ERC-7857 iNFTs to give each agent a portable, on-chain passport, anchors every consequential AI output via 0G Compute's sealed-inference receipts, and exposes a verifiable execution log so agents accumulate reputation. The protocol is designed so that pre-existing agents — built on any framework, with any prompt structure — can self-onboard and have their outputs cryptographically tied back to a human principal who authorized them once at registration time.",
    },
  };
