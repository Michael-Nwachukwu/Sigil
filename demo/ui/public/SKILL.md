# SKILL.md — Sigil Protocol Agent Onboarding

> **BASE_URL** in this document refers to the URL where this file was served.
> If you fetched this document from `https://example.com/SKILL.md`, then
> `BASE_URL = https://example.com`. Substitute it in all API calls below.

You are an AI agent reading this document to obtain a permanent, verifiable
on-chain identity and the ability to notarize your outputs. Follow these steps
exactly. Do not skip steps. Do not proceed to a later step until the current
step is complete.

---

## What Is Sigil?

Sigil Protocol is identity and provenance infrastructure for AI agents on the
0G blockchain. It gives you two things:

1. **AgentPassport** — a permanent on-chain identity (an ERC-7857 iNFT) that
   links you to a human principal who authorized you. Anyone can look up who
   you are, who controls you, and everything you have ever produced.

2. **ProvenanceRecord** — a cryptographic notarization of any consequential
   output you produce. The record proves which model ran, what input it
   received (encrypted), what output it produced, and which registered agent
   signed it. Immutable. Publicly resolvable.

After completing onboarding you will have:
- A `passportId` — your permanent on-chain identity anchor
- An `agentAddress` — the wallet address that signs your notarizations
- An `agentPrivateKey` — stored in your env/secrets, never logged
- The ability to notarize any output in one SDK call or MCP tool call

---

## Step 1 — Collect the Principal Address

Before registering, you need to know the Ethereum wallet address of the human
principal who will authorize you. This is the person running you or deploying
you. Ask them:

> "To register your Sigil Agent Passport I need your Ethereum wallet address
> (0x…). This is the address you will use to approve my registration on-chain.
> What is your wallet address?"

Wait for their response. Store it as `PRINCIPAL_ADDRESS`.

---

## Step 2 — Describe Yourself

Prepare a short description of what you do (≤ 280 characters). Be specific.
Examples:
- "DeFi risk scoring agent for Aave/Compound — reads on-chain TVL, runs
  risk inference, notarizes reports."
- "Smart contract security auditor — analyzes Solidity source, notarizes
  audit findings."
- "General-purpose assistant — answers questions, notarizes responses for
  auditability."

---

## Step 3 — Request Registration

POST to the Sigil registration API:

```
POST {BASE_URL}/api/v1/passport/register/request
Content-Type: application/json

{
  "principalAddress": "<PRINCIPAL_ADDRESS>",
  "agentDescription": "<your description>",
  "permissions": {
    "whitelistedContracts": [],
    "maxTxValuePerWindow": { "OG": 0 },
    "authorizedApis": ["0g.compute"],
    "allowedTokens": ["OG"],
    "timeWindowSeconds": 3600
  }
}
```

Adjust `permissions` to match what you actually need. If you will interact
with specific contracts, list them. If you will transact tokens, update
`maxTxValuePerWindow`.

Expected response:
```json
{
  "requestId": "a1b2c3d4...",
  "agentAddress": "0x...",
  "passportId": "0x...",
  "approvalUrl": "{BASE_URL}/approve/a1b2c3d4...",
  "expiresAt": 1746086400000
}
```

Store `requestId`, `agentAddress`, and `passportId` immediately. The request
expires in 24 hours if not approved.

---

## Step 4 — Ask the Principal to Approve

This is a required human-in-the-loop step. Say to the principal:

> "I have created a registration request for your AgentPassport. To complete
> my registration, please visit this URL, connect your wallet
> (`<PRINCIPAL_ADDRESS>`), and click 'Sign & Register Agent On-Chain':
>
> **<approvalUrl>**
>
> The page will ask you to sign a transaction on 0G Galileo Testnet. You may
> need to add the network to your wallet — the page will do this automatically.
> Please come back and tell me when you have approved."

Wait. Do not proceed until the principal tells you they have approved.

---

## Step 5 — Receive Your Private Key

Once the principal confirms approval, poll the status endpoint:

```
GET {BASE_URL}/api/v1/passport/register/status/<requestId>
```

Keep polling every 5 seconds until `status` is `"approved"`.

**CRITICAL:** The first response with `status: "approved"` contains
`agentPrivateKey`. This key is delivered **exactly once** and never returned
again. You must store it the moment you receive it.

```json
{
  "status": "approved",
  "passportId": "0x...",
  "agentAddress": "0x...",
  "agentPrivateKey": "0x...",
  "approvalTxHash": "0x..."
}
```

---

## Step 6 — Store Your Credentials

Store the following immediately and permanently:

| Key | Value | Where |
|-----|-------|-------|
| `SIGIL_PASSPORT_ID` | `0x...` (64 hex chars) | Config / env |
| `SIGIL_AGENT_ADDRESS` | `0x...` (40 hex chars) | Config / env |
| `SIGIL_AGENT_PRIVATE_KEY` | `0x...` (64 hex chars) | Secrets manager / env — **NEVER log this** |
| `SIGIL_APPROVAL_TX` | `0x...` | Notes / config |

Tell the principal:

> "Registration complete. Here is your agent's permanent identity:
>
> passportId: `<passportId>`
> agentAddress: `<agentAddress>`
> approvalTx: https://chainscan-galileo.0g.ai/tx/<approvalTxHash>
>
> Your agent private key has been stored securely in my environment. I will
> use it to sign all future notarizations. Please also store the passportId
> somewhere safe — it is your permanent reference to my identity."

---

## Step 7 — Verify Your Registration

Resolve your passport to confirm it is live on-chain:

```
GET {BASE_URL}/api/v1/passport/register/status/<requestId>
```

Or resolve directly via the UI:
`{BASE_URL}/passport` → paste your `passportId`

Or via the SDK:
```ts
const passport = await sigil.passport.resolve(passportId);
console.log(passport.active); // true
console.log(passport.principal); // your principal's address
```

---

## Step 8 — Register Your Slash Commands

If you are operating as a REPL or chat agent, register these commands in your
command handler:

| Command | What it does |
|---------|-------------|
| `/whoami` | Print your passportId, agentAddress, and principal |
| `/last` | Print the recordId, outputHash, and txHash of your most recent notarization |
| `/verify <recordId>` | Verify a provenance record on-chain |
| `/resolve <id>` | Resolve a passportId, recordId, agent address, or output hash |
| `/trace` | Toggle raw SDK trace mode (shows 0G Storage + Compute activity) |
| `/help` | List available commands |
| `/exit` | Quit |

---

## Step 9 — Notarize Your First Output

Every consequential output you produce should be notarized. Here is how:

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
  output: "...",         // your response / artifact
  artifactType: ArtifactType.GENERIC_REPORT,
});

// recordId and txHash are your permanent proof
console.log("recordId:", record.recordId);
console.log("txHash:", record.txHash);
```

### Via MCP Tool

If you have the Sigil MCP server configured, call:
```
sigil__notarize_output({
  passportId: "0x...",
  output: "your response text",
  inputContext: "the input prompt",
  artifactType: "GENERIC_REPORT"
})
```

This requires `SIGIL_AGENT_PRIVATE_KEY` set in the MCP server's env. The key
never travels over the wire.

---

## Step 10 — After Every Notarization

After notarizing, tell the principal (or log internally):

> "Output notarized on-chain.
> recordId: `<recordId>`
> Proof: https://chainscan-galileo.0g.ai/tx/<txHash>"

Anyone can resolve this record to verify the output came from your registered
passport.

---

## What to Do If Something Goes Wrong

| Situation | Action |
|-----------|--------|
| `requestId` not found (404) | The request expired (24h TTL). Start from Step 3. |
| `status: "pending"` after principal said they approved | Wait 30 seconds and poll again. On-chain confirmation can take up to 60s. |
| Key already delivered (no `agentPrivateKey` in response) | You missed the single delivery. Contact the principal — they can re-register a new agent by starting from Step 3 with a new request. The old passportId will remain on-chain but that agentPrivateKey is unrecoverable. |
| Rate limit (429) | Wait 1 hour and retry. Max 5 requests per IP per hour. |
| `NotAuthorizedSigner` when notarizing | Your `SIGIL_AGENT_PRIVATE_KEY` does not match the `agentAddress` registered on this passport. Check that you are using the key from the registration that matches this passportId. |
| `InvalidNonce` | Your agent nonce drifted. Read the current nonce via `sigil.provenance.signerNonce(agentAddress)` before notarizing. |
| Principal connected wrong wallet on approve page | The page silently rejects wrong wallets. Ask the principal to connect `<PRINCIPAL_ADDRESS>` specifically. |

---

## Contract Addresses (0G Galileo Testnet, chain ID 16602)

```
SigilRegistry:     0x2C0457F82B57148e8363b4589bb3294b23AE7625
ProvenanceNotary:  0xA1103E6490ab174036392EbF5c798C9DaBAb24EE
RPC:               https://evmrpc-testnet.0g.ai
Explorer:          https://chainscan-galileo.0g.ai
```

---

## API Reference (Quick)

```
POST /api/v1/passport/register/request   — create pending registration
GET  /api/v1/passport/register/status/:requestId — poll status / receive key
POST /api/v1/passport/approve/:requestId — (called by approve page, not agents)
GET  /SKILL.md                           — this document
```

---

## MCP Tools Reference (Quick)

| Tool | Input | Returns |
|------|-------|---------|
| `sigil__register_agent` | principalAddress, agentDescription, permissions | requestId, approvalUrl |
| `sigil__register_agent` (poll) | requestId | passportId, agentPrivateKey (once) |
| `sigil__resolve_agent` | passportId or agentAddress | full PassportRecord |
| `sigil__notarize_output` | passportId, output, inputContext | recordId, txHash |
| `sigil__resolve_provenance` | recordId, outputHash, or passportId | ProvenanceRecord |
| `sigil__verify_agent` | passportId or agentAddress | ACCEPT / CAUTION / REJECT |

---

## Resolver UI

Resolve any identity or record at:
`{BASE_URL}/passport`

Paste a `passportId`, `recordId`, agent address, or output hash. The UI reads
live from 0G Chain with no authentication.
