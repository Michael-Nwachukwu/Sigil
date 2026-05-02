import { DocsLayout, H1, H2, H3, P, Lead, Code, CodeBlock, Callout, PropTable } from "../../../components/docs/layout";

export const metadata = { title: "SDK Reference — Sigil Protocol" };

export default function SdkPage() {
  return (
    <DocsLayout>
      <div style={{ fontFamily: "var(--font-mono-src)", fontSize: 11, color: "var(--accent)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
        SDK Reference
      </div>
      <H1>sigil-protocol SDK</H1>
      <Lead>
        TypeScript SDK for registering agent identities and notarizing outputs on 0G. Works in Node.js ≥ 20. Browser-compatible for read-only operations.
      </Lead>

      {/* Installation */}
      <H2 id="install">Installation</H2>
      <CodeBlock lang="bash">
{`pnpm add sigil-protocol ethers
# or
npm install sigil-protocol ethers`}
      </CodeBlock>
      <P>
        The SDK requires <Code>ethers@^6</Code> as a peer dependency. It does not bundle ethers — your project supplies it.
      </P>

      {/* SigilClient */}
      <H2 id="sigil-client">SigilClient</H2>
      <P>
        The main entry point. Wraps all three sub-clients (<Code>passport</Code>, <Code>provenance</Code>, <Code>compute</Code>) and manages the 0G connections.
      </P>
      <CodeBlock lang="typescript">
{`import { SigilClient } from "sigil-protocol";
import { Wallet } from "ethers";

const sigil = new SigilClient({
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  chainId: 16602,
  registryAddress: "0x2C0457F82B57148e8363b4589bb3294b23AE7625",
  notaryAddress: "0xA1103E6490ab174036392EbF5c798C9DaBAb24EE",
  signer: wallet,                             // ethers Wallet or JsonRpcSigner
  storageRpcUrl: "https://indexer-storage-testnet-turbo.0g.ai",
  computeRpcUrl: "https://...",               // 0G Compute endpoint (optional)
  computeDefaultModel: "qwen/qwen-2.5-7b-instruct",
});`}
      </CodeBlock>
      <PropTable
        rows={[
          { name: "rpcUrl", type: "string", required: true, desc: "0G Chain JSON-RPC endpoint" },
          { name: "chainId", type: "number", required: true, desc: "EVM chain ID (16602 for Galileo testnet)" },
          { name: "registryAddress", type: "string", required: true, desc: "SigilRegistry contract address" },
          { name: "notaryAddress", type: "string", required: true, desc: "ProvenanceNotary contract address" },
          { name: "signer", type: "Wallet | JsonRpcSigner", required: true, desc: "Principal wallet for registration, or agent wallet for notarization" },
          { name: "storageRpcUrl", type: "string", desc: "0G Storage indexer URL" },
          { name: "computeRpcUrl", type: "string", desc: "0G Compute broker URL" },
          { name: "computeDefaultModel", type: "string", desc: "Default model ID for sealed inference (e.g. qwen/qwen-2.5-7b-instruct)" },
        ]}
      />

      {/* passport.register */}
      <H2 id="passport">AgentPassport</H2>
      <H3 id="register">register()</H3>
      <P>
        Mints a new AgentPassport. Generates a fresh agent keypair, encrypts the permission manifest with AES-256-GCM (key derived from the principal's EIP-712 signature), uploads ciphertext to 0G Storage, then calls <Code>SigilRegistry.register()</Code> on-chain.
      </P>
      <Callout type="danger">
        The returned <Code>agentPrivateKey</Code> is delivered exactly once. Store it immediately in a secrets manager or env var. Sigil never persists it.
      </Callout>
      <CodeBlock lang="typescript">
{`const result = await sigil.passport.register({
  agentDescription: "DeFi risk scoring agent",
  permissions: {
    whitelistedContracts: ["0x..."],
    maxTxValuePerWindow: { USDC: 5000, ETH: 2 },
    authorizedApis: ["0g.compute", "uniswap.api"],
    allowedTokens: ["USDC", "ETH"],
    timeWindowSeconds: 3600,
  },
  persistAs: "risk-agent",          // optional: saves public metadata to ~/.sigil/credentials/
  credentialContext: {
    notaryAddress: "0x...",
    chainId: 16602,
    rpcUrl: "https://evmrpc-testnet.0g.ai",
  },
});

// result.passportId       — bytes32 on-chain ID
// result.agentAddress     — fresh agent wallet address
// result.agentPrivateKey  — store this once, immediately
// result.manifestRootHash — 0G Storage root hash of encrypted manifest
// result.txHash           — registration transaction hash`}
      </CodeBlock>
      <PropTable
        rows={[
          { name: "agentDescription", type: "string", required: true, desc: "Free-text description ≤ 280 chars. Encrypted in the permission manifest." },
          { name: "permissions", type: "PermissionManifestPlain", required: true, desc: "The agent's scope of authorization. Encrypted before upload." },
          { name: "persistAs", type: "string", desc: "If set, writes a discoverability credential to ~/.sigil/credentials/<name>.json (public metadata only — no private key)." },
          { name: "credentialContext", type: "object", desc: "Metadata added to the credential file: notaryAddress, chainId, rpcUrl." },
          { name: "nonce", type: "bigint", desc: "Optional passportId nonce override. Default: cryptographic random." },
        ]}
      />

      <H3 id="resolve-passport">resolve()</H3>
      <P>Read a PassportRecord from on-chain. Anyone can call this — no authentication required.</P>
      <CodeBlock lang="typescript">
{`const passport = await sigil.passport.resolve(passportId);

passport.passportId             // bytes32
passport.principal              // principal wallet address
passport.agentAddress           // agent wallet address
passport.active                 // false after revokeAgent()
passport.reputationScore        // bigint, 0–1000
passport.taskCount              // number of keeper-attested tasks
passport.failureCount           // number of failed tasks
passport.provenanceRecordCount  // total notarized outputs
passport.executionFingerprintCount`}
      </CodeBlock>

      <H3 id="manifest">getManifest()</H3>
      <P>Decrypt and return the permission manifest. Only succeeds if the configured signer is the principal that registered the passport — the AES-GCM key is derived from the principal's signature.</P>
      <CodeBlock lang="typescript">
{`// signer must be the principal wallet
const manifest = await sigil.passport.getManifest(passportId);

manifest.agentDescription
manifest.permissions.whitelistedContracts
manifest.permissions.authorizedApis`}
      </CodeBlock>

      {/* provenance.notarize */}
      <H2 id="provenance">ProvenanceNotary</H2>
      <H3 id="notarize">notarize()</H3>
      <P>
        Notarize an AI-generated artifact on-chain. The signer must be the registered agent wallet for this passport. The method:
      </P>
      <ol style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 2, paddingLeft: 20, marginBottom: 16 }}>
        <li>Encrypts and uploads the input context to 0G Storage</li>
        <li>Builds a v2 provenance envelope wrapping the sealed receipt and raw output</li>
        <li>Uploads the envelope to 0G Storage</li>
        <li>Signs an EIP-712 typed-data payload</li>
        <li>Calls <Code>ProvenanceNotary.notarize()</Code> on-chain</li>
        <li>Optionally triggers the auto-attest sidecar (reputation update)</li>
      </ol>
      <CodeBlock lang="typescript">
{`const result = await agentSigil.provenance.notarize({
  passportId,
  inferenceReceipt,       // SealedInferenceReceipt from 0G Compute
  inputContext: prompt,   // plaintext — encrypted before upload
  output: response,       // plaintext — hashed on-chain
  artifactType: ArtifactType.GENERIC_REPORT,
});

result.recordId             // bytes32 — permanent record identifier
result.txHash               // on-chain transaction hash
result.outputHash           // keccak256 of the output
result.inputContextHash     // keccak256 of the ciphertext
result.proofRootHash        // 0G Storage root hash of the proof envelope
result.attestation?.txHash  // auto-attest sidecar tx (if configured)`}
      </CodeBlock>
      <PropTable
        rows={[
          { name: "passportId", type: "PassportId", required: true, desc: "The agent's passport identifier (bytes32)" },
          { name: "inferenceReceipt", type: "SealedInferenceReceipt", required: true, desc: "Receipt from ZeroGComputeAdapter.runSealedInference() or a manually constructed receipt" },
          { name: "inputContext", type: "string", required: true, desc: "The input prompt or context. Encrypted with HKDF-derived AES-256-GCM key before upload." },
          { name: "output", type: "string", required: true, desc: "The model output or artifact text. Hashed on-chain; also inlined in the proof envelope." },
          { name: "artifactType", type: "ArtifactType", required: true, desc: "Artifact category enum (CODE_AUDIT, RISK_ASSESSMENT, GENERIC_REPORT, etc.)" },
        ]}
      />

      <H3 id="resolve-record">resolve()</H3>
      <CodeBlock lang="typescript">
{`const record = await sigil.provenance.resolve(recordId);

record.recordId
record.passportId
record.principal    // principal at notarization time
record.agent        // agent wallet address
record.modelId      // e.g. "qwen/qwen-2.5-7b-instruct"
record.outputHash
record.artifactType
record.timestamp`}
      </CodeBlock>

      <H3 id="resolve-full">resolveFull()</H3>
      <P>Resolve on-chain record + download proof envelope from 0G Storage + (optionally) decrypt input context.</P>
      <CodeBlock lang="typescript">
{`const full = await agentSigil.provenance.resolveFull(recordId);

full.record           // on-chain ProvenanceRecord
full.proofEnvelope    // parsed JSON proof envelope from 0G Storage
full.output           // raw output text (v2 envelopes only)
full.envelopeSchema   // "sigil.provenance-envelope/2"
full.inputContext     // decrypted input context (only if signer is the agent)`}
      </CodeBlock>

      <H3 id="verify">verify()</H3>
      <CodeBlock lang="typescript">
{`const { valid, reason } = await sigil.provenance.verify(recordId);
// valid: boolean — signature + hash consistency check
// reason: string — explanation if invalid`}
      </CodeBlock>

      {/* 0G Compute */}
      <H2 id="compute">ZeroGComputeAdapter</H2>
      <P>Runs sealed inference on 0G Compute and returns a cryptographic receipt binding the model, input, and output.</P>
      <CodeBlock lang="typescript">
{`const { output, receipt } = await sigil.compute.runSealedInference({
  model: "qwen/qwen-2.5-7b-instruct",
  messages: [
    { role: "system", content: "You are a DeFi risk analyst." },
    { role: "user",   content: prompt },
  ],
  maxTokens: 2048,
});

// Pass receipt directly to notarize()
await agentSigil.provenance.notarize({ ..., inferenceReceipt: receipt, output });`}
      </CodeBlock>
      <Callout type="tip">
        Live model IDs on 0G Galileo testnet: <Code>qwen/qwen-2.5-7b-instruct</Code>. The vendor prefix is required — passing <Code>qwen-2.5-7b-instruct</Code> without the prefix will not match the on-chain broker listing.
      </Callout>

      {/* Credentials */}
      <H2 id="credentials">Credentials</H2>
      <P>The <Code>persistAs</Code> option in <Code>register()</Code> writes a discoverability file. Agent runtimes can later read it without re-scanning the chain.</P>
      <CodeBlock lang="typescript">
{`import { readCredential, listCredentials } from "sigil-protocol";

// Read a specific credential
const me = readCredential("risk-agent");
console.log(me.passportId);
console.log(me.agentAddress);
console.log(me.principal);

// List all stored credentials
const all = listCredentials();`}
      </CodeBlock>
      <P>Credentials are stored at <Code>~/.sigil/credentials/&lt;name&gt;.json</Code>. They contain only public metadata — never the agent private key.</P>

      {/* Types */}
      <H2 id="types">Key Types</H2>
      <CodeBlock lang="typescript">
{`// From "sigil-protocol"

enum ArtifactType {
  CODE_AUDIT = 0,
  CONTRACT_CLAUSE = 1,
  RISK_ASSESSMENT = 2,
  FINANCIAL_MODEL = 3,
  DUE_DILIGENCE = 4,
  GOVERNANCE_ANALYSIS = 5,
  GENERIC_REPORT = 6,
}

enum AttestationType {
  DEFI_REBALANCE = 0,
  CODE_AUDIT = 1,
  RISK_ASSESSMENT = 2,
  DATA_ENRICHMENT = 3,
  GOVERNANCE_VOTE = 4,
  GENERIC_TASK = 5,
}

interface SealedInferenceReceipt {
  modelId: string;
  modelVersionHash: string;
  inputHash: string;
  outputHash: string;
  proof: string;   // JSON string — cryptographic binding
  timestamp: number;
}

interface PermissionManifestPlain {
  version: string;
  agentDescription: string;
  whitelistedContracts: string[];
  maxTxValuePerWindow: Record<string, number>;
  authorizedApis: string[];
  allowedTokens: string[];
  timeWindowSeconds: number;
}`}
      </CodeBlock>

      {/* Error handling */}
      <H2 id="errors">Error Handling</H2>
      <CodeBlock lang="typescript">
{`import { SigilError, RegistryError, ProvenanceError } from "sigil-protocol";

try {
  await sigil.passport.resolve(passportId);
} catch (err) {
  if (err instanceof RegistryError) {
    // PassportNotFound, NotAuthorizedSigner, etc.
  }
  if (err instanceof SigilError) {
    // Base Sigil error
  }
}`}
      </CodeBlock>
    </DocsLayout>
  );
}
