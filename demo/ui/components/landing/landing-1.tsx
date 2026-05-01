"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TerminalLine = {
  t: number;
  text: string;
  role?: "user" | "agent" | "system" | "ok";
};

const CURL_SEQ: TerminalLine[] = [
  {
    t: 0,
    role: "user",
    text: "preview: future hosted onboarding flow via https://api.sigil.protocol/skill.md",
  },
  { t: 1500, role: "agent", text: "Reading planned hosted skill document..." },
  { t: 3100, role: "agent", text: "Reading 3 registration steps." },
  { t: 4700, role: "agent", text: "POST /v1/passport/register/request" },
  { t: 6500, role: "system", text: "<- 200   requestId: req_9k2xB7m" },
  { t: 8300, role: "agent", text: "Waiting for principal approval..." },
  { t: 10500, role: "system", text: "<- approved" },
  { t: 11900, role: "agent", text: "Collecting credentials..." },
  { t: 13300, role: "ok", text: "ok  passportId: 0x4a2c...83ca" },
  { t: 14700, role: "ok", text: "ok  AgentPassport minted · 0G Galileo" },
  { t: 16100, role: "ok", text: "ok  Manifest sealed · 0G Storage KV" },
];

const SDK_LINES: TerminalLine[] = [
  { t: 0, text: "import { SigilClient } from 'sigil-protocol';" },
  { t: 520, text: "" },
  { t: 840, text: "const sigil = new SigilClient({" },
  { t: 1280, text: "  rpcUrl: process.env.ZERO_G_RPC_URL," },
  { t: 1720, text: "  signer: principalWallet," },
  { t: 2140, text: "});" },
  { t: 2580, text: "" },
  { t: 2980, text: "const { passportId, agentPrivateKey } =" },
  { t: 3460, text: "  await sigil.passport.register({" },
  { t: 3940, text: "    principal: principalWallet.address," },
  { t: 4420, text: "    agentDescription: 'DeFi risk scorer'," },
  { t: 4900, text: "    permissions: { maxTxValue: 5000 }," },
  { t: 5400, text: "  });" },
  { t: 5900, text: "" },
  { t: 6380, text: "// -> passportId:      0x4a2c...83ca" },
  { t: 6940, text: "// -> agentPrivateKey: [store safely - shown once]" },
];

const MCP_LINES: TerminalLine[] = [
  { t: 0, text: "$ preview: codex mcp add sigil --transport sse https://api.sigil.protocol/mcp" },
  { t: 720, text: "" },
  { t: 1100, text: "Previewing future remote Sigil MCP transport..." },
  { t: 1800, text: "Authenticated transport · policy = remote-safe" },
  { t: 2500, text: "Discovered tools:" },
  { t: 3100, text: "  sigil__register_agent()" },
  { t: 3600, text: "  sigil__resolve_agent()" },
  { t: 4100, text: "  sigil__resolve_provenance()" },
  { t: 4600, text: "  sigil__verify_agent()" },
  { t: 5300, text: "" },
  { t: 5800, text: "> notarize_output is hidden on remote transport" },
  { t: 6400, text: "> local agent key stays on the agent runtime" },
  { t: 7080, text: "Phase 5b target · 4 remote-safe tools exposed" },
];

function highlightLine(line: string) {
  const rules = [
    { re: /^(\/\/.*)$/, color: "var(--text-3)" },
    { re: /^('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/, color: "var(--ok)" },
    {
      re: /^(import|from|const|let|await|new|return|export)\b/,
      color: "var(--accent)",
    },
    { re: /^(process|env)\b/, color: "var(--accent-2)" },
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

  return tokens.map((token, index) => (
    <span key={`${token.text}-${index}`} style={{ color: token.color }}>
      {token.text}
    </span>
  ));
}

export function HeroTerminal() {
  const [tab, setTab] = useState<"curl" | "sdk" | "mcp">("curl");
  const [curlLines, setCurlLines] = useState<TerminalLine[]>([]);
  const [sdkLines, setSdkLines] = useState<TerminalLine[]>([]);
  const [mcpLines, setMcpLines] = useState<TerminalLine[]>([]);
  const [cursor, setCursor] = useState(true);
  const timeouts = useRef<number[]>([]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const autoRef = useRef<number | null>(null);
  const TAB_ORDER: Array<"curl" | "sdk" | "mcp"> = ["curl", "sdk", "mcp"];
  const HOLD_AFTER_ANIMATION = 10000;
  const ANIMATION_DURATION = {
    curl: CURL_SEQ[CURL_SEQ.length - 1]?.t ?? 0,
    sdk: SDK_LINES[SDK_LINES.length - 1]?.t ?? 0,
    mcp: MCP_LINES[MCP_LINES.length - 1]?.t ?? 0,
  };

  const scrollToBottom = () => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  };

  const clearTimers = () => {
    timeouts.current.forEach((timeout) => window.clearTimeout(timeout));
    timeouts.current = [];
  };

  const runCurl = useCallback(() => {
    clearTimers();
    setCurlLines(CURL_SEQ[0] ? [CURL_SEQ[0]] : []);
    setSdkLines([]);
    setMcpLines([]);
    CURL_SEQ.slice(1).forEach((line) => {
      const id = window.setTimeout(() => {
        setCurlLines((previous) => [...previous, line]);
        scrollToBottom();
      }, line.t);
      timeouts.current.push(id);
    });
  }, []);

  const runSdk = useCallback(() => {
    clearTimers();
    setSdkLines([]);
    setCurlLines([]);
    setMcpLines([]);
    SDK_LINES.forEach((line) => {
      const id = window.setTimeout(() => {
        setSdkLines((previous) => [...previous, line]);
        scrollToBottom();
      }, line.t);
      timeouts.current.push(id);
    });
  }, []);

  const runMcp = useCallback(() => {
    clearTimers();
    setSdkLines([]);
    setCurlLines([]);
    setMcpLines([]);
    MCP_LINES.forEach((line) => {
      const id = window.setTimeout(() => {
        setMcpLines((previous) => [...previous, line]);
        scrollToBottom();
      }, line.t);
      timeouts.current.push(id);
    });
  }, []);

  const switchTab = useCallback(
    (nextTab: "curl" | "sdk" | "mcp") => {
      if (autoRef.current) {
        window.clearTimeout(autoRef.current);
      }

      setTab(nextTab);
    },
    [],
  );

  useEffect(() => {
    const blink = window.setInterval(() => {
      setCursor((value) => !value);
    }, 530);

    return () => {
      clearTimers();
      if (autoRef.current) {
        window.clearTimeout(autoRef.current);
      }
      window.clearInterval(blink);
    };
  }, []);

  useEffect(() => {
    if (tab === "curl") {
      runCurl();
    } else if (tab === "sdk") {
      runSdk();
    } else {
      runMcp();
    }

    const currentIndex = TAB_ORDER.indexOf(tab);
    const nextTab = TAB_ORDER[(currentIndex + 1) % TAB_ORDER.length];
    autoRef.current = window.setTimeout(() => {
      setTab(nextTab);
    }, ANIMATION_DURATION[tab] + HOLD_AFTER_ANIMATION);

    return () => {
      if (autoRef.current) {
        window.clearTimeout(autoRef.current);
      }
    };
  }, [tab, runCurl, runSdk, runMcp]);

  const roleStyle = {
    user: {
      justifyContent: "flex-end",
      bg: "var(--accent-dim)",
      color: "var(--text)",
      border: "1px solid var(--border-strong)",
    },
    system: {
      justifyContent: "flex-start",
      bg: "var(--bg-elevated)",
      color: "var(--text-2)",
      border: "1px solid var(--border)",
    },
    agent: {
      justifyContent: "flex-start",
      bg: "var(--bg-raised)",
      color: "var(--text)",
      border: "1px solid var(--border)",
    },
    ok: {
      justifyContent: "flex-start",
      bg: "rgba(34,197,94,0.07)",
      color: "var(--ok)",
      border: "1px solid rgba(34,197,94,0.2)",
    },
  } as const;

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 2, marginBottom: 0 }}>
        {[
          ["curl", "curl / SKILL.md"],
          ["sdk", "TypeScript SDK"],
          ["mcp", "MCP Connector"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => switchTab(key as "curl" | "sdk" | "mcp")}
            style={{
              padding: "8px 18px",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.06em",
              cursor: "pointer",
              border: "1px solid var(--border)",
              borderBottom:
                tab === key ? "1px solid var(--bg-raised)" : "1px solid var(--border)",
              background: tab === key ? "var(--bg-raised)" : "var(--code-bg)",
              color: tab === key ? "var(--text)" : "var(--text-3)",
              borderRadius: "4px 4px 0 0",
              transition: "all .2s",
              position: "relative",
              zIndex: tab === key ? 2 : 1,
            }}
          >
            {label}
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
          borderRadius: "0 4px 4px 4px",
          overflow: "hidden",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "var(--code-bg)",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#ff5f57",
              display: "inline-block",
              opacity: 0.8,
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#febc2e",
              display: "inline-block",
              opacity: 0.8,
            }}
          />
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#28c840",
              display: "inline-block",
              opacity: 0.8,
            }}
          />
          <span
            style={{
              marginLeft: 12,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-3)",
              letterSpacing: "0.06em",
            }}
          >
            {tab === "curl"
              ? "sigil-agent · curl onboarding"
              : tab === "sdk"
                ? "sigil-agent · TypeScript"
                : "sigil-agent · MCP transport"}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--ok)",
                animation: "pulse-dot 2s ease infinite",
              }}
            />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>
              0G Galileo · 16602
            </span>
          </div>
        </div>

        <div
          ref={bodyRef}
          style={{
            padding: "20px 22px",
            minHeight: 280,
            maxHeight: 340,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: tab === "curl" ? 10 : 0,
          }}
        >
          {tab === "curl"
            ? curlLines.map((line, index) => {
                const style = roleStyle[line.role ?? "system"];
                return (
                  <div
                    key={`${line.text}-${index}`}
                    style={{
                      display: "flex",
                      justifyContent: style.justifyContent,
                      animation: "fade-up .18s ease both",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "82%",
                        padding: line.role === "user" ? "10px 14px 11px" : "9px 13px 10px",
                        borderRadius: line.role === "user" ? "18px 18px 6px 18px" : "18px 18px 18px 6px",
                        background: style.bg,
                        border: style.border,
                        color: style.color,
                        fontFamily:
                          line.role === "ok" ? "var(--font-mono)" : "var(--font-body)",
                        fontSize: line.role === "ok" ? 12 : 13.5,
                        lineHeight: 1.5,
                        boxShadow: line.role === "user" ? "0 14px 28px rgba(0,0,0,0.14)" : "none",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 9,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: line.role === "user" ? "var(--accent-2)" : "var(--text-3)",
                          marginBottom: 5,
                        }}
                      >
                        {line.role === "user"
                          ? "Principal Prompt"
                          : line.role === "agent"
                            ? "Agent Runtime"
                            : line.role === "ok"
                              ? "Sigil Status"
                              : "Protocol Response"}
                      </div>
                      {line.text}
                    </div>
                  </div>
                );
              })
            : tab === "sdk"
              ? (
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    lineHeight: 1.8,
                    color: "var(--text-2)",
                    textAlign: "left",
                  }}
                >
                  {sdkLines.map((line, index) => (
                    <div
                      key={`${line.text}-${index}`}
                      style={{
                        minHeight: line.text ? undefined : "0.5em",
                        animation: "fade-up .12s ease both",
                      }}
                    >
                      {line.text ? highlightLine(line.text) : null}
                    </div>
                  ))}
                </div>
              )
              : (
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    lineHeight: 1.82,
                    color: "var(--text-2)",
                    textAlign: "left",
                  }}
                >
                  {mcpLines.map((line, index) => (
                    <div
                      key={`${line.text}-${index}`}
                      style={{
                        minHeight: line.text ? undefined : "0.5em",
                        animation: "fade-up .12s ease both",
                      }}
                    >
                      {line.text ? highlightLine(line.text) : null}
                    </div>
                  ))}
                </div>
              )}

          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 14,
              background: "var(--accent)",
              opacity: cursor ? 0.8 : 0,
              borderRadius: 1,
              marginTop: 4,
            }}
          />
        </div>
      </div>

      <p
        style={{
          marginTop: 10,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-3)",
          textAlign: "center",
          letterSpacing: "0.06em",
        }}
      >
        {"curl -> sdk -> mcp · rotates automatically every cycle"}
      </p>
    </div>
  );
}

export function LandingHero() {
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDrawn(true), 200);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <section
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "100px 52px 80px",
        position: "relative",
        overflow: "hidden",
        textAlign: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px)",
          backgroundSize: "80px 80px",
          opacity: 0.35,
          pointerEvents: "none",
          maskImage: "radial-gradient(ellipse 70% 90% at 50% 20%,black 20%,transparent 75%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -120,
          left: "50%",
          transform: "translateX(-50%)",
          width: 800,
          height: 600,
          background: "radial-gradient(ellipse,var(--accent-dim) 0%,transparent 60%)",
          pointerEvents: "none",
          opacity: drawn ? 1 : 0,
          transition: "opacity 1.2s ease",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 860,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0,
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 32,
            padding: "5px 14px",
            border: "1px solid var(--border-strong)",
            borderRadius: 2,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--text-2)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--ok)",
              boxShadow: "0 0 6px var(--ok)",
              animation: "pulse-dot 2s ease infinite",
            }}
          />
          0G Galileo Testnet · Chain 16602 · ETHGlobal Open Agents
        </div>

        <h1
          className="display"
          style={{
            fontSize: "clamp(48px,7vw,88px)",
            fontWeight: 700,
            fontStyle: "normal",
            lineHeight: 1.05,
            letterSpacing: "var(--tracking-tight)",
            marginBottom: 24,
            maxWidth: 760,
          }}
        >
          A passport for every
          <br />
          autonomous agent.
        </h1>

        <p
          style={{
            fontSize: 17,
            color: "var(--text-2)",
            lineHeight: 1.8,
            maxWidth: 500,
            marginBottom: 40,
            fontWeight: 400,
          }}
        >
          Verifiable identity and provenance for every AI output - anchored on-chain,
          sealed by 0G Compute, accountable to a human principal.
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 64,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <a href="/skill-md" className="btn btn-primary">
            Read the docs
          </a>
          <a
            href="https://github.com/sigil-protocol"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            View on GitHub
          </a>
        </div>

        <HeroTerminal />

        <div
          style={{
            display: "flex",
            gap: 40,
            paddingTop: 32,
            marginTop: 24,
            borderTop: "1px solid var(--border)",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {[
            [
              "Registry",
              "0x2C04...7625",
              "https://chainscan-galileo.0g.ai/address/0x2C0457F82B57148e8363b4589bb3294b23AE7625",
            ],
            [
              "Notary",
              "0xA110...24EE",
              "https://chainscan-galileo.0g.ai/address/0xA1103E6490ab174036392EbF5c798C9DaBAb24EE",
            ],
            ["Network", "0G Galileo · 16602", null],
          ].map(([label, value, href]) => (
            <div key={label} style={{ textAlign: "center" }}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: "var(--text-3)",
                  marginBottom: 5,
                }}
              >
                {label}
              </div>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hash"
                  style={{ textDecoration: "none", color: "var(--accent)" }}
                >
                  {value} ↗
                </a>
              ) : (
                <span className="hash hash-dim">{value}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const PROBLEMS = [
  {
    num: "01",
    problem: "Agents have no identity.",
    tension: "Every runtime can claim to be an agent. Nothing proves which principal authorized it.",
    primitive: "AgentPassport",
    accent: "var(--accent)",
    badgeClass: "tag-accent",
    features: [
      "Soulbound ERC-7857-compatible passport",
      "Encrypted permission manifest in 0G Storage",
      "Permanent passportId shared across integrations",
    ],
    outcome:
      "Sigil mints a portable identity anchor so every agent runtime resolves back to one accountable principal.",
  },
  {
    num: "02",
    problem: "AI outputs have no accountability.",
    tension: "A report, risk score, or audit can be copied, altered, or detached from the model that produced it.",
    primitive: "ProvenanceRecord",
    accent: "var(--sealed)",
    badgeClass: "tag-sealed",
    features: [
      "0G Compute sealed inference receipt",
      "Input context hash + output hash on-chain",
      "Backward lookup from artifact -> agent -> principal",
    ],
    outcome:
      "Sigil notarizes consequential outputs so every artifact carries a cryptographic accountability chain.",
  },
  {
    num: "03",
    problem: "Agents have no reputation.",
    tension: "Every agent starts from zero trust, even if it has already executed hundreds of real tasks.",
    primitive: "Reputation [0-1000]",
    accent: "var(--ok)",
    badgeClass: "tag-ok",
    features: [
      "Capability attestations appended over time",
      "Deterministic on-chain score updates",
      "Readable by any counterparty without auth",
    ],
    outcome:
      "Sigil turns repeated execution history into a machine-verifiable public trust layer.",
  },
];

export function ThreeProblems() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActive((value) => (value + 1) % PROBLEMS.length);
    }, 5600);
    return () => window.clearInterval(id);
  }, []);

  const current = PROBLEMS[active];

  return (
    <section className="section" id="primitives">
      <div className="page-wrap">
        <div
          style={{
            marginBottom: 56,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 24,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-3)",
                marginBottom: 14,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ width: 20, height: 1, background: "var(--accent)", display: "inline-block" }} />
              The Problem
            </div>
            <h2
              className="display"
              style={{
                fontSize: "clamp(36px,4vw,52px)",
                fontWeight: 700,
                fontStyle: "normal",
                letterSpacing: "var(--tracking-tight)",
                lineHeight: 1.08,
                maxWidth: 500,
              }}
            >
              Three missing primitives
              <br />
              in every agent stack.
            </h2>
          </div>
          <p
            style={{
              color: "var(--text-3)",
              fontSize: 13,
              lineHeight: 1.7,
              maxWidth: 260,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.01em",
            }}
          >
            The left rail rotates through the gaps.
            <br />
            The right card shows how Sigil closes each one.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(280px, 0.9fr) minmax(360px, 1.1fr)",
            gap: 28,
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              minHeight: 540,
            }}
          >
            {PROBLEMS.map((problem, index) => {
              const isActive = index === active;
              return (
                <button
                  key={problem.num}
                  onClick={() => setActive(index)}
                  style={{
                    textAlign: "left",
                    border: `1px solid ${isActive ? problem.accent : "var(--border)"}`,
                    background: isActive ? "var(--bg-raised)" : "transparent",
                    borderRadius: 18,
                    padding: "20px 20px 18px",
                    cursor: "pointer",
                    transition: "transform .25s ease, border-color .25s ease, background .25s ease",
                    transform: isActive ? "translateX(10px)" : "translateX(0)",
                    boxShadow: isActive ? "0 20px 50px rgba(0,0,0,0.18)" : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 14,
                      marginBottom: 14,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: isActive ? problem.accent : "var(--text-3)",
                      }}
                    >
                      Problem {problem.num}
                    </span>
                    <span
                      style={{
                        width: 68,
                        height: 2,
                        background: isActive ? problem.accent : "var(--border)",
                        transition: "background .25s ease",
                      }}
                    />
                  </div>
                  <div
                    className="display"
                    style={{
                      fontSize: "clamp(22px,2.2vw,31px)",
                      fontWeight: 700,
                      lineHeight: 1.08,
                      letterSpacing: "var(--tracking-tight)",
                      marginBottom: 10,
                    }}
                  >
                    {problem.problem}
                  </div>
                  <p
                    style={{
                      fontSize: 13.5,
                      lineHeight: 1.75,
                      color: isActive ? "var(--text-2)" : "var(--text-3)",
                      maxWidth: 430,
                    }}
                  >
                    {problem.tension}
                  </p>
                </button>
              );
            })}
          </div>

          <div style={{ position: "relative", minHeight: 540 }}>
            <div
              style={{
                position: "absolute",
                inset: "6% 8% auto auto",
                width: 180,
                height: 180,
                background: `radial-gradient(circle, ${current.accent}22 0%, transparent 72%)`,
                filter: "blur(4px)",
                pointerEvents: "none",
              }}
            />
            <div
              key={current.num}
              style={{
                position: "relative",
                height: "100%",
                borderRadius: 28,
                overflow: "hidden",
                border: `1px solid ${current.accent}`,
                background:
                  "linear-gradient(180deg, color-mix(in srgb, var(--bg-raised) 92%, transparent) 0%, var(--bg) 100%)",
                boxShadow: "0 28px 70px rgba(0,0,0,0.18)",
                animation: "fade-up .35s ease both",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: `linear-gradient(135deg, ${current.accent}18 0%, transparent 38%, transparent 100%)`,
                  pointerEvents: "none",
                }}
              />
              <div style={{ position: "relative", padding: "26px 26px 24px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 20,
                    marginBottom: 22,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: current.accent,
                        marginBottom: 10,
                      }}
                    >
                      Sigil response
                    </div>
                    <h3
                      className="display"
                      style={{
                        fontSize: "clamp(30px,3vw,44px)",
                        lineHeight: 1.02,
                        fontWeight: 700,
                        letterSpacing: "var(--tracking-tight)",
                      }}
                    >
                      {current.primitive}
                    </h3>
                  </div>
                  <span className={`tag ${current.badgeClass}`} style={{ alignSelf: "flex-start" }}>
                    Live primitive
                  </span>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr",
                    gap: 18,
                  }}
                >
                  <div
                    style={{
                      padding: "16px 18px",
                      borderRadius: 18,
                      background: "var(--bg-raised)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        color: "var(--text-3)",
                        marginBottom: 10,
                      }}
                    >
                      The gap
                    </div>
                    <p style={{ fontSize: 15, color: "var(--text)", lineHeight: 1.8 }}>
                      {current.tension}
                    </p>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.15fr 0.85fr",
                      gap: 16,
                    }}
                  >
                    <div
                      style={{
                        padding: "18px 18px 16px",
                        borderRadius: 20,
                        border: "1px solid var(--border)",
                        background: "var(--card-bg)",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: "var(--text-3)",
                          marginBottom: 14,
                        }}
                      >
                        What ships instead
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                        {current.features.map((feature, index) => (
                          <div
                            key={feature}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "24px 1fr",
                              gap: 12,
                              alignItems: "start",
                            }}
                          >
                            <span
                              style={{
                                width: 24,
                                height: 24,
                                borderRadius: "50%",
                                border: `1px solid ${current.accent}`,
                                color: current.accent,
                                fontFamily: "var(--font-mono)",
                                fontSize: 10,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              0{index + 1}
                            </span>
                            <p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.7 }}>
                              {feature}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div
                      style={{
                        borderRadius: 20,
                        padding: "18px 18px 16px",
                        background: `linear-gradient(180deg, ${current.accent}16 0%, transparent 100%)`,
                        border: `1px solid ${current.accent}`,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: 18,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 10,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            color: current.accent,
                            marginBottom: 12,
                          }}
                        >
                          Outcome
                        </div>
                        <p style={{ fontSize: 14.5, lineHeight: 1.8, color: "var(--text)" }}>
                          {current.outcome}
                        </p>
                      </div>
                      <div>
                        <div
                          style={{
                            width: "100%",
                            height: 4,
                            background: "var(--border)",
                            borderRadius: 999,
                            overflow: "hidden",
                            marginBottom: 8,
                          }}
                        >
                          <div
                            style={{
                              width: `${((active + 1) / PROBLEMS.length) * 100}%`,
                              height: "100%",
                              background: current.accent,
                              borderRadius: 999,
                              transition: "width .35s ease, background .35s ease",
                            }}
                          />
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: 10,
                            color: "var(--text-3)",
                            letterSpacing: "0.08em",
                          }}
                        >
                          auto-rotating narrative · tap any problem to pin focus
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const HOW_STEPS = [
  {
    n: "01",
    title: "Register passport",
    desc: "Principal authorizes a fresh agent keypair once. SDK encrypts permission manifest -> 0G Storage KV. iNFT minted on-chain.",
    data: "passportId = 0x4a2c...83ca",
    dataLabel: "Returned once",
  },
  {
    n: "02",
    title: "Agent acts autonomously",
    desc: "Agent signs every subsequent action with its own key. Principal never re-signs. Every action -> 0G Storage Log fingerprint.",
    data: "agentAddress = 0x472F...A1",
    dataLabel: "Autonomous signer",
  },
  {
    n: "03",
    title: "Output notarized",
    desc: "0G Compute seals the inference receipt. Output hash + receipt hash + agent signature -> ProvenanceRecord on-chain.",
    data: "recordId = 0xa891...41e",
    dataLabel: "Sealed receipt",
  },
  {
    n: "04",
    title: "Anyone resolves",
    desc: "Paste any passportId, recordId, or output hash. Chain resolves artifact -> agent -> principal. No auth required.",
    data: "resolve(0x4a2c...83ca)",
    dataLabel: "Public read",
  },
];

export function HowItWorks() {
  return (
    <section className="section" id="how">
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
          How It Works
        </div>
        <h2
          className="display"
          style={{
            fontSize: "clamp(32px,4vw,50px)",
            fontWeight: 700,
            fontStyle: "normal",
            letterSpacing: "var(--tracking-tight)",
            lineHeight: 1.08,
            marginBottom: 56,
          }}
        >
          Four steps. Permanent record.
        </h2>

        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              top: 27,
              left: 27,
              right: 27,
              height: 1,
              background: "var(--border)",
              zIndex: 0,
            }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 24,
              position: "relative",
              zIndex: 1,
            }}
          >
            {HOW_STEPS.map((step) => (
              <div key={step.n} style={{ paddingRight: 12 }}>
                <div
                  style={{
                    width: 54,
                    height: 54,
                    border: "1px solid var(--border-strong)",
                    borderRadius: "50%",
                    background: "var(--bg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 24,
                  }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)", letterSpacing: "0.06em" }}>
                    {step.n}
                  </span>
                </div>
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, letterSpacing: "-0.01em" }}>
                  {step.title}
                </h3>
                <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.7, marginBottom: 16 }}>
                  {step.desc}
                </p>
                <div
                  style={{
                    background: "var(--code-bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 3,
                    padding: "8px 12px",
                  }}
                >
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--accent)", marginBottom: 2 }}>
                    {step.data}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--text-3)",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {step.dataLabel}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
