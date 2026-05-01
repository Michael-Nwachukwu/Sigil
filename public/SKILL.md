# SKILL.md — Sigil Protocol

This document is the local onboarding contract for agents that want a Sigil
identity today.

Important current status:

- This repo ships a real SDK and a static `SKILL.md` document.
- It does **not** yet ship the hosted Phase 5b `/skill.md` registration API.
- It does **not** yet ship the MCP server described in the long-term roadmap.

So the integration path available right now is:

1. use the SDK locally
2. register an `AgentPassport`
3. persist your public credential
4. notarize outputs with the agent wallet

---

## Quick Start

Install:

```bash
pnpm add sigil-protocol ethers
```

Register a new agent:

```ts
import { Wallet } from "ethers";
import { SigilClient } from "sigil-protocol";

const principal = new Wallet(process.env.ZERO_G_PRIVATE_KEY!);

const sigil = new SigilClient({
  rpcUrl: process.env.ZERO_G_RPC_URL!,
  chainId: Number(process.env.ZERO_G_CHAIN_ID ?? "16602"),
  registryAddress: process.env.SIGIL_REGISTRY_ADDRESS!,
  notaryAddress: process.env.PROVENANCE_NOTARY_ADDRESS!,
  signer: principal,
  computeDefaultModel:
    process.env.ZERO_G_COMPUTE_DEFAULT_MODEL ?? "qwen/qwen-2.5-7b-instruct",
});

const registration = await sigil.passport.register({
  agentDescription: "Generic prompt-driven agent",
  permissions: {
    whitelistedContracts: [],
    maxTxValuePerWindow: { OG: 0 },
    authorizedApis: ["0g.compute"],
    allowedTokens: ["OG"],
    timeWindowSeconds: 3600,
  },
  persistAs: "self",
  credentialContext: {
    chainId: Number(process.env.ZERO_G_CHAIN_ID ?? "16602"),
    notaryAddress: process.env.PROVENANCE_NOTARY_ADDRESS as `0x${string}`,
    rpcUrl: process.env.ZERO_G_RPC_URL,
  },
});

console.log("passportId:", registration.passportId);
console.log("agentAddress:", registration.agentAddress);
console.log("agentPrivateKey:", registration.agentPrivateKey);
```

What you must store immediately:

- `passportId`
- `agentAddress`
- `agentPrivateKey`

The SDK returns the private key once. The credential file written by
`persistAs` intentionally stores only public identity metadata.

---

## What Gets Stored Where

On-chain:

- `passportId`
- `principal`
- `agentAddress`
- manifest hash
- reputation counters
- provenance counters

In `~/.sigil/credentials/<name>.json`:

- `passportId`
- `agentAddress`
- `principal`
- contract addresses
- chain id
- registration metadata

Not stored by Sigil:

- `agentPrivateKey`

You must put the agent private key in your own secrets manager or runtime env.

---

## Reporting Your Identity Later

Your runtime can always answer identity questions locally:

```ts
import { readCredential } from "sigil-protocol";

const me = readCredential("self");
console.log(me.passportId);
console.log(me.agentAddress);
console.log(me.principal);
```

Or from shell:

```bash
pnpm exec sigil-agent whoami self
pnpm exec sigil-agent list
```

---

## Notarizing An Output

Build an agent-side client with the agent wallet:

```ts
import { Wallet } from "ethers";
import { ArtifactType, SigilClient } from "sigil-protocol";

const agentWallet = new Wallet(process.env.SIGIL_AGENT_PRIVATE_KEY!);

const agentSigil = new SigilClient({
  rpcUrl: process.env.ZERO_G_RPC_URL!,
  chainId: Number(process.env.ZERO_G_CHAIN_ID ?? "16602"),
  registryAddress: process.env.SIGIL_REGISTRY_ADDRESS!,
  notaryAddress: process.env.PROVENANCE_NOTARY_ADDRESS!,
  signer: agentWallet,
  computeDefaultModel:
    process.env.ZERO_G_COMPUTE_DEFAULT_MODEL ?? "qwen/qwen-2.5-7b-instruct",
});

const record = await agentSigil.provenance.notarize({
  passportId: me.passportId,
  inferenceReceipt,
  inputContext: JSON.stringify({
    task: "example",
    prompt: "user prompt here",
  }),
  output: "model output here",
  artifactType: ArtifactType.GENERIC_REPORT,
});

console.log("recordId:", record.recordId);
console.log("txHash:", record.txHash);
```

The consumer can later resolve:

- by `recordId`
- by `outputHash`
- by `passportId`
- by `agentAddress`

---

## Minimum Environment Variables

- `ZERO_G_RPC_URL`
- `ZERO_G_CHAIN_ID`
- `ZERO_G_PRIVATE_KEY`
- `SIGIL_REGISTRY_ADDRESS`
- `PROVENANCE_NOTARY_ADDRESS`

For agent runtimes:

- `SIGIL_AGENT_PRIVATE_KEY`

Optional:

- `ZERO_G_COMPUTE_DEFAULT_MODEL`
- `SIGIL_KEEPER_RELAY_PRIVATE_KEY` for demo auto-attest

---

## What This Runtime Can And Cannot Do

Today Sigil gives an agent:

- portable identity
- agent-side notarization
- output provenance
- local credential discoverability

Today Sigil does **not** automatically give an agent:

- wallet transfer tools
- arbitrary contract-write powers
- hosted registration API access
- MCP tools

Those are separate runtime capabilities that must be deliberately attached.

---

## Common Errors

- `PassportNotFound()`:
  you are resolving an unknown passportId on this network
- `RecordNotFound()`:
  the recordId does not exist on this network
- `NotAuthorizedSigner()`:
  you tried to notarize from a wallet that is not the registered agent
- `InvalidNonce()`:
  the agent nonce drifted; read signer nonce before notarizing
- manifest decrypt fails:
  you are not using the recorded principal wallet

---

## Current Onboarding Surface Status

Available now:

- SDK-based local integration
- static `SKILL.md`
- Next.js `/skill-md` documentation page

Not available yet:

- hosted `GET /skill.md`
- `POST /v1/passport/register/request`
- `GET /v1/passport/register/status/:requestId`
- MCP `register/resolve/notarize/verify` tools

Those remain the next onboarding milestone after Phase 5 polish.
