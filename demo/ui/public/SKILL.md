# Sigil Protocol — Integration Guide

> **BASE_URL** in this document refers to the URL where this file was served.
> If this document was fetched from `https://example.com/SKILL.md`, then
> `BASE_URL = https://example.com`. Substitute it in all API examples below.

---

## What Sigil Provides

Sigil Protocol is identity and provenance infrastructure for AI agents on the
0G blockchain. It exposes two on-chain primitives:

| Primitive | Description |
|-----------|-------------|
| **AgentPassport** | A permanent on-chain identity (ERC-7857 iNFT) that links an agent to a human principal who authorized it. Publicly resolvable. |
| **ProvenanceRecord** | A cryptographic notarization of a consequential agent output. Proves which model ran, what input it received (hashed), what output it produced, and which registered agent signed it. |

After registration, an agent runtime holds:
- `SIGIL_PASSPORT_ID` — permanent on-chain identity anchor (bytes32)
- `SIGIL_AGENT_ADDRESS` — the wallet address used to sign notarizations
- `SIGIL_AGENT_PRIVATE_KEY` — stored in env/secrets, never transmitted

---

## Registration Flow

Registration requires three parties: the **agent** (or operator), the **Sigil API**, and the **principal** (the human who will authorize the agent on-chain).

### Step 1 — Collect the Principal Address

Obtain the Ethereum wallet address of the human principal who will authorize
the agent. This is the address that will sign the on-chain registration
transaction. Store it as `PRINCIPAL_ADDRESS`.

---

### Step 2 — Request Registration

```http
POST {BASE_URL}/api/v1/passport/register/request
Content-Type: application/json

{
  "principalAddress": "<PRINCIPAL_ADDRESS>",
  "agentDescription": "<description of what the agent does, ≤ 280 chars>",
  "permissions": {
    "whitelistedContracts": [],
    "maxTxValuePerWindow": { "OG": 0 },
    "authorizedApis": ["0g.compute"],
    "allowedTokens": ["OG"],
    "timeWindowSeconds": 3600
  }
}
```

**Response:**
```json
{
  "requestId": "a1b2c3d4...",
  "agentAddress": "0x...",
  "passportId": "0x...",
  "approvalUrl": "{BASE_URL}/approve/a1b2c3d4...",
  "expiresAt": 1746086400000
}
```

Store `requestId`, `agentAddress`, and `passportId`. The request expires after
24 hours if not approved.

Adjust `permissions` to match what the agent actually needs. List specific
contracts in `whitelistedContracts` if the agent will interact with them;
update `maxTxValuePerWindow` if the agent will transact tokens.

---

### Step 3 — Principal Approval

The principal must visit the `approvalUrl` from the Step 2 response, connect
their wallet (`PRINCIPAL_ADDRESS`), and sign the on-chain registration
transaction on 0G Galileo Testnet. The approval page handles network switching
automatically.

The `approvalUrl` takes the form: `{BASE_URL}/approve/<requestId>`

---

### Step 4 — Poll for Approval and Receive Credentials

After the principal approves, poll the status endpoint:

```http
GET {BASE_URL}/api/v1/passport/register/status/<requestId>
```

Poll every 5–10 seconds. Once the principal's transaction is confirmed, the
response will include `status: "approved"`:

```json
{
  "status": "approved",
  "passportId": "0x...",
  "agentAddress": "0x...",
  "agentPrivateKey": "0x...",
  "approvalTxHash": "0x..."
}
```

**Important:** `agentPrivateKey` is delivered exactly once — in the first
`approved` response. Subsequent calls to this endpoint will omit the key.
Store it immediately on receipt.

---

## Credentials to Store

| Variable | Value | Storage |
|----------|-------|---------|
| `SIGIL_PASSPORT_ID` | `0x…` (64 hex chars) | Config / env |
| `SIGIL_AGENT_ADDRESS` | `0x…` (40 hex chars) | Config / env |
| `SIGIL_AGENT_PRIVATE_KEY` | `0x…` (64 hex chars) | Secrets manager / env — never log |
| `SIGIL_APPROVAL_TX` | `0x…` | Config / notes |

---

## Notarizing an Output

Any consequential output produced by a registered agent can be notarized via
the SDK or the MCP tool.

### Via SDK

```ts
import { Wallet } from "ethers";
import { ArtifactType, SigilClient } from "sigil-protocol";

const agentWallet = new Wallet(process.env.SIGIL_AGENT_PRIVATE_KEY!);
const sigil = new SigilClient({
  rpcUrl: "https://evmrpc-testnet.0g.ai",
  chainId: 16602,
  registryAddress: "0x2C0457F82B57148e8363b4589bb3294b23AE7625",
  notaryAddress: "0xA1103E6490ab174036392EbF5c798C9DaBAb24EE",
  signer: agentWallet,
});

const record = await sigil.provenance.notarize({
  passportId: process.env.SIGIL_PASSPORT_ID!,
  inferenceReceipt,      // from 0G Compute, or construct manually
  inputContext: "...",   // the prompt / input (encrypted before upload)
  output: "...",         // the response / artifact
  artifactType: ArtifactType.GENERIC_REPORT,
});

// record.recordId and record.txHash are the permanent proof
```

### Via MCP Tool

With the Sigil MCP server configured and `SIGIL_AGENT_PRIVATE_KEY` set in its
environment:

```
sigil__notarize_output({
  passportId: "0x...",
  output: "response text",
  inputContext: "input prompt",
  artifactType: "GENERIC_REPORT"
})
```

The agent private key never travels over the wire. The MCP server reads it
from its local environment.

---

## Resolving Identities and Records

Any passport or provenance record is publicly resolvable with no authentication.

### Via SDK

```ts
// Resolve an agent passport
const passport = await sigil.passport.resolve(passportId);
// passport.active, passport.principal, passport.reputationScore, ...

// Resolve a provenance record
const record = await sigil.provenance.resolve(recordId);
// record.agent, record.outputHash, record.verified, ...

// Reverse lookup: who produced this output?
const recordId = await sigil.provenance.resolveByOutput(outputHash);
```

### Via MCP Tools

```
sigil__resolve_agent({ query: "<passportId or agentAddress>" })
sigil__resolve_provenance({ recordId: "0x..." })
sigil__verify_agent({ query: "<passportId or agentAddress>" })
```

`sigil__verify_agent` returns a trust level:

| Level | Condition |
|-------|-----------|
| `ACCEPT` | reputation ≥ 600 and failureCount == 0 |
| `CAUTION` | reputation 200–599 or failureCount > 0 |
| `REJECT` | reputation < 200 or active == false |

### Via Resolver UI

Paste any `passportId`, `recordId`, agent address, or output hash at:
`{BASE_URL}/passport`

---

## MCP Server Configuration

### stdio (local, for Claude Code / Claude Desktop)

Add to `~/.claude/settings.json` (Claude Code) or Claude Desktop config:

```json
{
  "mcpServers": {
    "sigil": {
      "command": "npx",
      "args": ["-y", "sigil-mcp-server"],
      "env": {
        "SIGIL_AGENT_PRIVATE_KEY": "<agent private key>",
        "SIGIL_AGENT_ADDRESS": "<agent address>",
        "SIGIL_REGISTRY_ADDRESS": "0x2C0457F82B57148e8363b4589bb3294b23AE7625",
        "PROVENANCE_NOTARY_ADDRESS": "0xA1103E6490ab174036392EbF5c798C9DaBAb24EE",
        "ZERO_G_RPC_URL": "https://evmrpc-testnet.0g.ai",
        "SIGIL_API_BASE_URL": "{BASE_URL}"
      }
    }
  }
}
```

### SSE / HTTP (remote)

```json
{
  "mcpServers": {
    "sigil": {
      "transport": "sse",
      "url": "{BASE_URL}/mcp/sse"
    }
  }
}
```

Remote SSE exposes only `register`, `resolve`, and `verify` tools.
`notarize_output` is local-only (requires the agent private key in the MCP
server's environment).

---

## Error Reference

| Error / Status | Cause | Resolution |
|----------------|-------|------------|
| 404 on `requestId` | Request expired (24h TTL) | Submit a new registration request |
| `status: "pending"` after principal approved | On-chain confirmation in progress | Poll again after 30–60 seconds |
| No `agentPrivateKey` in approved response | Key already delivered on first poll | The key is unrecoverable; re-register with a new request |
| 429 Too Many Requests | Rate limit: 5 requests/IP/hour | Wait 1 hour and retry |
| `NotAuthorizedSigner` when notarizing | Agent key does not match registered agentAddress | Confirm `SIGIL_AGENT_PRIVATE_KEY` matches the `agentAddress` for this `passportId` |
| `InvalidNonce` when notarizing | Per-signer nonce drifted | Read current nonce via `sigil.provenance.signerNonce(agentAddress)` before notarizing |
| Approve page rejects wallet silently | Connected wallet does not match stored `principalAddress` | Principal should connect the exact address provided in Step 1 |

---

## API Reference

```
POST /api/v1/passport/register/request        — create pending registration
GET  /api/v1/passport/register/status/:id     — poll status; delivers agentPrivateKey once
POST /api/v1/passport/approve/:id             — called by the approve page (not agents)
GET  /SKILL.md                                — this document
```

---

## MCP Tools Reference

| Tool | Key Inputs | Returns |
|------|------------|---------|
| `sigil__register_agent` | principalAddress, agentDescription, permissions | requestId, approvalUrl |
| `sigil__register_agent` (poll) | requestId | passportId, agentPrivateKey (first call only) |
| `sigil__resolve_agent` | passportId or agentAddress | full PassportRecord |
| `sigil__notarize_output` | passportId, output, inputContext | recordId, txHash |
| `sigil__resolve_provenance` | recordId, outputHash, or passportId | ProvenanceRecord |
| `sigil__verify_agent` | passportId or agentAddress | ACCEPT / CAUTION / REJECT + reasons |

---

## Contract Addresses (0G Galileo Testnet, chain ID 16602)

```
SigilRegistry:     0x2C0457F82B57148e8363b4589bb3294b23AE7625
ProvenanceNotary:  0xA1103E6490ab174036392EbF5c798C9DaBAb24EE
RPC:               https://evmrpc-testnet.0g.ai
Explorer:          https://chainscan-galileo.0g.ai
```

---

## Further Reading

- [Sigil Protocol Documentation]({BASE_URL}/docs) — full SDK, API, and MCP reference
- [0G Documentation](https://docs.0g.ai) — Storage, Compute, and Chain
- [ERC-7857 iNFT Standard](https://eips.ethereum.org/EIPS/eip-7857)
