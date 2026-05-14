"use client";

import { useEffect, useState } from "react";

const SDK_TABS = [
  {
    id: "register",
    label: "Register",
    code: `import { SigilClient } from 'sigil-protocol';

const sigil = new SigilClient({
  rpcUrl:           process.env.ZERO_G_RPC_URL,
  registryAddress:  process.env.SIGIL_REGISTRY_ADDRESS,
  notaryAddress:    process.env.PROVENANCE_NOTARY_ADDRESS,
  signer:           principalWallet,
});

const { passportId, agentPrivateKey, agentAddress } =
  await sigil.passport.register({
    principal:        principalWallet.address,
    agentDescription: 'DeFi risk scoring agent',
    permissions: {
      whitelistedContracts: ['0x...'],
      maxTxValuePerWindow:  { USDC: 5000, ETH: 2 },
      authorizedApis:       ['uniswap.api', '0g.compute'],
      timeWindowSeconds:    3600,
    },
  });

// passportId:      0x4a2c...83ca
// agentPrivateKey: [returned once - store safely]`,
  },
  {
    id: "notarize",
    label: "Notarize",
    code: `// Agent-side - uses its own private key, no principal interaction
const agentSigil = new SigilClient({
  rpcUrl:          process.env.ZERO_G_RPC_URL,
  registryAddress: process.env.SIGIL_REGISTRY_ADDRESS,
  notaryAddress:   process.env.PROVENANCE_NOTARY_ADDRESS,
  signer:          agentWallet, // built from SIGIL_AGENT_PRIVATE_KEY
});

const record = await agentSigil.provenance.notarize({
  passportId,
  inferenceReceipt, // sealed TEE receipt from 0G Compute
  inputContext,     // hashed + encrypted -> 0G Storage KV
  output,           // hashed -> on-chain
  artifactType: ArtifactType.RISK_ASSESSMENT,
});

// recordId:   0xa891...e327
// notarizeTx: 0x916e...c8c4e
// TEE sealed: true`,
  },
  {
    id: "resolve",
    label: "Resolve",
    code: `// Read-open - no auth required
const identity = await sigil.passport.resolve(passportId);
// identity.principal:       0x7FBb...018f
// identity.agentAddress:    0x472F...A1
// identity.reputationScore: 847
// identity.permissions:     { maxTxValue: {USDC:5000,ETH:2}, ... }

// Backward lookup - artifact -> agent -> principal
const artifact = await sigil.provenance.resolve(recordId);
// artifact.passportId:   0x4a2c...83ca
// artifact.outputHash:   0x9a4f...22b1
// artifact.modelId:      'qwen/qwen-2.5-7b-instruct'
// artifact.verified:     true

// Or resolve by output hash directly
const rec = await sigil.provenance.resolveByOutput(outputHash);`,
  },
] as const;

function tokenizeCode(line: string) {
  const rules = [
    { re: /^(\/\/.*)$/, color: "var(--text-3)" },
    {
      re: /^('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/,
      color: "var(--ok)",
    },
    {
      re: /^(import|from|const|let|await|new|return|export|true|false)\b/,
      color: "var(--accent)",
    },
    { re: /^(process|env|ArtifactType)\b/, color: "var(--accent-2)" },
    { re: /^\b([0-9]+)\b/, color: "var(--sealed)" },
    { re: /^([a-zA-Z_$][a-zA-Z0-9_$]*)/, color: "var(--text)" },
    { re: /^([\s\S])/, color: "var(--text-3)" },
  ];

  const tokens: Array<{ text: string; color: string }> = [];
  let remaining = line;

  while (remaining.length > 0) {
    let matched = false;
    for (const rule of rules) {
      const result = remaining.match(rule.re);
      if (result) {
        tokens.push({ text: result[0], color: rule.color });
        remaining = remaining.slice(result[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      tokens.push({ text: remaining[0], color: "var(--text)" });
      remaining = remaining.slice(1);
    }
  }

  return tokens;
}

export function DualWalletDiagram() {
  const [step, setStep] = useState(0);
  const steps = [
    { label: "Register", desc: "Principal signs once, delegating a fresh agent keypair." },
    {
      label: "Act",
      desc: "Agent signs every subsequent action autonomously - principal never re-signs.",
    },
    {
      label: "Notarize",
      desc: "Agent self-signs the inference receipt. ProvenanceRecord links agent -> principal.",
    },
  ];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((value) => (value + 1) % steps.length);
    }, 2800);
    return () => window.clearInterval(timer);
  }, [steps.length]);

  return (
    <div style={{ position: "relative", padding: "40px 0" }}>
      <div className="dual-wallet-diagram">
        <div
          style={{
            width: 200,
            border: "1px solid var(--border-strong)",
            borderRadius: 4,
            background: "var(--bg-raised)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--accent)",
                boxShadow: "0 0 6px var(--accent)",
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                color: "var(--text-2)",
                textTransform: "uppercase",
              }}
            >
              Principal
            </span>
          </div>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>
              Human-controlled
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)" }}>
              0x7FBb...018f
            </div>
            <div
              style={{
                marginTop: 6,
                padding: "6px 10px",
                background: "var(--accent-dim)",
                border: "1px solid var(--accent)",
                borderRadius: 2,
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                color: "var(--accent)",
                letterSpacing: "0.06em",
                textAlign: "center",
              }}
            >
              {step === 0 ? "-> signs register()" : "idle after register"}
            </div>
          </div>
        </div>

        <div
          className="dual-wallet-arrow"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 120,
            paddingTop: 38,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: step === 0 ? "var(--accent)" : "var(--text-3)",
              letterSpacing: "0.06em",
              marginBottom: 6,
              transition: "color .4s",
            }}
          >
            {step === 0 ? "delegates" : step === 1 ? "authorized" : "anchored"}
          </div>
          <svg width="80" height="16" viewBox="0 0 80 16" fill="none">
            <path
              d="M0 8h72M64 2l8 6-8 6"
              stroke={step === 0 ? "#8b5cf6" : "var(--border-strong)"}
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ transition: "stroke .4s" }}
            />
          </svg>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: "var(--text-3)",
              letterSpacing: "0.06em",
              marginTop: 6,
            }}
          >
            once
          </div>
        </div>

        <div
          style={{
            width: 200,
            border: "1px solid var(--border-strong)",
            borderRadius: 4,
            background: "var(--bg-raised)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: step > 0 ? "var(--ok)" : "var(--border-strong)",
                boxShadow: step > 0 ? "0 0 6px var(--ok)" : "none",
                transition: "background .4s,box-shadow .4s",
                animation: step > 0 ? "pulse-dot 2s ease infinite" : "none",
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                color: "var(--text-2)",
                textTransform: "uppercase",
              }}
            >
              Agent
            </span>
          </div>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>
              Autonomous signer
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: step > 0 ? "var(--ok)" : "var(--text-3)",
                transition: "color .4s",
              }}
            >
              0x472F...A1
            </div>
            <div
              style={{
                marginTop: 6,
                padding: "6px 10px",
                background: step > 0 ? "rgba(34,197,94,0.08)" : "var(--bg)",
                border: `1px solid ${step > 0 ? "var(--ok)" : "var(--border)"}`,
                borderRadius: 2,
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                color: step > 0 ? "var(--ok)" : "var(--text-3)",
                letterSpacing: "0.06em",
                textAlign: "center",
                transition: "all .4s",
              }}
            >
              {step === 0 ? "awaiting registration" : step === 1 ? "-> signs every action" : "-> signs notarize()"}
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 28, textAlign: "center" }}>
        <div style={{ display: "inline-flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {steps.map((item, index) => (
            <button
              key={item.label}
              onClick={() => setStep(index)}
              style={{
                padding: "4px 12px",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.06em",
                border: `1px solid ${step === index ? "var(--accent)" : "var(--border)"}`,
                background: step === index ? "var(--accent-dim)" : "transparent",
                color: step === index ? "var(--accent)" : "var(--text-3)",
                borderRadius: 2,
                cursor: "pointer",
                transition: "all .2s",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 13.5,
            color: "var(--text-2)",
            lineHeight: 1.7,
            maxWidth: 460,
            margin: "0 auto",
          }}
        >
          {steps[step].desc}
        </p>
      </div>
    </div>
  );
}

export function DualWalletSection() {
  return (
    <section className="section" id="dual-wallet">
      <div className="page-wrap">
        <div className="split-2-col">
          <div>
            <div
              style={{
                marginBottom: 14,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-3)",
              }}
            >
              <span style={{ width: 20, height: 1, background: "var(--accent)", display: "inline-block" }} />
              The Dual Wallet Model
            </div>
            <h2
              className="display"
              style={{
                fontSize: "clamp(32px,3.5vw,48px)",
                fontWeight: 700,
                fontStyle: "normal",
                letterSpacing: "var(--tracking-tight)",
                lineHeight: "var(--leading-tight)",
                marginBottom: 20,
              }}
            >
              Authorize once.
              <br />
              Agent acts forever.
            </h2>
            <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.8, marginBottom: 20 }}>
              The principal - a human-controlled wallet - authorizes a fresh agent keypair
              exactly once at registration time. After that, the agent signs every action
              and every notarization autonomously.
            </p>
            <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.8, marginBottom: 28 }}>
              {
                "The chain always resolves backward: any artifact -> agent address -> passportId -> principal. Accountability is always one hop away, even when the agent acted completely autonomously."
              }
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                [
                  "AgentPassport",
                  "ERC-7857 iNFT soulbound to the principal - the permanent identity anchor.",
                  "tag-accent",
                ],
                [
                  "ProvenanceRecord",
                  "On-chain notarization sealed by 0G Compute - cryptographic model-output binding.",
                  "tag-sealed",
                ],
                [
                  "Reputation [0-1000]",
                  "Deterministic score updated on every attestation. Read-open, no auth needed.",
                  "tag-ok",
                ],
              ].map(([tag, description, cls]) => (
                <div key={tag} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <span className={`tag ${cls}`} style={{ flexShrink: 0, marginTop: 2 }}>
                    {tag}
                  </span>
                  <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.65 }}>
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <DualWalletDiagram />
          </div>
        </div>
      </div>
    </section>
  );
}

function SdkHighlight({ code }: { code: string }) {
  const lines = code.split("\n");

  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12.5,
        lineHeight: 1.8,
        whiteSpace: "pre",
        overflowX: "auto",
        textAlign: "left",
      }}
    >
      {lines.map((line, index) => (
        <div key={`${line}-${index}`} style={{ minHeight: line ? undefined : "0.6em" }}>
          {line
            ? tokenizeCode(line).map((token, tokenIndex) => (
                <span key={`${token.text}-${tokenIndex}`} style={{ color: token.color }}>
                  {token.text}
                </span>
              ))
            : null}
        </div>
      ))}
    </div>
  );
}

export function SDKSection() {
  const [tab, setTab] = useState<(typeof SDK_TABS)[number]["id"]>("register");
  const active = SDK_TABS.find((item) => item.id === tab) ?? SDK_TABS[0];

  return (
    <section className="section" id="sdk">
      <div className="page-wrap">
        <div
          style={{
            marginBottom: 14,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--text-3)",
          }}
        >
          <span style={{ width: 20, height: 1, background: "var(--accent)", display: "inline-block" }} />
          TypeScript SDK
        </div>
        <div className="split-2-col">
          <div>
            <h2
              className="display"
              style={{
                fontSize: "clamp(32px,3.5vw,48px)",
                fontWeight: 700,
                fontStyle: "normal",
                letterSpacing: "var(--tracking-tight)",
                lineHeight: "var(--leading-tight)",
                marginBottom: 20,
              }}
            >
              Three calls.
              <br />
              Full provenance.
            </h2>
            <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.8, marginBottom: 20 }}>
              One package. Register an agent, notarize its outputs, resolve any identity or
              artifact - all against the live 0G testnet. No mocks.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                [
                  "register()",
                  "Mints an ERC-7857 iNFT. Encrypts permission manifest -> 0G KV. Returns passportId + agentPrivateKey (shown once).",
                ],
                [
                  "notarize()",
                  "Agent self-signs. Seals 0G Compute receipt on-chain. Returns recordId.",
                ],
                [
                  "resolve()",
                  "Read-open. Resolves passportId -> identity or recordId -> artifact -> agent -> principal.",
                ],
              ].map(([fn, description]) => (
                <div
                  key={fn}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "12px 14px",
                    background: "var(--bg-raised)",
                    border: "1px solid var(--border)",
                    borderRadius: 3,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--accent)",
                      flexShrink: 0,
                      paddingTop: 1,
                    }}
                  >
                    {fn}
                  </span>
                  <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.65 }}>
                    {description}
                  </p>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 20,
                padding: "10px 14px",
                background: "var(--code-bg)",
                border: "1px solid var(--border)",
                borderRadius: 3,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-2)",
              }}
            >
              npm install sigil-protocol
            </div>
          </div>

          <div>
            <div style={{ display: "flex", marginBottom: 0, gap: 2, flexWrap: "wrap" }}>
              {SDK_TABS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  style={{
                    padding: "7px 16px",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    letterSpacing: "0.05em",
                    cursor: "pointer",
                    border: "1px solid var(--border)",
                    borderBottom:
                      tab === item.id ? "1px solid var(--bg-raised)" : "1px solid var(--border)",
                    background: tab === item.id ? "var(--bg-raised)" : "var(--code-bg)",
                    color: tab === item.id ? "var(--text)" : "var(--text-3)",
                    borderRadius: "3px 3px 0 0",
                    transition: "all .2s",
                    position: "relative",
                    zIndex: tab === item.id ? 2 : 1,
                  }}
                >
                  {item.label}
                </button>
              ))}
              <div
                style={{
                  flex: 1,
                  borderBottom: "1px solid var(--border)",
                  height: 1,
                  marginTop: "auto",
                }}
              />
            </div>
            <div
              style={{
                background: "var(--bg-raised)",
                border: "1px solid var(--border)",
                borderTop: "none",
                borderRadius: "0 3px 3px 3px",
                padding: "24px 28px",
                minHeight: 340,
                position: "relative",
                zIndex: 1,
              }}
            >
              <SdkHighlight code={active.code} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
