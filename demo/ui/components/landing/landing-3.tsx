"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { NavBar, SigilMark, useThemeState, type NavLink } from "../shared/primitives";

const SKILL_SEQ = [
  { t: 0, kind: "prompt", text: "$ curl https://api.sigil.protocol/skill.md" },
  { t: 700, kind: "blank", text: "" },
  { t: 900, kind: "h1", text: "# SKILL.md - Sigil Protocol" },
  { t: 1100, kind: "h2", text: "## Agent self-registration. No human guidance." },
  { t: 1400, kind: "blank", text: "" },
  { t: 1600, kind: "step", text: "STEP 1 - Request a PassportID" },
  { t: 1800, kind: "dim", text: "POST /v1/passport/register/request" },
  { t: 1950, kind: "code", text: '{ "agentDescription": "DeFi risk scorer",' },
  { t: 2050, kind: "code", text: '  "principalAddress": "0x7FBb...018f" }' },
  { t: 2500, kind: "ok", text: '<- 200  { "requestId": "req_9k2xB7m",' },
  { t: 2650, kind: "ok", text: '       "approvalUrl": "https://.../approve/req_9k2xB7m" }' },
  { t: 3100, kind: "blank", text: "" },
  { t: 3200, kind: "step", text: "STEP 2 - Principal approves in browser" },
  { t: 3400, kind: "dim", text: "GET /v1/passport/register/status/req_9k2xB7m" },
  { t: 4200, kind: "ok", text: '<- 200  { "status": "approved" }' },
  { t: 4600, kind: "blank", text: "" },
  { t: 4700, kind: "step", text: "STEP 3 - Collect credentials (one-time)" },
  { t: 4900, kind: "ok", text: "  passportId:      0x4a2c...83ca" },
  { t: 5100, kind: "warn", text: "  agentPrivateKey: [delivered once - store safely]" },
  { t: 5600, kind: "blank", text: "" },
  { t: 5700, kind: "sealed", text: "ok  AgentPassport minted - 0G Galileo Testnet" },
  { t: 5900, kind: "sealed", text: "ok  Manifest encrypted -> 0G Storage KV" },
  { t: 6100, kind: "sealed", text: "ok  Genesis entry -> 0G Storage Log" },
] as const;

type SkillLine = (typeof SKILL_SEQ)[number];

function SkillTerminal({
  minHeight = 320,
  maxHeight = 380,
}: {
  minHeight?: number;
  maxHeight?: number;
}) {
  const [lines, setLines] = useState<SkillLine[]>([]);
  const [cursor, setCursor] = useState(true);
  const [done, setDone] = useState(false);
  const timeouts = useRef<number[]>([]);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const run = useCallback(() => {
    timeouts.current.forEach((timeout) => window.clearTimeout(timeout));
    timeouts.current = [];
    setLines([]);
    setDone(false);

    SKILL_SEQ.forEach((line, index) => {
      const id = window.setTimeout(() => {
        setLines((previous) => [...previous, line]);
        if (bodyRef.current) {
          bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
        }
        if (index === SKILL_SEQ.length - 1) {
          setDone(true);
        }
      }, line.t);
      timeouts.current.push(id);
    });
  }, []);

  useEffect(() => {
    run();
    const blink = window.setInterval(() => setCursor((value) => !value), 530);
    return () => {
      timeouts.current.forEach((timeout) => window.clearTimeout(timeout));
      window.clearInterval(blink);
    };
  }, [run]);

  useEffect(() => {
    if (!done) {
      return;
    }

    const timer = window.setTimeout(run, 3500);
    return () => window.clearTimeout(timer);
  }, [done, run]);

  const colors: Record<SkillLine["kind"], string> = {
    prompt: "var(--accent)",
    h1: "var(--text)",
    h2: "var(--text-2)",
    step: "var(--accent)",
    dim: "var(--text-3)",
    code: "var(--text-2)",
    ok: "var(--ok)",
    warn: "var(--unsealed)",
    sealed: "var(--sealed)",
    blank: "transparent",
  };

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          position: "absolute",
          inset: -40,
          background: "radial-gradient(ellipse at 50% 50%,var(--accent-dim) 0%,transparent 70%)",
          pointerEvents: "none",
          borderRadius: "50%",
        }}
      />
      <div
        style={{
          position: "relative",
          background: "var(--code-bg)",
          border: "1px solid var(--border-strong)",
          borderRadius: 6,
          overflow: "hidden",
          fontFamily: "var(--font-mono)",
          fontSize: 12.5,
          lineHeight: 1.65,
          boxShadow: "var(--shadow)",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 7,
            background: "var(--bg-raised)",
          }}
        >
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#ff5f57", display: "inline-block" }} />
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#febc2e", display: "inline-block" }} />
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#28c840", display: "inline-block" }} />
          <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-3)", letterSpacing: "0.08em" }}>
            SKILL.md · sigil.protocol
          </span>
        </div>
        <div ref={bodyRef} style={{ padding: "18px 22px", minHeight, maxHeight, overflowY: "auto" }}>
          {lines.map((line, index) =>
            line.kind === "blank" ? (
              <div key={`blank-${index}`} style={{ height: 6 }} />
            ) : (
              <div
                key={`${line.text}-${index}`}
                style={{ color: colors[line.kind], marginBottom: 1, animation: "log-in .12s ease both" }}
              >
                {line.text}
              </div>
            ),
          )}
          <span
            style={{
              display: "inline-block",
              width: 7,
              height: 13,
              background: "var(--accent)",
              verticalAlign: "text-bottom",
              opacity: cursor ? 1 : 0,
            }}
          />
        </div>
      </div>
    </div>
  );
}

export function SkillMdSection() {
  return (
    <section className="section" id="onboard">
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
          <span style={{ width: 16, height: 1, background: "var(--accent)", display: "inline-block" }} />
          SKILL.md Onboarding
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 64,
            alignItems: "center",
          }}
        >
          <div>
            <h2
              className="display"
              style={{
                fontSize: "var(--text-3xl)",
                fontWeight: 700,
                letterSpacing: "var(--tracking-tight)",
                lineHeight: "var(--leading-tight)",
                marginBottom: 16,
              }}
            >
              Self-register
              <br />
              from a single URL.
            </h2>
            <p style={{ color: "var(--text-2)", fontSize: 15, lineHeight: 1.75, marginBottom: 24 }}>
              Any LLM agent can read SKILL.md and autonomously complete registration. The
              protocol is designed so a fresh Claude Code session can onboard without human
              guidance beyond a URL.
            </p>
            <p style={{ color: "var(--text-2)", fontSize: 15, lineHeight: 1.75, marginBottom: 32 }}>
              Principal authorizes once in a browser wallet. Agent receives credentials.
              Every subsequent output is notarized autonomously.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <a href="/skill-md" className="btn btn-primary" style={{ fontSize: 12 }}>
                Read SKILL.md
              </a>
              <a href="/passport" className="btn btn-secondary" style={{ fontSize: 12 }}>
                Resolve a passport
              </a>
            </div>
          </div>

          <SkillTerminal />
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer
      style={{
        borderTop: "1px solid var(--border)",
        padding: "36px 52px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SigilMark size={22} />
        <span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 600 }}>
          Sigil Protocol
        </span>
        <span className="tag" style={{ marginLeft: 4 }}>
          ETHGlobal Open Agents
        </span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[
          [
            "Registry",
            "https://chainscan-galileo.0g.ai/address/0x2C0457F82B57148e8363b4589bb3294b23AE7625",
          ],
          [
            "Notary",
            "https://chainscan-galileo.0g.ai/address/0xA1103E6490ab174036392EbF5c798C9DaBAb24EE",
          ],
          ["0G Docs", "https://docs.0g.ai"],
          ["KeeperHub", "https://keeperhub.com"],
          ["GitHub", "https://github.com/sigil-protocol"],
        ].map(([label, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-3)",
              textDecoration: "none",
              padding: "4px 10px",
              border: "1px solid var(--border)",
              borderRadius: 2,
              transition: "color .2s,border-color .2s",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.color = "var(--accent)";
              event.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.color = "var(--text-3)";
              event.currentTarget.style.borderColor = "var(--border)";
            }}
          >
            {label}
          </a>
        ))}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" }}>
        0G Galileo · chain 16602
      </div>
    </footer>
  );
}

const standaloneLinks: NavLink[] = [
  ["Landing", "/"],
  ["Resolve", "/passport"],
  ["SKILL.md", "/skill-md"],
];

export function SkillMdPage() {
  const { theme, setTheme } = useThemeState();

  return (
    <>
      <NavBar links={standaloneLinks} theme={theme} setTheme={setTheme} />
      <div style={{ paddingTop: 56 }}>
        <div
          style={{
            padding: "64px 52px 48px",
            borderBottom: "1px solid var(--border)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-3)",
              marginBottom: 14,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ width: 20, height: 1, background: "var(--accent)", display: "inline-block" }} />
            Agent Onboarding
          </div>
          <h1
            className="display"
            style={{
              fontSize: "clamp(36px,5vw,64px)",
              fontWeight: 700,
              fontStyle: "normal",
              letterSpacing: "var(--tracking-tight)",
              lineHeight: "var(--leading-tight)",
              marginBottom: 16,
            }}
          >
            SKILL.md
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-2)", lineHeight: 1.8, maxWidth: 540, margin: "0 auto 28px" }}>
            LLM-readable onboarding. Any agent can read this endpoint and self-register on
            Sigil with no human guidance beyond a URL.
          </p>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              background: "var(--code-bg)",
              border: "1px solid var(--border-strong)",
              borderRadius: 3,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--accent)",
            }}
          >
            curl https://api.sigil.protocol/skill.md
          </div>
        </div>

        <div className="page-wrap" style={{ paddingTop: 64, paddingBottom: 64 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 72,
              alignItems: "start",
            }}
          >
            <div>
              <h2
                className="display"
                style={{
                  fontSize: "clamp(28px,3vw,40px)",
                  fontWeight: 700,
                  fontStyle: "normal",
                  letterSpacing: "var(--tracking-tight)",
                  lineHeight: "var(--leading-tight)",
                  marginBottom: 20,
                }}
              >
                Three steps.
                <br />
                One registration.
              </h2>
              {[
                {
                  n: "01",
                  title: "Request a PassportID",
                  body: "POST your agent description and principal address. Sigil returns a requestId and an approval URL.",
                },
                {
                  n: "02",
                  title: "Principal approves",
                  body: "Your human principal connects their wallet at the approval URL and signs once. That is the only human step in the entire agent lifecycle.",
                },
                {
                  n: "03",
                  title: "Collect credentials",
                  body: "Poll the status endpoint. On approval, you receive your passportId and agentPrivateKey. The private key is delivered once - store it securely.",
                },
              ].map((step) => (
                <div
                  key={step.n}
                  style={{
                    display: "flex",
                    gap: 16,
                    marginBottom: 24,
                    paddingBottom: 24,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--text-3)",
                      letterSpacing: "0.1em",
                      flexShrink: 0,
                      paddingTop: 3,
                    }}
                  >
                    {step.n}
                  </span>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{step.title}</div>
                    <p style={{ fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.7 }}>
                      {step.body}
                    </p>
                  </div>
                </div>
              ))}
              <div
                style={{
                  padding: "14px 16px",
                  background: "var(--accent-dim)",
                  border: "1px solid var(--accent)",
                  borderRadius: 3,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--accent)",
                  lineHeight: 1.6,
                }}
              >
                After registration: every output your agent produces can be notarized on-chain
                with a single SDK call. Principal never re-signs.
              </div>
            </div>

            <SkillTerminal minHeight={320} maxHeight={440} />
          </div>
        </div>

        <footer
          style={{
            borderTop: "1px solid var(--border)",
            padding: "28px 52px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <SigilMark size={20} />
            <span style={{ fontFamily: "var(--font-display)", fontSize: 13, fontWeight: 600 }}>
              Sigil Protocol
            </span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" }}>
            0G Galileo · chain 16602 · ETHGlobal Open Agents
          </div>
        </footer>
      </div>
    </>
  );
}
