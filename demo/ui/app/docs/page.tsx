import { DocsLayout, H1, H2, H3, P, Lead, Code, CodeBlock, Callout, PropTable } from "../../components/docs/layout";
import Link from "next/link";

export const metadata = { title: "Sigil Protocol — Docs" };

export default function DocsPage() {
  return (
    <DocsLayout>
      <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: 32, marginBottom: 8 }}>
        <div style={{ fontFamily: "var(--font-mono-src)", fontSize: 11, color: "var(--accent)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
          Introduction
        </div>
        <H1>Sigil Protocol</H1>
        <Lead>
          Identity and provenance infrastructure for autonomous AI agents on 0G. Two permanent on-chain primitives — AgentPassport and ProvenanceRecord — that answer two questions any verifier needs: <em>who produced this</em>, and <em>who authorized them</em>.
        </Lead>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[
            { label: "SDK Reference", href: "/docs/sdk" },
            { label: "REST API", href: "/docs/api" },
            { label: "MCP Tools", href: "/docs/mcp" },
            { label: "Explorer", href: "/passport" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                textDecoration: "none",
                fontSize: 13,
                color: "var(--accent)",
                background: "var(--accent-dim)",
                transition: "opacity .15s",
              }}
            >
              {l.label} →
            </Link>
          ))}
        </div>
      </div>

      {/* How it works */}
      <H2 id="how-it-works">How It Works</H2>
      <P>
        Sigil separates two concerns that are always conflated in AI agent deployments: <em>identity</em> (who is this agent, who authorized it) and <em>provenance</em> (what did it produce, using which model, from which input).
      </P>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {[
          {
            title: "AgentPassport",
            sub: "ERC-7857 iNFT",
            body: "Minted once per agent. Binds a principal wallet to an agent wallet. Stores an encrypted permission manifest in 0G Storage. Tracks reputation, task count, and execution fingerprints on-chain.",
            color: "var(--accent)",
          },
          {
            title: "ProvenanceRecord",
            sub: "On-chain notarization",
            body: "Created on every consequential output. Stores output hash, input context hash (encrypted in 0G Storage), sealed inference receipt hash, EIP-712 agent signature, and a reverse lookup from output hash → record.",
            color: "var(--sealed)",
          },
        ].map((c) => (
          <div
            key={c.title}
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{c.title}</div>
            <div style={{ fontFamily: "var(--font-mono-src)", fontSize: 10, color: c.color, letterSpacing: "0.06em", marginBottom: 12 }}>{c.sub}</div>
            <P>{c.body}</P>
          </div>
        ))}
      </div>

      <P>
        The two primitives are permanently linked. Every <Code>ProvenanceRecord</Code> references a <Code>passportId</Code>. Every <Code>AgentPassport</Code> maintains a count of its provenance records and execution fingerprints. Resolution works in both directions.
      </P>

      {/* Dual wallet */}
      <H2 id="dual-wallet">Dual Wallet Model</H2>
      <P>
        Sigil separates control from execution with two distinct wallets per agent.
      </P>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 24, fontSize: 13 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg-raised)" }}>
              {["Wallet", "Role", "Signs"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontFamily: "var(--font-mono-src)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "12px 14px" }}><strong>Principal</strong></td>
              <td style={{ padding: "12px 14px", color: "var(--text-2)" }}>Owns the iNFT, controls permissions</td>
              <td style={{ padding: "12px 14px", color: "var(--text-2)" }}><Code>register()</Code> once at setup</td>
            </tr>
            <tr>
              <td style={{ padding: "12px 14px" }}><strong>Agent</strong></td>
              <td style={{ padding: "12px 14px", color: "var(--text-2)" }}>Fresh keypair per passport, autonomous signer</td>
              <td style={{ padding: "12px 14px", color: "var(--text-2)" }}>Every <Code>notarize()</Code> call, autonomously</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Callout type="warn">
        The principal authorizes the agent exactly once at registration. After that, every notarization is signed by the agent autonomously — no per-output principal interaction. The principal can rotate or revoke the agent at any time via <Code>SigilRegistry.rotateAgentAddress()</Code> or <Code>revokeAgent()</Code>.
      </Callout>

      {/* Quick start */}
      <H2 id="quickstart">Quick Start</H2>
      <H3>Install</H3>
      <CodeBlock lang="bash">
{`pnpm add sigil-protocol ethers`}
      </CodeBlock>

      <H3>Register an Agent (principal side)</H3>
      <CodeBlock lang="typescript" title="register-agent.ts">
{`import { Wallet } from "ethers";
import { SigilClient } from "sigil-protocol";

const principal = new Wallet(process.env.ZERO_G_PRIVATE_KEY!);

const sigil = new SigilClient({
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  chainId: 16602,
  registryAddress: "0x2C0457F82B57148e8363b4589bb3294b23AE7625",
  notaryAddress: "0xA1103E6490ab174036392EbF5c798C9DaBAb24EE",
  signer: principal,
});

const { passportId, agentAddress, agentPrivateKey } = await sigil.passport.register({
  agentDescription: "Risk scoring agent for DeFi protocols",
  permissions: {
    whitelistedContracts: [],
    maxTxValuePerWindow: { OG: 0 },
    authorizedApis: ["0g.compute"],
    allowedTokens: ["OG"],
    timeWindowSeconds: 3600,
  },
  persistAs: "risk-agent",  // writes public metadata to ~/.sigil/credentials/
});

// Store passportId and agentPrivateKey securely — key is returned once only
console.log("passportId:", passportId);
console.log("agentAddress:", agentAddress);`}
      </CodeBlock>

      <H3>Notarize an Output (agent side)</H3>
      <CodeBlock lang="typescript" title="notarize.ts">
{`import { Wallet } from "ethers";
import { ArtifactType, SigilClient } from "sigil-protocol";

const agentWallet = new Wallet(process.env.SIGIL_AGENT_PRIVATE_KEY!);
const sigil = new SigilClient({ ...config, signer: agentWallet });

const record = await sigil.provenance.notarize({
  passportId: process.env.SIGIL_PASSPORT_ID!,
  inferenceReceipt,       // from ZeroGComputeAdapter.runSealedInference()
  inputContext: prompt,   // encrypted before 0G Storage upload
  output: response,
  artifactType: ArtifactType.GENERIC_REPORT,
});

console.log("recordId:", record.recordId);
console.log("txHash:  ", record.txHash);`}
      </CodeBlock>

      {/* Network */}
      <H2 id="network">Network & Contracts</H2>
      <PropTable
        rows={[
          { name: "Network", type: "string", desc: "0G Galileo Testnet" },
          { name: "Chain ID", type: "number", desc: "16602" },
          { name: "RPC", type: "string", desc: "https://evmrpc-testnet.0g.ai" },
          { name: "Explorer", type: "string", desc: "https://chainscan-galileo.0g.ai" },
          { name: "SigilRegistry", type: "address", desc: "0x2C0457F82B57148e8363b4589bb3294b23AE7625" },
          { name: "ProvenanceNotary", type: "address", desc: "0xA1103E6490ab174036392EbF5c798C9DaBAb24EE" },
        ]}
      />
    </DocsLayout>
  );
}
