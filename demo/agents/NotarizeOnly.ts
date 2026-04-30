/**
 * Sigil demo — NotarizeOnly adapter.
 *
 * Thinnest possible Sigil integration. The agent runs its own LLM (OpenAI,
 * Anthropic, local Llama, whatever) and just hands Sigil:
 *   - the model name it used
 *   - the system + user prompts it sent
 *   - the output the model returned
 *   - (optionally) a real 0G Compute sealed-inference receipt
 *
 * Sigil notarizes it as a ProvenanceRecord under the agent's passport.
 *
 * Two paths:
 *
 *   A. SEALED — caller passes a real `SealedInferenceReceipt` from 0G Compute.
 *      Output is cryptographically bound to the model via TEE attestation.
 *      `verified: true` flows through to the on-chain proof envelope.
 *
 *   B. UNSEALED — caller passes no receipt. We synthesize an unsealed
 *      attestation receipt that includes the model name + input/output hashes
 *      but explicitly marks `verified: false` and `proofType: "unsealed"`.
 *      The agent's signature is still on the notarization tx, so the
 *      accountability chain (output → agent → principal) holds. What we
 *      lose: the cryptographic binding between input and output. A verifier
 *      sees "this agent CLAIMS its model produced this output" instead of
 *      "the TEE PROVED its model produced this output."
 *
 * Why we expose both. Most existing agents in the wild don't run on TEE
 * infra. If Sigil only supports sealed inference, those agents can't
 * onboard. With unsealed attestations they get accountability-as-default
 * (signed by the agent, traceable to the principal) and can upgrade to
 * sealed when they migrate inference to 0G Compute.
 *
 * The on-chain ProvenanceRecord contract doesn't distinguish sealed vs.
 * unsealed — it just stores `modelFingerprintHash = keccak256(proof)`. The
 * distinction lives in the proof envelope on 0G Storage. Verifiers MUST
 * fetch the envelope and check the `verified` field before trusting the
 * model-output binding.
 */

import { keccak256, toUtf8Bytes } from 'ethers';
import {
  ArtifactType,
  type PassportId,
  type SigilClient,
  type NotarizeResult,
  type SealedInferenceReceipt,
} from 'sigil-protocol';

export interface ExternalNotarizationInput {
  /** Short label for this run — surfaces in inputContext + logs. */
  name: string;
  /** What model produced the output (e.g. 'gpt-4o', 'claude-sonnet-4', 'llama-3.1-8b'). */
  modelId: string;
  /** System prompt the agent used (the role/constraint message). */
  systemPrompt: string;
  /** User prompt the agent used (the actual question/task). */
  userPrompt: string;
  /** The string the model returned. */
  output: string;
  /** Defaults to GENERIC_REPORT. */
  artifactType?: ArtifactType;
  /**
   * Optional: a real sealed-inference receipt from 0G Compute. If present,
   * we skip synthesis and pass it through — TEE verification flows
   * end-to-end.
   */
  inferenceReceipt?: SealedInferenceReceipt;
  /**
   * Optional: arbitrary extra metadata bundled into the inputContext (e.g.
   * `{ provider: 'openai', framework: 'langchain' }`). Goes on 0G Storage,
   * NOT on-chain — keep it small.
   */
  extra?: Record<string, unknown>;
}

export interface NotarizeOnlyResult {
  notarized: NotarizeResult;
  /** 'sealed' if the caller supplied a 0G receipt; 'unsealed' if we synthesized one. */
  receiptKind: 'sealed' | 'unsealed';
  /** Echoed for log convenience. */
  modelId: string;
}

export interface NotarizeOnlyConfig {
  /** Sigil client built with the AGENT wallet (msg.sender for notarize). */
  sigil: SigilClient;
  passportId: PassportId;
}

/** Hard cap on combined system+user prompt size. ~24K char ≈ 6K tokens. */
const MAX_PROMPT_CHARS = 24_000;
/** Output cap. Larger than the prompt cap because models sometimes produce long reports. */
const MAX_OUTPUT_CHARS = 32_000;

export class NotarizeOnlyAdapter {
  constructor(private readonly config: NotarizeOnlyConfig) {}

  async notarizeExternalOutput(input: ExternalNotarizationInput): Promise<NotarizeOnlyResult> {
    validateInput(input);

    const receipt: SealedInferenceReceipt =
      input.inferenceReceipt ?? buildUnsealedReceipt(input);
    const receiptKind: 'sealed' | 'unsealed' = input.inferenceReceipt ? 'sealed' : 'unsealed';

    // The bytes anchored on-chain. We bundle the full prompt + model name +
    // receipt kind so a verifier can re-derive what the agent claimed it did.
    // The `extra` field is opaque to Sigil — caller-controlled.
    const inputContext = JSON.stringify({
      schema: 'sigil.notarize-only-input/1',
      name: input.name,
      modelId: input.modelId,
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      receiptKind,
      extra: input.extra ?? null,
    });

    const notarized = await this.config.sigil.provenance.notarize({
      passportId: this.config.passportId,
      inferenceReceipt: receipt,
      inputContext,
      output: input.output,
      artifactType: input.artifactType ?? ArtifactType.GENERIC_REPORT,
    });

    return { notarized, receiptKind, modelId: input.modelId };
  }
}

/**
 * One-shot helper for callers who don't want to instantiate a class. Same
 * behaviour as `NotarizeOnlyAdapter.notarizeExternalOutput`.
 */
export async function notarizeExternalOutput(
  params: NotarizeOnlyConfig & ExternalNotarizationInput,
): Promise<NotarizeOnlyResult> {
  const adapter = new NotarizeOnlyAdapter({
    sigil: params.sigil,
    passportId: params.passportId,
  });
  return adapter.notarizeExternalOutput(params);
}

function validateInput(input: ExternalNotarizationInput): void {
  if (!input?.name) throw new Error('NotarizeOnly: name required');
  if (!input.modelId || !input.modelId.trim()) {
    throw new Error('NotarizeOnly: modelId required');
  }
  if (!input.systemPrompt || !input.systemPrompt.trim()) {
    throw new Error('NotarizeOnly: systemPrompt must be non-empty');
  }
  if (!input.userPrompt || !input.userPrompt.trim()) {
    throw new Error('NotarizeOnly: userPrompt must be non-empty');
  }
  if (!input.output || !input.output.trim()) {
    throw new Error('NotarizeOnly: output must be non-empty');
  }
  const promptChars = input.systemPrompt.length + input.userPrompt.length;
  if (promptChars > MAX_PROMPT_CHARS) {
    throw new Error(
      `NotarizeOnly: combined prompt too large (${promptChars} > ${MAX_PROMPT_CHARS} chars)`,
    );
  }
  if (input.output.length > MAX_OUTPUT_CHARS) {
    throw new Error(
      `NotarizeOnly: output too large (${input.output.length} > ${MAX_OUTPUT_CHARS} chars)`,
    );
  }
}

/**
 * Build a synthesized "unsealed" receipt for callers who don't have a 0G
 * Compute receipt. The structure mirrors a real sealed receipt's shape but
 * the `proof` field is a self-describing JSON envelope with explicit
 * `verified: false` marker and `proofType: "unsealed-external"`.
 *
 * Verifiers MUST inspect the proof envelope (downloaded from 0G Storage via
 * the proofRootHash returned by notarize) before trusting the model→output
 * binding. The on-chain record alone cannot distinguish sealed from unsealed.
 */
function buildUnsealedReceipt(input: ExternalNotarizationInput): SealedInferenceReceipt {
  const inputBytes = toUtf8Bytes(`${input.systemPrompt}\n---\n${input.userPrompt}`);
  const outputBytes = toUtf8Bytes(input.output);
  const inputHash = keccak256(inputBytes);
  const outputHash = keccak256(outputBytes);
  const timestamp = Math.floor(Date.now() / 1000);

  const proofEnvelope = {
    schema: 'sigil.unsealed-attestation/1',
    proofType: 'unsealed-external',
    verified: false,
    modelId: input.modelId,
    inputHash,
    outputHash,
    timestamp,
    notice:
      'This output was NOT produced via 0G Compute sealed inference. The agent attests to the model + input + output, but no TEE proof binds them. Verify upstream model trust separately.',
  };

  return {
    modelId: input.modelId,
    modelVersionHash: '0x' + '0'.repeat(64), // unknown — not provable for external models
    inputHash,
    outputHash,
    proof: JSON.stringify(proofEnvelope),
    timestamp,
  };
}
