"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type ThemeId = "vault" | "wax";

export type NavLink = [label: string, href: string];

export const EXPLORER = "https://chainscan-galileo.0g.ai";

export function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem("sigil-theme", id);
  } catch {}
}

function getSavedTheme(): ThemeId {
  if (typeof window === "undefined") {
    return "vault";
  }

  try {
    const saved = localStorage.getItem("sigil-theme") as ThemeId | null;
    if (saved === "vault" || saved === "wax") {
      return saved;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "vault" : "wax";
  } catch {
    return "vault";
  }
}

export function useThemeState() {
  const [theme, setTheme] = useState<ThemeId>(() => getSavedTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return { theme, setTheme };
}

export function SigilMark({
  size = 32,
  animated = false,
}: {
  size?: number;
  animated?: boolean;
}) {
  const style = animated ? { animation: "inscription 1.2s ease forwards" } : {};

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-label="Sigil Protocol mark"
    >
      <circle
        cx="20"
        cy="20"
        r="18"
        stroke="var(--accent)"
        strokeWidth="1"
        fill="none"
        opacity="0.5"
      />
      <circle
        cx="20"
        cy="20"
        r="13"
        stroke="var(--accent)"
        strokeWidth="1.5"
        fill="var(--accent-dim)"
        opacity="0.8"
      />
      <path
        d="M14 16c0-2.2 1.8-4 4-4h4a2 2 0 010 4h-4a2 2 0 000 4h4a2 2 0 010 4h-4c-2.2 0-4-1.8-4-4"
        stroke="var(--accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
        style={style}
      />
      <line x1="20" y1="2" x2="20" y2="6" stroke="var(--accent)" strokeWidth="1.5" opacity="0.4" />
      <line x1="20" y1="34" x2="20" y2="38" stroke="var(--accent)" strokeWidth="1.5" opacity="0.4" />
      <line x1="2" y1="20" x2="6" y2="20" stroke="var(--accent)" strokeWidth="1.5" opacity="0.4" />
      <line x1="34" y1="20" x2="38" y2="20" stroke="var(--accent)" strokeWidth="1.5" opacity="0.4" />
    </svg>
  );
}

export function HashDisplay({
  hash,
  full = false,
  className = "",
}: {
  hash?: string | null;
  full?: boolean;
  className?: string;
}) {
  if (!hash) {
    return null;
  }

  const normalized = hash.toLowerCase();
  const display = full
    ? normalized
    : normalized.startsWith("0x")
      ? `0x${normalized.slice(2, 6)}...${normalized.slice(-4)}`
      : `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;

  return (
    <span className={`hash ${className}`.trim()} title={normalized} style={{ cursor: "help" }}>
      {display}
    </span>
  );
}

export function OnChainLink({
  hash,
  type = "tx",
  label,
}: {
  hash: string;
  type?: "tx" | "address";
  label?: React.ReactNode;
}) {
  const url =
    type === "address" ? `${EXPLORER}/address/${hash}` : `${EXPLORER}/tx/${hash}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        textDecoration: "none",
        color: "var(--accent)",
        transition: "opacity .2s",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.opacity = "0.75";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.opacity = "1";
      }}
    >
      {label ?? <HashDisplay hash={hash} />}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: 0.6 }}>
        <path
          d="M2 8L8 2M4 2h4v4"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
      </svg>
    </a>
  );
}

export function CopyButton({
  value,
  label = "Copy value",
}: {
  value: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const id = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(id);
  }, [copied]);

  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {}
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 999,
        border: "1px solid var(--border-strong)",
        background: "var(--bg-elevated)",
        color: copied ? "var(--ok)" : "var(--text-3)",
        cursor: "pointer",
        flexShrink: 0,
        transition: "border-color .2s, color .2s, transform .15s",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = copied ? "var(--ok)" : "var(--accent)";
        event.currentTarget.style.color = copied ? "var(--ok)" : "var(--accent)";
        event.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = "var(--border-strong)";
        event.currentTarget.style.color = copied ? "var(--ok)" : "var(--text-3)";
        event.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M2.5 6.3L4.8 8.5L9.5 3.8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M4.2 4V2.9C4.2 2.4 4.6 2 5.1 2H8.8C9.3 2 9.7 2.4 9.7 2.9V7.6C9.7 8.1 9.3 8.5 8.8 8.5H7.8"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect
            x="2.3"
            y="4"
            width="5.5"
            height="6"
            rx="0.9"
            stroke="currentColor"
            strokeWidth="1.1"
          />
        </svg>
      )}
    </button>
  );
}

function compactValue(value: string, full: boolean): string {
  if (full || value.includes("...")) {
    return value;
  }
  if (value.startsWith("0x")) {
    return `0x${value.slice(2, 6)}...${value.slice(-4)}`;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function ChainValue({
  value,
  kind = "hash",
  href,
  full = false,
  color = "var(--accent)",
}: {
  value?: string | null;
  kind?: "hash" | "address" | "tx";
  href?: string;
  full?: boolean;
  color?: string;
}) {
  if (!value) {
    return null;
  }

  const url =
    href ??
    (kind === "address"
      ? `${EXPLORER}/address/${value}`
      : kind === "tx"
        ? `${EXPLORER}/tx/${value}`
        : undefined);

  const display = compactValue(value, full);
  const node = url ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={value}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color,
        textDecoration: "none",
        borderBottom: "1px dashed var(--border-strong)",
        wordBreak: "break-all",
      }}
    >
      {display}
    </a>
  ) : (
    <span
      title={value}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color,
        wordBreak: "break-all",
      }}
    >
      {display}
    </span>
  );

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >
      {node}
      <CopyButton value={value} label={`Copy ${kind}`} />
    </span>
  );
}

function BadgeShell({
  border,
  background,
  color,
  label,
  icon,
}: {
  border: string;
  background: string;
  color: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "4px 10px",
        border: `1px solid ${border}`,
        borderRadius: 2,
        background,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        color,
      }}
    >
      {icon}
      {label}
    </span>
  );
}

export function SealedBadge() {
  return (
    <BadgeShell
      border="var(--sealed)"
      background="var(--sealed-dim)"
      color="var(--sealed)"
      label="TEE Sealed"
      icon={
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1" />
          <path
            d="M3 5l1.5 1.5L7 3.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      }
    />
  );
}

export function UnsealedBadge() {
  return (
    <BadgeShell
      border="var(--unsealed)"
      background="var(--unsealed-dim)"
      color="var(--unsealed)"
      label="Agent Attested"
      icon={
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1" />
          <path
            d="M5 3v2.5M5 7h.01"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      }
    />
  );
}

export function ThemeToggle({
  current,
  setCurrent,
}: {
  current: ThemeId;
  setCurrent: (theme: ThemeId) => void;
}) {
  const isDark = current === "vault";
  const nextTheme: ThemeId = isDark ? "wax" : "vault";
  return (
    <button
      onClick={() => setCurrent(nextTheme)}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 11px",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 999,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.06em",
        color: "var(--text-2)",
        transition: "border-color .2s, transform .15s, opacity .2s",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = "var(--accent)";
        event.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = "var(--border-strong)";
        event.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: isDark ? "var(--accent-dim)" : "rgba(255,255,255,0.35)",
          color: isDark ? "var(--accent)" : "var(--accent-2)",
          flexShrink: 0,
        }}
      >
        {isDark ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M6 1.2v1.6M6 9.2v1.6M1.2 6h1.6M9.2 6h1.6M2.55 2.55l1.1 1.1M8.35 8.35l1.1 1.1M8.35 3.65l1.1-1.1M2.55 9.45l1.1-1.1M6 3.6a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 0 0 0-4.8Z"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M9.8 7.2A4.5 4.5 0 0 1 4.8 2.2A4.6 4.6 0 1 0 9.8 7.2Z"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span>{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}

export function NavBar({
  links = [],
  theme,
  setTheme,
  cta,
}: {
  links?: NavLink[];
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  cta?: { href: string; label: string };
}) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <>
      <nav
        className="nav"
        style={{
          borderBottomColor: scrolled ? "var(--border)" : "transparent",
          transition: "border-color .3s, background .3s",
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
            minWidth: 0,
          }}
        >
          <SigilMark size={28} />
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 16,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
            }}
          >
            Sigil Protocol
          </span>
        </Link>

        <div className="nav-links-desktop">
          {links.map(([label, href]) => (
            <a
              key={`${label}-${href}`}
              href={href}
              style={{
                fontSize: 13,
                color: "var(--text-2)",
                textDecoration: "none",
                fontWeight: 500,
                transition: "color .2s",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = "var(--text)";
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = "var(--text-2)";
              }}
            >
              {label}
            </a>
          ))}
        </div>

        <div className="nav-cta-desktop">
          <ThemeToggle current={theme} setCurrent={setTheme} />
          {cta ? (
            <a href={cta.href} className="btn btn-primary" style={{ fontSize: 12 }}>
              {cta.label}
            </a>
          ) : null}
        </div>

        <button
          type="button"
          className="nav-mobile-toggle"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
            {menuOpen ? (
              <path
                d="M4 4l10 10M14 4L4 14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            ) : (
              <path
                d="M2 5h14M2 9h14M2 13h14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </nav>

      {menuOpen ? (
        <div className="nav-mobile-drawer" role="dialog" aria-label="Mobile navigation">
          {links.map(([label, href]) => (
            <a key={`m-${label}-${href}`} href={href} onClick={() => setMenuOpen(false)}>
              {label}
            </a>
          ))}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid var(--border)",
            }}
          >
            <ThemeToggle current={theme} setCurrent={setTheme} />
            {cta ? (
              <a
                href={cta.href}
                className="btn btn-primary"
                style={{ fontSize: 12 }}
                onClick={() => setMenuOpen(false)}
              >
                {cta.label}
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
