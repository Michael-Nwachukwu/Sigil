"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SigilMark, useThemeState } from "../shared/primitives";

export interface NavSection {
  title: string;
  items: { label: string; href: string; badge?: string }[];
}

export const NAV: NavSection[] = [
  {
    title: "Overview",
    items: [
      { label: "Introduction", href: "/docs" },
      { label: "How It Works", href: "/docs#how-it-works" },
      { label: "Dual Wallet Model", href: "/docs#dual-wallet" },
      { label: "Quick Start", href: "/docs#quickstart" },
    ],
  },
  {
    title: "SDK",
    items: [
      { label: "Installation", href: "/docs/sdk" },
      { label: "SigilClient", href: "/docs/sdk#sigil-client" },
      { label: "AgentPassport", href: "/docs/sdk#passport" },
      { label: "ProvenanceNotary", href: "/docs/sdk#provenance" },
      { label: "ZeroGComputeAdapter", href: "/docs/sdk#compute" },
      { label: "Credentials", href: "/docs/sdk#credentials" },
      { label: "Types", href: "/docs/sdk#types" },
    ],
  },
  {
    title: "REST API",
    items: [
      { label: "Overview", href: "/docs/api" },
      { label: "POST /register/request", href: "/docs/api#register-request", badge: "POST" },
      { label: "GET /register/status", href: "/docs/api#register-status", badge: "GET" },
      { label: "POST /approve", href: "/docs/api#approve", badge: "POST" },
    ],
  },
  {
    title: "MCP Tools",
    items: [
      { label: "Overview", href: "/docs/mcp" },
      { label: "register_agent", href: "/docs/mcp#register" },
      { label: "resolve_agent", href: "/docs/mcp#resolve" },
      { label: "notarize_output", href: "/docs/mcp#notarize" },
      { label: "resolve_provenance", href: "/docs/mcp#resolve-provenance" },
      { label: "verify_agent", href: "/docs/mcp#verify" },
    ],
  },
];

export function DocsLayout({ children }: { children: React.ReactNode }) {
  const { theme, setTheme } = useThemeState();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div
      data-theme={theme}
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--font-body-src), system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top nav */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "var(--nav-bg)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid var(--border)",
          padding: "0 24px",
          height: 52,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            textDecoration: "none",
            color: "var(--text)",
          }}
        >
          <SigilMark size={22} />
          <span style={{ fontFamily: "var(--font-display-src)", fontSize: 16 }}>
            Sigil Protocol
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono-src)",
              fontSize: 10,
              color: "var(--accent)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              background: "var(--accent-dim)",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            docs
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link
            href="/passport"
            style={{ fontSize: 13, color: "var(--text-2)", textDecoration: "none" }}
          >
            Explorer
          </Link>
          <Link
            href="/SKILL.md"
            target="_blank"
            style={{ fontSize: 13, color: "var(--text-2)", textDecoration: "none" }}
          >
            SKILL.md
          </Link>
          <button
            onClick={() => setTheme(theme === "vault" ? "wax" : "vault")}
            aria-label="Toggle theme"
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 8px",
              cursor: "pointer",
              color: "var(--text-2)",
              fontSize: 14,
            }}
          >
            {theme === "vault" ? "☀" : "☽"}
          </button>
          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle sidebar"
            className="docs-mobile-toggle"
            style={{
              display: "none",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
              color: "var(--text-2)",
              fontSize: 14,
            }}
          >
            {mobileOpen ? "✕" : "☰"}
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            top: 52,
            background: "rgba(0,0,0,0.4)",
            zIndex: 40,
          }}
        />
      )}

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar */}
        <aside
          className={`docs-sidebar${mobileOpen ? " open" : ""}`}
          style={{
            width: 224,
            flexShrink: 0,
            borderRight: "1px solid var(--border)",
            padding: "24px 0",
            overflowY: "auto",
            position: "sticky",
            top: 52,
            height: "calc(100vh - 52px)",
          }}
        >
          {NAV.map((section) => (
            <div key={section.title} style={{ marginBottom: 24, padding: "0 16px" }}>
              <div
                style={{
                  fontFamily: "var(--font-mono-src)",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "var(--text-3)",
                  marginBottom: 8,
                  paddingLeft: 8,
                }}
              >
                {section.title}
              </div>
              {section.items.map((item) => {
                const active =
                  item.href === pathname ||
                  (item.href.includes("#") && pathname === item.href.split("#")[0]);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "5px 8px",
                      borderRadius: 5,
                      textDecoration: "none",
                      fontSize: 13,
                      color: active ? "var(--accent)" : "var(--text-2)",
                      background: active ? "var(--accent-dim)" : "transparent",
                      marginBottom: 1,
                      transition: "background .15s, color .15s",
                    }}
                  >
                    {item.label}
                    {item.badge && (
                      <span
                        style={{
                          fontFamily: "var(--font-mono-src)",
                          fontSize: 9,
                          letterSpacing: "0.06em",
                          color:
                            item.badge === "POST"
                              ? "var(--sealed)"
                              : item.badge === "GET"
                                ? "var(--ok)"
                                : "var(--text-3)",
                          background:
                            item.badge === "POST"
                              ? "var(--sealed-dim)"
                              : item.badge === "GET"
                                ? "rgba(52,211,153,0.1)"
                                : "var(--bg-overlay)",
                          padding: "1px 5px",
                          borderRadius: 3,
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </aside>

        {/* Main content */}
        <main
          className="docs-main"
          style={{
            flex: 1,
            padding: "40px 48px 80px",
            maxWidth: 820,
            overflowY: "auto",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared doc primitives
// ---------------------------------------------------------------------------

export function H1({ children }: { children: React.ReactNode }) {
  return (
    <h1
      style={{
        fontFamily: "var(--font-display-src)",
        fontSize: 32,
        fontWeight: 400,
        letterSpacing: "-0.02em",
        color: "var(--text)",
        marginBottom: 12,
        marginTop: 0,
      }}
    >
      {children}
    </h1>
  );
}

export function H2({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      style={{
        fontSize: 20,
        fontWeight: 600,
        color: "var(--text)",
        marginTop: 48,
        marginBottom: 12,
        paddingTop: id ? 8 : 0,
        scrollMarginTop: 72,
      }}
    >
      {children}
    </h2>
  );
}

export function H3({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <h3
      id={id}
      style={{
        fontSize: 15,
        fontWeight: 600,
        color: "var(--text)",
        marginTop: 28,
        marginBottom: 8,
        scrollMarginTop: 72,
      }}
    >
      {children}
    </h3>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 14,
        lineHeight: 1.75,
        color: "var(--text-2)",
        marginBottom: 14,
        marginTop: 0,
      }}
    >
      {children}
    </p>
  );
}

export function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 16,
        lineHeight: 1.7,
        color: "var(--text-2)",
        marginBottom: 24,
        marginTop: 0,
      }}
    >
      {children}
    </p>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        fontFamily: "var(--font-mono-src)",
        fontSize: "0.85em",
        background: "var(--code-bg)",
        border: "1px solid var(--border)",
        borderRadius: 4,
        padding: "1px 5px",
        color: "var(--accent)",
      }}
    >
      {children}
    </code>
  );
}

export function CodeBlock({
  children,
  lang,
  title,
}: {
  children: string;
  lang?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div
      style={{
        background: "var(--code-bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        marginBottom: 20,
        overflow: "hidden",
      }}
    >
      {(title || lang) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 14px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-raised)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono-src)",
              fontSize: 11,
              color: "var(--text-3)",
            }}
          >
            {title ?? lang}
          </span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(children).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              });
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-mono-src)",
              fontSize: 10,
              color: copied ? "var(--ok)" : "var(--text-3)",
              letterSpacing: "0.06em",
            }}
          >
            {copied ? "copied" : "copy"}
          </button>
        </div>
      )}
      <pre
        style={{
          margin: 0,
          padding: "16px 18px",
          overflowX: "auto",
          fontFamily: "var(--font-mono-src)",
          fontSize: 12.5,
          lineHeight: 1.7,
          color: "var(--text)",
          whiteSpace: "pre",
        }}
      >
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function Callout({
  type = "info",
  children,
}: {
  type?: "info" | "warn" | "danger" | "tip";
  children: React.ReactNode;
}) {
  const colors = {
    info: { bg: "var(--accent-dim)", border: "var(--accent)", label: "INFO" },
    warn: { bg: "var(--sealed-dim)", border: "var(--sealed)", label: "NOTE" },
    danger: { bg: "rgba(239,68,68,0.08)", border: "var(--danger)", label: "IMPORTANT" },
    tip: { bg: "rgba(52,211,153,0.08)", border: "var(--ok)", label: "TIP" },
  };
  const c = colors[type];

  return (
    <div
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 7,
        padding: "12px 16px",
        marginBottom: 20,
        fontSize: 13,
        lineHeight: 1.65,
        color: "var(--text-2)",
        display: "flex",
        gap: 10,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono-src)",
          fontSize: 10,
          color: c.border,
          letterSpacing: "0.08em",
          flexShrink: 0,
          paddingTop: 2,
        }}
      >
        {c.label}
      </span>
      <span>{children}</span>
    </div>
  );
}

export function PropTable({
  rows,
}: {
  rows: { name: string; type: string; required?: boolean; desc: string }[];
}) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 7,
        overflowX: "auto",
        marginBottom: 24,
        fontSize: 13,
      }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
        <thead>
          <tr style={{ background: "var(--bg-raised)" }}>
            {["Parameter", "Type", "Description"].map((h) => (
              <th
                key={h}
                style={{
                  padding: "8px 14px",
                  textAlign: "left",
                  fontFamily: "var(--font-mono-src)",
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-3)",
                  borderBottom: "1px solid var(--border)",
                  fontWeight: 500,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.name}
              style={{
                background: i % 2 === 0 ? "transparent" : "var(--bg-raised)",
                borderBottom:
                  i < rows.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                <code
                  style={{
                    fontFamily: "var(--font-mono-src)",
                    fontSize: 12,
                    color: "var(--accent)",
                  }}
                >
                  {row.name}
                </code>
                {row.required && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono-src)",
                      fontSize: 9,
                      color: "var(--danger)",
                      marginLeft: 5,
                    }}
                  >
                    required
                  </span>
                )}
              </td>
              <td style={{ padding: "10px 14px", verticalAlign: "top" }}>
                <code
                  style={{
                    fontFamily: "var(--font-mono-src)",
                    fontSize: 11,
                    color: "var(--sealed)",
                  }}
                >
                  {row.type}
                </code>
              </td>
              <td
                style={{
                  padding: "10px 14px",
                  color: "var(--text-2)",
                  lineHeight: 1.6,
                  verticalAlign: "top",
                }}
              >
                {row.desc}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, { color: string; bg: string }> = {
    GET: { color: "var(--ok)", bg: "rgba(52,211,153,0.1)" },
    POST: { color: "var(--sealed)", bg: "var(--sealed-dim)" },
    DELETE: { color: "var(--danger)", bg: "rgba(239,68,68,0.1)" },
    PATCH: { color: "var(--accent)", bg: "var(--accent-dim)" },
  };
  const c = colors[method] ?? { color: "var(--text-3)", bg: "var(--bg-overlay)" };
  return (
    <span
      style={{
        fontFamily: "var(--font-mono-src)",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        color: c.color,
        background: c.bg,
        padding: "2px 8px",
        borderRadius: 4,
        marginRight: 8,
      }}
    >
      {method}
    </span>
  );
}

export function Endpoint({
  method,
  path,
  id,
}: {
  method: string;
  path: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--bg-raised)",
        border: "1px solid var(--border)",
        borderRadius: 7,
        padding: "10px 14px",
        marginBottom: 16,
        scrollMarginTop: 72,
      }}
    >
      <MethodBadge method={method} />
      <code
        style={{
          fontFamily: "var(--font-mono-src)",
          fontSize: 13,
          color: "var(--text)",
        }}
      >
        {path}
      </code>
    </div>
  );
}
