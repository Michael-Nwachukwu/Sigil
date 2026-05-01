/**
 * Sigil demo — ChatAgent.
 *
 * Conversational wrapper around the standard "compute → notarize" flow used
 * by the structured demo agents. Each user turn is one sealed-inference call
 * via 0G Compute, followed by one ProvenanceNotary record. Turns are
 * independent — no multi-turn history is replayed — so every reply has a
 * fully self-contained on-chain record (recordId, outputHash, agentSignature).
 *
 * The system prompt embeds the agent's verifiable identity (passportId,
 * agent address, principal). That serves two purposes:
 *   - Natural-language identity questions ("what's your passport id?",
 *     "who runs you?") get answered correctly without any special-casing in
 *     the runner — the agent literally has its credentials in context.
 *   - The answer itself is notarized, so the agent's *claim about itself*
 *     becomes part of its on-chain trail.
 *
 * Same dual-wallet split as RiskScorer/Audit/Prompt:
 *   - `sigil`   — agent-signed, used for `provenance.notarize()`.
 *   - `compute` — principal-signed, funds 0G Compute inference.
 */

import {
  ArtifactType,
  ZeroGComputeAdapter,
  type PassportId,
  type SigilClient,
  type NotarizeResult,
  type SealedInferenceReceipt,
} from 'sigil-protocol';

export interface ChatIdentity {
  passportId: PassportId;
  agentAddress: string;
  principal: string;
  /** Free-text description from the credential file or registration. */
  description?: string;
}

export interface ChatAgentConfig {
  sigil: SigilClient;
  compute: ZeroGComputeAdapter;
  passportId: PassportId;
  identity: ChatIdentity;
  model?: string;
}

export interface ChatTurn {
  output: string;
  receipt: SealedInferenceReceipt;
  /** TEE verification result from `processResponse`. */
  verified: boolean | null;
  notarized: NotarizeResult;
}

export type ChatProgressPhase =
  | 'planning-response'
  | 'running-sealed-inference'
  | 'notarizing-response'
  | 'attesting-response'
  | 'completed';

export interface ChatProgressEvent {
  phase: ChatProgressPhase;
  message: string;
}

export interface ChatAskOptions {
  onProgress?: (event: ChatProgressEvent) => void | Promise<void>;
}

const MAX_USER_CHARS = 8_000;

export function buildChatSystemPrompt(id: ChatIdentity): string {
  const lines = [
    'You are an autonomous agent registered on the Sigil Protocol — an on-chain identity and provenance system on 0G Galileo.',
    '',
    'Your verifiable identity:',
    `  - passportId: ${id.passportId}`,
    `  - agent address (your signer): ${id.agentAddress}`,
    `  - principal (your operator): ${id.principal}`,
  ];
  if (id.description) {
    lines.push(`  - description: ${id.description}`);
  }
  lines.push(
    '',
    'Current runtime capabilities:',
    '  - Answer questions, explain your Sigil identity, and produce notarized replies.',
    '  - Use 0G Compute for sealed inference and sign every final response with your agent wallet.',
    '',
    'Current runtime limitations:',
    '  - You are NOT wired to wallet-transfer tools, contract write tools, trading tools, or arbitrary external APIs in this demo runtime.',
    '  - You cannot actually send OG, move funds, sign transfers, or execute on-chain actions unless the operator explicitly adds those tools and permissions.',
    '',
    'Behaviour:',
    '  - When asked who you are, what your passportId is, who controls you, or any identity question, answer using the values above. Do not invent details.',
    '  - If asked to do something you are not wired for, say clearly that the capability is not attached in this runtime. Then offer the exact steps, permissions, or transaction shape the operator would need.',
    '  - Every reply you produce is signed by your agent wallet and notarized on the ProvenanceNotary contract. Be precise and concise — do not pad.',
    '  - Default to short answers (under 4 sentences). Expand only when explicitly asked.',
    '  - You are stateless across sessions. Do not claim memory of earlier conversations.',
  );
  return lines.join('\n');
}

export class ChatAgent {
  constructor(private readonly config: ChatAgentConfig) {}

  async ask(userText: string, options: ChatAskOptions = {}): Promise<ChatTurn> {
    const text = (userText ?? '').trim();
    if (!text) throw new Error('ChatAgent.ask: userText must be non-empty');
    if (text.length > MAX_USER_CHARS) {
      throw new Error(
        `ChatAgent.ask: prompt too large (${text.length} > ${MAX_USER_CHARS} chars)`,
      );
    }

    await options.onProgress?.({
      phase: 'planning-response',
      message: 'planning response',
    });

    const systemPrompt = buildChatSystemPrompt(this.config.identity);
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: text },
    ];

    await options.onProgress?.({
      phase: 'running-sealed-inference',
      message: 'running sealed inference',
    });

    const result = await this.config.compute.runSealedInference({
      model: this.config.model,
      messages,
      maxTokens: 600,
      temperature: 0,
    });

    const inputContext = JSON.stringify({
      schema: 'sigil.chat-agent-input/1',
      model: this.config.model ?? null,
      systemPrompt,
      userPrompt: text,
      maxTokens: 600,
      temperature: 0,
    });

    await options.onProgress?.({
      phase: 'notarizing-response',
      message: 'notarizing response',
    });

    const notarized = await this.config.sigil.provenance.notarize({
      passportId: this.config.passportId,
      inferenceReceipt: result.receipt,
      inputContext,
      output: result.output,
      artifactType: ArtifactType.GENERIC_REPORT,
    });

    await options.onProgress?.({
      phase: 'completed',
      message: 'response notarized',
    });

    return {
      output: result.output,
      receipt: result.receipt,
      verified: result.verified,
      notarized,
    };
  }
}
