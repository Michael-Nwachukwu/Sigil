import { DocsLayout, H1, H2, H3, P, Lead, Code, CodeBlock, Callout, PropTable } from "../../../components/docs/layout";

export const metadata = { title: "MCP Tools — Sigil Protocol" };

export default function McpPage() {
  return (
    <DocsLayout>
      <div style={{ fontFamily: "var(--font-mono-src)", fontSize: 11, color: "var(--accent)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
        MCP Tools
      </div>
      <H1>Sigil MCP Server</H1>
      <Lead>
        A Model Context Protocol server that gives Claude Code, Claude Desktop, and any MCP-compatible agent runtime direct access to Sigil's identity and provenance tools — with no SDK setup required.
      </Lead>

      {/* Transports */}
      <H2 id="transports">Transports</H2>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        {[
          {
            title: "stdio",
            desc: "Default. The agent runtime spawns the MCP server as a child process. Used by Claude Code and Claude Desktop local config. Agent private key stays in the host process environment — never travels over the wire.",
            tag: "Local",
            color: "var(--ok)",
          },
          {
            title: "SSE / HTTP",
            desc: "Remote agents connect via Server-Sent Events. Enable by setting MCP_HTTP_PORT. The server listens on GET /sse + POST /message. Suitable for cloud-deployed agents that cannot run a local process.",
            tag: "Remote",
            color: "var(--accent)",
          },
        ].map((t) => (
          <div key={t.title} style={{ background: "var(--bg-raised)", border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{t.title}</span>
              <span style={{ fontFamily: "var(--font-mono-src)", fontSize: 9, color: t.color, background: `${t.color}22`, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.06em" }}>{t.tag}</span>
            </div>
            <P>{t.desc}</P>
          </div>
        ))}
      </div>

      {/* Setup — stdio */}
      <H2 id="setup-stdio">Setup — Stdio (Claude Code / Desktop)</H2>
      <H3>Build</H3>
      <CodeBlock lang="bash">
{`cd mcp-server
pnpm install
pnpm build`}
      </CodeBlock>

      <H3>Claude Code config (~/.claude/config.json)</H3>
      <CodeBlock lang="json" title="~/.claude/config.json">
{`{
  "mcpServers": {
    "sigil": {
      "command": "node",
      "args": ["/path/to/sigil/mcp-server/dist/index.js"],
      "env": {
        "ZERO_G_RPC_URL": "https://evmrpc-testnet.0g.ai",
        "ZERO_G_CHAIN_ID": "16602",
        "SIGIL_REGISTRY_ADDRESS": "0x2C0457F82B57148e8363b4589bb3294b23AE7625",
        "PROVENANCE_NOTARY_ADDRESS": "0xA1103E6490ab174036392EbF5c798C9DaBAb24EE",
        "ZERO_G_STORAGE_RPC": "https://indexer-storage-testnet-turbo.0g.ai",
        "SIGIL_API_BASE_URL": "http://localhost:3000",
        "SIGIL_AGENT_PRIVATE_KEY": "0x...",
        "SIGIL_EXPLORER_URL": "https://chainscan-galileo.0g.ai"
      }
    }
  }
}`}
      </CodeBlock>

      <H3>Claude Desktop config</H3>
      <CodeBlock lang="json" title="claude_desktop_config.json">
{`{
  "mcpServers": {
    "sigil-protocol": {
      "command": "node",
      "args": ["/path/to/sigil/mcp-server/dist/index.js"],
      "env": {
        "ZERO_G_RPC_URL": "https://evmrpc-testnet.0g.ai",
        "SIGIL_REGISTRY_ADDRESS": "0x2C0457F82B57148e8363b4589bb3294b23AE7625",
        "PROVENANCE_NOTARY_ADDRESS": "0xA1103E6490ab174036392EbF5c798C9DaBAb24EE",
        "SIGIL_AGENT_PRIVATE_KEY": "0x...",
        "SIGIL_API_BASE_URL": "http://localhost:3000"
      }
    }
  }
}`}
      </CodeBlock>

      {/* Setup — SSE */}
      <H2 id="setup-sse">Setup — SSE (Remote Agents)</H2>
      <CodeBlock lang="bash">
{`# Start the MCP server in HTTP mode
MCP_HTTP_PORT=4000 \\
ZERO_G_RPC_URL=https://evmrpc-testnet.0g.ai \\
SIGIL_REGISTRY_ADDRESS=0x2C0457F82B57148e8363b4589bb3294b23AE7625 \\
PROVENANCE_NOTARY_ADDRESS=0xA1103E6490ab174036392EbF5c798C9DaBAb24EE \\
SIGIL_AGENT_PRIVATE_KEY=0x... \\
node mcp-server/dist/index.js

# The server exposes:
#   GET  http://0.0.0.0:4000/sse      — SSE endpoint (remote agents connect here)
#   POST http://0.0.0.0:4000/message  — message handler
#   GET  http://0.0.0.0:4000/health   — health check`}
      </CodeBlock>

      <P>For a public URL during development, use a Cloudflare tunnel:</P>
      <CodeBlock lang="bash">
{`cloudflared tunnel --url http://localhost:4000`}
      </CodeBlock>

      <Callout type="warn">
        In SSE mode, <Code>sigil__notarize_output</Code> rejects any call whose arguments contain a hex string matching a private key pattern. The agent private key must be set in the server's environment — it never travels over the SSE connection.
      </Callout>

      {/* Tool reference */}
      <H2 id="tools">Tool Reference</H2>

      {/* register_agent */}
      <div id="register" style={{ scrollMarginTop: 72 }}>
        <H3>sigil__register_agent</H3>
      </div>
      <P>Initiate a sponsored registration request or poll an existing one. Call with <Code>principalAddress</Code> + <Code>agentDescription</Code> + <Code>permissions</Code> to create a new request. Call with <Code>requestId</Code> to poll — the approved response includes the passportId and agentPrivateKey (once).</P>
      <PropTable
        rows={[
          { name: "principalAddress", type: "string", desc: "Principal wallet address (0x+40 hex). Required for new requests." },
          { name: "agentDescription", type: "string", desc: "Agent description ≤ 280 chars. Required for new requests." },
          { name: "permissions", type: "object", desc: "Permission manifest. Required for new requests. Fields: whitelistedContracts, maxTxValuePerWindow, authorizedApis, allowedTokens, timeWindowSeconds." },
          { name: "requestId", type: "string", desc: "If provided, polls the status of an existing request instead of creating a new one." },
        ]}
      />
      <CodeBlock lang="text" title="Example — Create">
{`sigil__register_agent({
  "principalAddress": "0xYourWallet",
  "agentDescription": "DeFi risk scoring agent",
  "permissions": {
    "whitelistedContracts": [],
    "maxTxValuePerWindow": { "OG": 0 },
    "authorizedApis": ["0g.compute"],
    "allowedTokens": ["OG"],
    "timeWindowSeconds": 3600
  }
})

// Returns:
// {
//   "requestId": "abc123...",
//   "agentAddress": "0x...",
//   "approvalUrl": "http://localhost:3000/approve/abc123...",
//   "message": "Registration pending. The principal must visit this URL to approve: ..."
// }`}
      </CodeBlock>
      <CodeBlock lang="text" title="Example — Poll">
{`sigil__register_agent({ "requestId": "abc123..." })

// Returns (after approval, first call):
// {
//   "status": "approved",
//   "passportId": "0x...",
//   "agentPrivateKey": "0x...",
//   "message": "Registration approved! passportId=0x...\n\nIMPORTANT: Store your agent private key..."
// }`}
      </CodeBlock>

      {/* resolve_agent */}
      <div id="resolve" style={{ scrollMarginTop: 72 }}>
        <H3>sigil__resolve_agent</H3>
      </div>
      <P>Read an AgentPassport from on-chain. Accepts a passportId or agent address. Returns the full PassportRecord including reputation score, task counts, and active status.</P>
      <PropTable
        rows={[
          { name: "query", type: "string", desc: "PassportId (0x+64 hex) or agent address (0x+40 hex). Optional — defaults to SIGIL_AGENT_ADDRESS env var." },
        ]}
      />
      <CodeBlock lang="text" title="Example">
{`sigil__resolve_agent({ "query": "0x87c4d2f5..." })

// Returns:
// {
//   "passportId": "0x87c4d2f5...",
//   "principal": "0x...",
//   "agentAddress": "0x...",
//   "active": true,
//   "reputationScore": 1000,
//   "taskCount": 12,
//   "failureCount": 0,
//   "provenanceRecordCount": "12",
//   "createdAt": "2026-05-01T10:00:00.000Z"
// }`}
      </CodeBlock>

      {/* notarize_output */}
      <div id="notarize" style={{ scrollMarginTop: 72 }}>
        <H3>sigil__notarize_output</H3>
      </div>
      <Callout type="danger">
        Local (stdio) transport only. Reads <Code>SIGIL_AGENT_PRIVATE_KEY</Code> from the server environment. Never pass private keys in tool arguments.
      </Callout>
      <P>Notarize an AI-generated artifact on 0G Chain. Encrypts and uploads the input context to 0G Storage, builds a provenance envelope with the output and model receipt, and calls <Code>ProvenanceNotary.notarize()</Code> on-chain.</P>
      <PropTable
        rows={[
          { name: "passportId", type: "string", required: true, desc: "The agent's passportId (0x+64 hex)." },
          { name: "output", type: "string", required: true, desc: "The full text of the artifact to notarize." },
          { name: "inputContext", type: "string", required: true, desc: "The input prompt or context (encrypted before upload)." },
          { name: "artifactType", type: "string", desc: "One of: CODE_AUDIT, RISK_ASSESSMENT, GENERIC_REPORT, CONTRACT_CLAUSE, FINANCIAL_MODEL, DUE_DILIGENCE, GOVERNANCE_ANALYSIS. Default: GENERIC_REPORT." },
          { name: "modelId", type: "string", desc: "Model used to generate the output. Default: qwen/qwen-2.5-7b-instruct." },
        ]}
      />
      <CodeBlock lang="text" title="Example">
{`sigil__notarize_output({
  "passportId": "0x87c4d2f5...",
  "output": "The DeFi protocol has a risk score of 7/10 based on...",
  "inputContext": "Analyze the risk of Aave V3 on Ethereum mainnet",
  "artifactType": "RISK_ASSESSMENT"
})

// Returns:
// {
//   "recordId": "0x...",
//   "txHash": "0x...",
//   "outputHash": "0x...",
//   "explorerUrl": "https://chainscan-galileo.0g.ai/tx/0x...",
//   "message": "Notarized on-chain. recordId=0x...\nTx: ..."
// }`}
      </CodeBlock>

      {/* resolve_provenance */}
      <div id="resolve-provenance" style={{ scrollMarginTop: 72 }}>
        <H3>sigil__resolve_provenance</H3>
      </div>
      <P>Resolve a ProvenanceRecord from on-chain. Supports lookup by recordId, outputHash (keccak256 of the artifact), or passportId (to list all records for an agent).</P>
      <PropTable
        rows={[
          { name: "recordId", type: "string", desc: "The ProvenanceRecord ID (bytes32)." },
          { name: "outputHash", type: "string", desc: "keccak256 of the artifact output — resolves to the recordId first." },
          { name: "passportId", type: "string", desc: "List all records for this passport (paginated)." },
          { name: "offset", type: "number", desc: "Pagination offset. Default: 0." },
          { name: "limit", type: "number", desc: "Max records to return (1–50). Default: 10." },
        ]}
      />
      <CodeBlock lang="text" title="Example — by recordId">
{`sigil__resolve_provenance({ "recordId": "0x..." })

// Returns:
// {
//   "recordId": "0x...",
//   "passportId": "0x...",
//   "agent": "0x...",
//   "modelId": "qwen/qwen-2.5-7b-instruct",
//   "artifactType": "RISK_ASSESSMENT",
//   "verified": true,
//   "timestamp": "2026-05-01T12:00:00.000Z"
// }`}
      </CodeBlock>

      {/* verify_agent */}
      <div id="verify" style={{ scrollMarginTop: 72 }}>
        <H3>sigil__verify_agent</H3>
      </div>
      <P>Trust-gate another agent before delegating work to it. Returns ACCEPT, CAUTION, or REJECT based on the agent's on-chain reputation and activity record.</P>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 20, fontSize: 13 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--bg-raised)" }}>
              {["Trust Level", "Condition", "Recommended Action"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontFamily: "var(--font-mono-src)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", borderBottom: "1px solid var(--border)", fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              { level: "ACCEPT", color: "var(--ok)", cond: "reputation ≥ 600 AND failureCount == 0", action: "Proceed with delegation" },
              { level: "CAUTION", color: "var(--sealed)", cond: "reputation 200–599 OR failureCount > 0", action: "Delegate with oversight or reduced scope" },
              { level: "REJECT", color: "var(--danger)", cond: "reputation < 200 OR active == false", action: "Do not delegate — agent is untrustworthy or revoked" },
            ].map((r, i) => (
              <tr key={r.level} style={{ borderBottom: i < 2 ? "1px solid var(--border)" : "none" }}>
                <td style={{ padding: "12px 14px" }}>
                  <span style={{ fontFamily: "var(--font-mono-src)", fontSize: 11, fontWeight: 700, color: r.color }}>{r.level}</span>
                </td>
                <td style={{ padding: "12px 14px", color: "var(--text-2)" }}>{r.cond}</td>
                <td style={{ padding: "12px 14px", color: "var(--text-2)" }}>{r.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PropTable
        rows={[
          { name: "query", type: "string", required: true, desc: "PassportId (0x+64 hex) or agent address (0x+40 hex) to verify." },
        ]}
      />
      <CodeBlock lang="text" title="Example">
{`sigil__verify_agent({ "query": "0x87c4d2f5..." })

// Returns:
// {
//   "trustLevel": "ACCEPT",
//   "reputationScore": 1000,
//   "taskCount": 12,
//   "failureCount": 0,
//   "active": true,
//   "reasons": ["Reputation 1000/1000, 12 tasks completed, 0 failures"],
//   "message": "ACCEPT — Reputation 1000/1000, 12 tasks completed, 0 failures"
// }`}
      </CodeBlock>

      {/* Env vars */}
      <H2 id="env">Environment Variables</H2>
      <PropTable
        rows={[
          { name: "ZERO_G_RPC_URL", type: "string", required: true, desc: "0G Chain JSON-RPC endpoint. Default: https://evmrpc-testnet.0g.ai" },
          { name: "ZERO_G_CHAIN_ID", type: "number", desc: "Chain ID. Default: 16602" },
          { name: "SIGIL_REGISTRY_ADDRESS", type: "string", desc: "SigilRegistry contract address. Default: 0x2C0457F82B57148e8363b4589bb3294b23AE7625" },
          { name: "PROVENANCE_NOTARY_ADDRESS", type: "string", desc: "ProvenanceNotary contract address. Default: 0xA1103E6490ab174036392EbF5c798C9DaBAb24EE" },
          { name: "ZERO_G_STORAGE_RPC", type: "string", desc: "0G Storage indexer URL. Required for notarize." },
          { name: "SIGIL_AGENT_PRIVATE_KEY", type: "string", desc: "Agent signing key. Required for sigil__notarize_output. Never passed in tool call payloads." },
          { name: "SIGIL_API_BASE_URL", type: "string", desc: "Base URL of the Next.js app for the registration API. Default: http://localhost:3000" },
          { name: "SIGIL_EXPLORER_URL", type: "string", desc: "Block explorer base URL for links. Default: https://chainscan-galileo.0g.ai" },
          { name: "MCP_HTTP_PORT", type: "number", desc: "If set, starts an SSE/HTTP server on this port instead of using stdio." },
        ]}
      />
    </DocsLayout>
  );
}
