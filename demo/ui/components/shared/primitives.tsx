"use client";

import { useEffect, useMemo, useState } from "react";

export type ThemeId = "onyx" | "vault" | "vellum" | "wax" | "blueprint";

type ThemeOption = {
  id: ThemeId;
  label: string;
  swatch: string;
};

export type NavLink = [label: string, href: string];

export const THEMES: ThemeOption[] = [
  { id: "onyx", label: "Onyx & Plasma", swatch: "#8b5cf6" },
  { id: "vault", label: "Cold Vault", swatch: "#4dd8e0" },
  { id: "vellum", label: "Cypherpunk Vellum", swatch: "#8b1a10" },
  { id: "wax", label: "Living Wax", swatch: "#5e1916" },
  { id: "blueprint", label: "Galileo Blueprint", swatch: "#c8a820" },
];

export const EXPLORER = "https://chainscan-galileo.0g.ai";

export function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem("sigil-theme", id);
  } catch {}
}

function getSavedTheme(): ThemeId {
  if (typeof window === "undefined") {
    return "onyx";
  }

  try {
    const saved = localStorage.getItem("sigil-theme") as ThemeId | null;
    return saved ?? "onyx";
  } catch {
    return "onyx";
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

export function ThemeSwitcher({
  current,
  setCurrent,
}: {
  current: ThemeId;
  setCurrent: (theme: ThemeId) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeTheme = useMemo(
    () => THEMES.find((theme) => theme.id === current) ?? THEMES[0],
    [current],
  );

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((value) => !value)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          borderRadius: 3,
          cursor: "pointer",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: "0.06em",
          color: "var(--text-2)",
          transition: "border-color .2s",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.borderColor = "var(--accent)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.borderColor = "var(--border-strong)";
        }}
      >
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: activeTheme.swatch,
            display: "inline-block",
          }}
        />
        Theme
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M2 3.5l3 3 3-3"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 210,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 4,
            overflow: "hidden",
            zIndex: 300,
            boxShadow: "var(--shadow)",
          }}
        >
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => {
                setCurrent(theme.id);
                setOpen(false);
              }}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: current === theme.id ? "var(--accent-dim)" : "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                borderBottom: "1px solid var(--border)",
                transition: "background .15s",
              }}
              onMouseEnter={(event) => {
                if (current !== theme.id) {
                  event.currentTarget.style.background = "var(--bg-overlay)";
                }
              }}
              onMouseLeave={(event) => {
                if (current !== theme.id) {
                  event.currentTarget.style.background = "transparent";
                }
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: theme.swatch,
                  flexShrink: 0,
                  outline: current === theme.id ? "2px solid var(--text)" : "none",
                  outlineOffset: 2,
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 13,
                  color: "var(--text)",
                }}
              >
                {theme.label}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className="nav"
      style={{
        borderBottomColor: scrolled ? "var(--border)" : "transparent",
        transition: "border-color .3s, background .3s",
      }}
    >
      <a
        href="/"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          textDecoration: "none",
          color: "var(--text)",
        }}
      >
        <SigilMark size={28} />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "-0.01em",
          }}
        >
          Sigil Protocol
        </span>
      </a>

      <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
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

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <ThemeSwitcher current={theme} setCurrent={setTheme} />
        {cta ? (
          <a href={cta.href} className="btn btn-primary" style={{ fontSize: 12 }}>
            {cta.label}
          </a>
        ) : null}
      </div>
    </nav>
  );
}
