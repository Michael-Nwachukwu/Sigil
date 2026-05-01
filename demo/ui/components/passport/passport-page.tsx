"use client";

import { Resolver } from "../resolve/resolver";
import { NavBar, useThemeState, type NavLink } from "../shared/primitives";
import {
  EXPLORER_URL,
  NOTARY_ADDRESS,
  REGISTRY_ADDRESS,
} from "../../lib/sigil-read";

const navLinks: NavLink[] = [
  ["Landing", "/"],
  ["Resolve", "/passport"],
  ["SKILL.md", "/skill-md"],
];

export function PassportPage() {
  const { theme, setTheme } = useThemeState();

  return (
    <>
      <NavBar links={navLinks} theme={theme} setTheme={setTheme} />
      <div style={{ paddingTop: 56 }}>
        <div style={{ padding: "48px 52px 32px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ maxWidth: 860, margin: "0 auto" }}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--text-3)",
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ width: 20, height: 1, background: "var(--accent)", display: "inline-block" }} />
              Resolution
            </div>
            <h1
              className="display"
              style={{
                fontSize: "clamp(32px,4vw,52px)",
                fontWeight: 700,
                fontStyle: "normal",
                letterSpacing: "var(--tracking-tight)",
                lineHeight: "var(--leading-tight)",
                marginBottom: 12,
              }}
            >
              Who is behind this agent? Who signed this artifact?
            </h1>
            <p style={{ fontSize: 15, color: "var(--text-2)", lineHeight: 1.75, maxWidth: 620 }}>
              Pick the question you want to answer, paste an identifier, and Sigil walks the
              chain for you. Real reads against 0G Galileo testnet — no wallet, no auth, every
              answer comes back as plain English plus the underlying on-chain detail.
            </p>
            <div
              style={{
                marginTop: 18,
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-3)",
              }}
            >
              <span>
                Registry:{" "}
                <a
                  href={`${EXPLORER_URL}/address/${REGISTRY_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none" }}
                >
                  {REGISTRY_ADDRESS}
                </a>
              </span>
              <span>
                Notary:{" "}
                <a
                  href={`${EXPLORER_URL}/address/${NOTARY_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", textDecoration: "none" }}
                >
                  {NOTARY_ADDRESS}
                </a>
              </span>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1160, margin: "0 auto", padding: "32px 52px 64px" }}>
          <Resolver />
        </div>
      </div>
    </>
  );
}
