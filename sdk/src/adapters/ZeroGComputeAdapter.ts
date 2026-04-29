/**
 * Sigil Protocol — 0G Compute adapter (sealed inference).
 *
 * Wraps `@0glabs/0g-serving-broker` for verifiable TEE-backed inference. The
 * sealed receipt produced here is the CORE of every Provenance record — we
 * keep the full envelope (provider address, chatID, TEE verification result,
 * input/output hashes) and store its keccak256 as `modelFingerprintHash`
 * on-chain. The full envelope itself goes to 0G Storage so consumers can
 * re-verify against the provider's chat-signature endpoint.
 *
 * Flow per `runSealedInference`:
 *   1. Resolve provider address (caller may pin one; otherwise pick the first
 *      acknowledged service whose `model` matches `params.model`).
 *   2. Lazily ensure a ledger exists with min balance (one-time per signer).
 *   3. `acknowledgeProviderSigner` — idempotent TEE attestation handshake.
 *   4. `getServiceMetadata` + `getRequestHeaders` to build a billed request.
 *   5. POST OpenAI-compatible chat completion to the provider endpoint.
 *   6. Extract chatID from the `ZG-Res-Key` response header (fallback: `id`).
 *   7. `processResponse(provider, chatID, content)` → TEE signature check.
 *
 * Anti-Hallucination Rule 3: every call here hits real 0G Compute. No mocks.
 */

import type { JsonRpcSigner, Wallet } from 'ethers';
import { keccak256, toUtf8Bytes } from 'ethers';
import {
  createZGComputeNetworkBroker,
  type ZGComputeNetworkBroker,
} from '@0glabs/0g-serving-broker';
import type { SealedInferenceReceipt } from '../types/index';
import { ZeroGError } from '../utils/errors';
import { logger } from '../utils/logger';

/** Min ledger balance the broker enforces (3 OG, per LedgerProcessor). */
const MIN_LEDGER_OG = 3;

export interface ZeroGComputeAdapterConfig {
  /**
   * Wallet (Node/CLI) or JsonRpcSigner (browser) used to fund the ledger and
   * sign billing headers. The principal funds inference; agents do NOT need
   * their own ledger.
   */
  signer: Wallet | JsonRpcSigner;
  /**
   * Default model id to resolve a provider from when `runSealedInference`'s
   * caller doesn't pin one. Format on-chain is `<vendor>/<name>`, e.g.
   * `qwen/qwen-2.5-7b-instruct`. Verified live on Galileo (Phase 0).
   */
  defaultModel?: string;
  /**
   * Optional pin for a specific provider address. If set, the adapter skips
   * the model→provider lookup and uses this address directly.
   */
  pinnedProvider?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SealedInferenceResult {
  output: string;
  receipt: SealedInferenceReceipt;
  /** Provider address used for the inference, kept for resolve/verify. */
  providerAddress: string;
  /** Provider-issued chat ID — needed if a consumer wants to re-verify. */
  chatID: string;
  /**
   * TEE signature verification result from `processResponse`:
   *   true  — provider's signature recovered to the registered TEE signer
   *   false — verification failed (signature mismatch / replay / etc.)
   *   null  — no chatID returned (provider doesn't include `ZG-Res-Key`)
   */
  verified: boolean | null;
}

export class ZeroGComputeAdapter {
  private brokerPromise: Promise<ZGComputeNetworkBroker> | null = null;
  private acknowledgedProviders = new Set<string>();
  private ledgerEnsured = false;

  constructor(private readonly config: ZeroGComputeAdapterConfig) {
    if (!config.signer) {
      throw new ZeroGError('ZeroGComputeAdapter: signer required');
    }
  }

  private getBroker(): Promise<ZGComputeNetworkBroker> {
    if (!this.brokerPromise) {
      this.brokerPromise = createZGComputeNetworkBroker(this.config.signer);
    }
    return this.brokerPromise;
  }

  /**
   * Idempotent: creates a ledger with min balance if none exists. Subsequent
   * calls in the same process are no-ops. Network failures bubble up.
   */
  private async ensureLedger(broker: ZGComputeNetworkBroker): Promise<void> {
    if (this.ledgerEnsured) return;
    try {
      await broker.ledger.getLedger();
      this.ledgerEnsured = true;
      return;
    } catch {
      // No ledger yet — create one with the broker-enforced minimum.
    }
    logger.info({ minOG: MIN_LEDGER_OG }, '0G Compute: creating ledger');
    await broker.ledger.addLedger(MIN_LEDGER_OG);
    this.ledgerEnsured = true;
  }

  /**
   * Resolve a provider address for a given model id by listing services and
   * matching `model`. Returns the first acknowledged service that matches.
   */
  private async resolveProvider(
    broker: ZGComputeNetworkBroker,
    model: string,
  ): Promise<string> {
    if (this.config.pinnedProvider) return this.config.pinnedProvider;
    const services = await broker.inference.listService();
    const wanted = model.toLowerCase();
    const match = services.find(
      (s) => String(s.model ?? '').toLowerCase() === wanted,
    );
    if (!match) {
      const seen = services.map((s) => s.model).slice(0, 10);
      throw new ZeroGError(
        `no acknowledged provider serves model "${model}"; saw: ${JSON.stringify(seen)}`,
      );
    }
    return match.provider;
  }

  /**
   * One-time per provider: tells the contract this user trusts the provider's
   * registered TEE signer. Cached in memory; the on-chain check is also
   * idempotent so re-running is safe across processes.
   */
  private async acknowledgeOnce(
    broker: ZGComputeNetworkBroker,
    provider: string,
  ): Promise<void> {
    if (this.acknowledgedProviders.has(provider)) return;
    try {
      await broker.inference.acknowledgeProviderSigner(provider);
    } catch (err) {
      // Already-acknowledged is the most common reason this throws — broker
      // doesn't surface a typed error, so we let it through and re-check via
      // the request flow. If something else broke, getRequestHeaders below
      // will fail loudly.
      logger.warn(
        { err, provider },
        'acknowledgeProviderSigner threw (likely already acknowledged)',
      );
    }
    this.acknowledgedProviders.add(provider);
  }

  async runSealedInference(params: {
    model?: string;
    messages: ChatMessage[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<SealedInferenceResult> {
    const model = params.model ?? this.config.defaultModel;
    if (!model) {
      throw new ZeroGError(
        'runSealedInference: model required (pass params.model or set defaultModel)',
      );
    }
    if (!params.messages || params.messages.length === 0) {
      throw new ZeroGError('runSealedInference: messages must be non-empty');
    }

    const broker = await this.getBroker();
    await this.ensureLedger(broker);

    const provider = await this.resolveProvider(broker, model);
    await this.acknowledgeOnce(broker, provider);

    const { endpoint, model: providerModel } =
      await broker.inference.getServiceMetadata(provider);
    const headers = await broker.inference.getRequestHeaders(provider);

    const body: Record<string, unknown> = {
      model: providerModel,
      messages: params.messages,
    };
    if (params.maxTokens != null) body.max_tokens = params.maxTokens;
    if (params.temperature != null) body.temperature = params.temperature;

    const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;
    logger.info({ provider, model: providerModel, url }, '0G Compute: POST chat/completions');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers as unknown as Record<string, string>),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ZeroGError(
        `chat/completions HTTP ${res.status}: ${text.slice(0, 500)}`,
      );
    }

    const chatID = res.headers.get('ZG-Res-Key') ?? undefined;
    const completion = (await res.json()) as {
      id?: string;
      choices?: { message?: { content?: string } }[];
      usage?: unknown;
    };
    const output = completion.choices?.[0]?.message?.content ?? '';
    if (!output) {
      throw new ZeroGError(
        `chat/completions returned empty content; raw=${JSON.stringify(completion).slice(0, 500)}`,
      );
    }
    const effectiveChatID = chatID ?? completion.id ?? '';

    let verified: boolean | null = null;
    try {
      verified = await broker.inference.processResponse(
        provider,
        effectiveChatID || undefined,
        completion.usage ? JSON.stringify(completion.usage) : output,
      );
    } catch (err) {
      logger.error({ err, provider, chatID: effectiveChatID }, 'processResponse failed');
      verified = false;
    }
    logger.info(
      { provider, chatID: effectiveChatID, verified },
      '0G Compute: TEE verification result',
    );

    const inputCanonical = JSON.stringify({ model: providerModel, messages: params.messages });
    const inputHash = keccak256(toUtf8Bytes(inputCanonical));
    const outputHash = keccak256(toUtf8Bytes(output));
    const modelVersionHash = keccak256(
      toUtf8Bytes(`${providerModel}@${provider.toLowerCase()}`),
    );

    const proofEnvelope = {
      schema: 'sigil.sealed-inference/1',
      provider,
      providerModel,
      chatID: effectiveChatID,
      verified,
      inputHash,
      outputHash,
      timestamp: Math.floor(Date.now() / 1000),
    };
    const proof = JSON.stringify(proofEnvelope);

    return {
      output,
      providerAddress: provider,
      chatID: effectiveChatID,
      verified,
      receipt: {
        modelId: providerModel,
        modelVersionHash,
        inputHash,
        outputHash,
        proof,
        timestamp: proofEnvelope.timestamp,
      },
    };
  }

  /**
   * Local-only re-verification. Recomputes outputHash from the provided
   * output and confirms it matches the receipt. Full TEE re-verification
   * (against the provider's chat-signature endpoint) is a deeper check that
   * lives on the consumer side via `getChatSignatureDownloadLink` — we don't
   * round-trip there here because consumers may want to gate that call.
   */
  async verifyReceipt(
    receipt: SealedInferenceReceipt,
    output: string,
  ): Promise<boolean> {
    const computed = keccak256(toUtf8Bytes(output));
    return computed.toLowerCase() === receipt.outputHash.toLowerCase();
  }
}
