import { DocsLayout, H1, H2, H3, P, Lead, Code, CodeBlock, Callout, PropTable, Endpoint } from "../../../components/docs/layout";

export const metadata = { title: "REST API — Sigil Protocol" };

export default function ApiPage() {
  return (
    <DocsLayout>
      <div style={{ fontFamily: "var(--font-mono-src)", fontSize: 11, color: "var(--accent)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>
        REST API
      </div>
      <H1>Registration API</H1>
      <Lead>
        HTTP endpoints for sponsored agent registration. External agents (with no SDK access) use this flow to obtain a passportId and agent private key — routed through a human principal who signs the on-chain transaction.
      </Lead>

      <Callout type="info">
        All API endpoints are served by the Next.js app at <Code>http://localhost:3000</Code> in development. Deploy the <Code>demo/ui</Code> package to Vercel or any Node.js host for a public URL.
      </Callout>

      {/* Base URL */}
      <H2 id="base">Base URL</H2>
      <CodeBlock lang="bash">
{`BASE_URL=http://localhost:3000   # development
BASE_URL==https://sigiltwoelves.vercel.app # production`}
      </CodeBlock>

      {/* Flow overview */}
      <H2 id="flow">Registration Flow</H2>
      <div style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 28 }}>
        {[
          { n: "1", text: "Agent POSTs to /register/request — gets requestId + approvalUrl" },
          { n: "2", text: "Agent shows approvalUrl to the principal (human)" },
          { n: "3", text: "Principal visits the approve page, connects wallet, signs register() tx" },
          { n: "4", text: "Agent polls /register/status/:requestId every 5s until approved" },
          { n: "5", text: "First approved response delivers agentPrivateKey (exactly once)" },
          { n: "6", text: "Agent stores passportId + agentPrivateKey, begins notarizing" },
        ].map((s) => (
          <div
            key={s.n}
            style={{
              display: "flex",
              gap: 16,
              padding: "12px 0",
              borderBottom: "1px solid var(--border)",
              fontSize: 13,
              color: "var(--text-2)",
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 22,
                height: 22,
                borderRadius: "50%",
                background: "var(--accent-dim)",
                border: "1px solid var(--accent)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-mono-src)",
                fontSize: 10,
                color: "var(--accent)",
                fontWeight: 700,
              }}
            >
              {s.n}
            </span>
            {s.text}
          </div>
        ))}
      </div>

      {/* POST /register/request */}
      <H2 id="register-request">Create Registration Request</H2>
      <Endpoint method="POST" path="/api/v1/passport/register/request" id="register-request-endpoint" />
      <P>
        Generate a fresh agent keypair, pre-compute the passportId, and create a pending registration with a 24-hour TTL. Returns a requestId and an approvalUrl to present to the principal.
      </P>

      <H3>Request Body</H3>
      <PropTable
        rows={[
          { name: "principalAddress", type: "string", required: true, desc: "0x + 40 hex chars. The wallet that will own the AgentPassport iNFT." },
          { name: "agentDescription", type: "string", required: true, desc: "Free-text description of the agent (≤ 280 characters)." },
          { name: "permissions", type: "object", required: true, desc: "Permission manifest defining what the agent is authorized to do." },
          { name: "permissions.whitelistedContracts", type: "string[]", desc: "Contract addresses the agent may interact with." },
          { name: "permissions.maxTxValuePerWindow", type: "Record<string, number>", desc: "Max token value per rolling window. e.g. { 'OG': 0 }" },
          { name: "permissions.authorizedApis", type: "string[]", desc: "External API identifiers. e.g. ['0g.compute']" },
          { name: "permissions.allowedTokens", type: "string[]", desc: "Token symbols the agent may use." },
          { name: "permissions.timeWindowSeconds", type: "number", desc: "Rolling window duration in seconds." },
        ]}
      />

      <H3>Example Request</H3>
      <CodeBlock lang="bash">
{`curl -X POST $BASE_URL/api/v1/passport/register/request \\
  -H "Content-Type: application/json" \\
  -d '{
    "principalAddress": "0xYourWalletAddress",
    "agentDescription": "Risk scoring agent for DeFi protocols",
    "permissions": {
      "whitelistedContracts": [],
      "maxTxValuePerWindow": { "OG": 0 },
      "authorizedApis": ["0g.compute"],
      "allowedTokens": ["OG"],
      "timeWindowSeconds": 3600
    }
  }'`}
      </CodeBlock>

      <H3>Response</H3>
      <CodeBlock lang="json">
{`{
  "requestId": "a1b2c3d4e5f6...",
  "agentAddress": "0x...",
  "passportId": "0x...",
  "approvalUrl": "http://localhost:3000/approve/a1b2c3d4...",
  "expiresAt": 1746086400000
}`}
      </CodeBlock>

      <H3>Error Responses</H3>
      <PropTable
        rows={[
          { name: "400", type: "Bad Request", desc: "Missing or invalid fields in the request body." },
          { name: "429", type: "Too Many Requests", desc: "Rate limit exceeded: max 5 requests per IP per hour, or max 10 pending per principal." },
        ]}
      />

      {/* GET /register/status */}
      <H2 id="register-status">Poll Registration Status</H2>
      <Endpoint method="GET" path="/api/v1/passport/register/status/:requestId" id="register-status-endpoint" />
      <P>
        Poll until the principal approves the registration. The first response with <Code>status: "approved"</Code> includes <Code>agentPrivateKey</Code> — it is never returned again after that.
      </P>

      <H3>Example Request</H3>
      <CodeBlock lang="bash">
{`curl $BASE_URL/api/v1/passport/register/status/a1b2c3d4e5f6...`}
      </CodeBlock>

      <H3>Response — Pending</H3>
      <CodeBlock lang="json">
{`{
  "status": "pending",
  "requestId": "a1b2c3d4...",
  "agentAddress": "0x...",
  "passportId": "0x...",
  "agentDescription": "Risk scoring agent for DeFi protocols",
  "createdAt": 1746000000000,
  "expiresAt": 1746086400000
}`}
      </CodeBlock>

      <H3>Response — Approved (first call)</H3>
      <Callout type="danger">
        Store <Code>agentPrivateKey</Code> immediately. This is the only call that returns it. Subsequent calls omit the key.
      </Callout>
      <CodeBlock lang="json">
{`{
  "status": "approved",
  "requestId": "a1b2c3d4...",
  "passportId": "0x...",
  "agentAddress": "0x...",
  "agentPrivateKey": "0x...",
  "approvalTxHash": "0x..."
}`}
      </CodeBlock>

      <H3>Response — Approved (subsequent calls)</H3>
      <CodeBlock lang="json">
{`{
  "status": "approved",
  "requestId": "a1b2c3d4...",
  "passportId": "0x...",
  "agentAddress": "0x...",
  "approvalTxHash": "0x..."
}`}
      </CodeBlock>

      <H3>Polling Pattern</H3>
      <CodeBlock lang="typescript">
{`async function waitForApproval(requestId: string, baseUrl: string) {
  while (true) {
    const res = await fetch(\`\${baseUrl}/api/v1/passport/register/status/\${requestId}\`);
    const data = await res.json();

    if (data.status === "approved") {
      if (data.agentPrivateKey) {
        // Store immediately — won't be returned again
        process.env.SIGIL_AGENT_PRIVATE_KEY = data.agentPrivateKey;
        console.log("passportId:", data.passportId);
      }
      return data;
    }

    if (data.error) throw new Error(data.error);

    await new Promise(r => setTimeout(r, 5000)); // poll every 5s
  }
}`}
      </CodeBlock>

      {/* POST /approve */}
      <H2 id="approve">Approve Registration</H2>
      <Endpoint method="POST" path="/api/v1/passport/approve/:requestId" id="approve-endpoint" />
      <P>
        Called by the <Code>/approve/:requestId</Code> browser page after the principal submits the <Code>SigilRegistry.register()</Code> transaction. Not normally called directly by agents.
      </P>

      <Callout type="info">
        The approve endpoint verifies a <Code>principalSignature</Code> over the message <Code>sigil-approve:&lt;requestId&gt;</Code>. It must recover to the <Code>principalAddress</Code> stored in the pending registration. This prevents a third party from marking a request as approved.
      </Callout>

      <H3>Request Body</H3>
      <PropTable
        rows={[
          { name: "txHash", type: "string", required: true, desc: "The register() transaction hash (0x + 64 hex chars)." },
          { name: "passportId", type: "string", required: true, desc: "The passportId confirmed by the transaction." },
          { name: "principalSignature", type: "string", required: true, desc: "Principal's personal_sign over 'sigil-approve:<requestId>'." },
        ]}
      />

      <H3>Response</H3>
      <CodeBlock lang="json">
{`{ "ok": true, "passportId": "0x..." }`}
      </CodeBlock>

      {/* Rate limits */}
      <H2 id="rate-limits">Rate Limits</H2>
      <PropTable
        rows={[
          { name: "IP rate limit", type: "5 / hour", desc: "Max 5 new registration requests per IP address per hour." },
          { name: "Principal limit", type: "10 active", desc: "Max 10 pending (unapproved) registrations per principal address at any time." },
          { name: "TTL", type: "24 hours", desc: "Pending registrations expire after 24 hours if not approved. Local development uses a 60-second sweeper; hosted deployments should back the API with durable KV." },
        ]}
      />
      <Callout type="warn">
        Hosted/serverless deployments should set <Code>KV_REST_API_URL</Code> and <Code>KV_REST_API_TOKEN</Code> (or the raw Upstash equivalents) so the request, approve, and status routes share durable state across instances. If those vars are unset, the app falls back to an in-memory store for local development only.
      </Callout>

      {/* static files */}
      <H2 id="static">Additional Endpoints</H2>
      <Endpoint method="GET" path="/SKILL.md" />
      <P>The agent onboarding document. Machine-readable. Any AI agent can fetch and parse this to self-onboard without human guidance.</P>

      <Endpoint method="GET" path="/api/storage/:rootHash" />
      <P>Server-side proxy to 0G Storage. Returns raw bytes for a given content-addressed root hash. Used by the resolver UI to download proof envelopes and encrypted manifests without browser-side 0G SDK dependencies.</P>
    </DocsLayout>
  );
}
