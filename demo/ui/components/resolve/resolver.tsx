"use client";

import { useState } from "react";

import {
  detectInputKind,
  shortHex,
  smartResolve,
  type Hex32,
  type ResolveResult,
} from "../../lib/sigil-read";
import { IdentityCard, PermissionManifestCard } from "./identity-card";
import { RecordDetailCard } from "./record-detail";
import { RecordsList } from "./records-list";

export function Resolver() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(query?: string) {
    const value = (query ?? input).trim();
    if (!value) {
      setError("paste a passportId, agent address, or recordId");
      return;
    }

    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const next = await smartResolve(value);
      setResult(next);
    } catch (err) {
      setError(`resolve failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  function selectRecord(recordId: Hex32) {
    setInput(recordId);
    void run(recordId);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const inputKind = input.trim() ? detectInputKind(input.trim()) : "unknown";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div className="card">
        <div className="card-header">
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--text-2)",
            }}
          >
            Resolve
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-3)",
              letterSpacing: "0.06em",
            }}
          >
            detected: <span style={{ color: "var(--accent)" }}>{inputKind}</span>
          </span>
        </div>
        <div style={{ padding: 20 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-3)",
              letterSpacing: "0.08em",
              marginBottom: 8,
            }}
          >
            PASTE PASSPORTID (32-BYTE) · RECORDID (32-BYTE) · AGENT ADDRESS (20-BYTE) · OUTPUT HASH
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void run();
                }
              }}
              placeholder="0x..."
              spellCheck={false}
              style={{
                flex: 1,
                minWidth: 320,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                padding: "10px 14px",
                background: "var(--code-bg)",
                border: "1px solid var(--border-strong)",
                borderRadius: 3,
                color: "var(--text)",
                outline: "none",
                transition: "border-color .2s",
              }}
              onFocus={(event) => {
                event.currentTarget.style.borderColor = "var(--accent)";
              }}
              onBlur={(event) => {
                event.currentTarget.style.borderColor = "var(--border-strong)";
              }}
            />
            <button
              onClick={() => void run()}
              disabled={loading}
              style={{
                padding: "10px 22px",
                background: "var(--accent)",
                color: "#fff",
                border: "none",
                cursor: loading ? "wait" : "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                borderRadius: 3,
                letterSpacing: "0.04em",
                opacity: loading ? 0.6 : 1,
                transition: "opacity .2s",
              }}
            >
              {loading ? "Resolving..." : "Resolve"}
            </button>
          </div>

          {error ? (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                background: "rgba(220,38,38,0.06)",
                border: "1px solid var(--danger)",
                borderRadius: 3,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--danger)",
              }}
            >
              {error}
            </div>
          ) : null}

          <p
            style={{
              marginTop: 14,
              marginBottom: 0,
              fontSize: 12,
              color: "var(--text-3)",
              lineHeight: 1.6,
            }}
          >
            Reads directly from the SigilRegistry and ProvenanceNotary contracts on
            0G Galileo testnet. No wallet required, no auth — every resolution hits the
            chain in real time.
          </p>
        </div>
      </div>

      {loading ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 0",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-3)",
          }}
        >
          <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>
            o
          </span>{" "}
          querying 0G Galileo...
        </div>
      ) : null}

      {!loading && result ? <ResultView result={result} onSelectRecord={selectRecord} /> : null}
    </div>
  );
}

function ResultView({
  result,
  onSelectRecord,
}: {
  result: ResolveResult;
  onSelectRecord: (id: Hex32) => void;
}) {
  if (result.kind === "passport") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Banner color="var(--accent)" title="RESOLVED → AgentPassport">
          on-chain identity record + permission manifest hash + linked provenance
        </Banner>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 16,
          }}
        >
          <IdentityCard passport={result.passport} />
          <PermissionManifestCard passport={result.passport} />
        </div>
        <RecordsList recordIds={result.records} onSelect={onSelectRecord} />
      </div>
    );
  }

  if (result.kind === "address") {
    if (!result.passport) {
      return (
        <Banner color="var(--danger)" title="NO PASSPORT FOUND">
          address {shortHex(result.query)} is not registered as an authorized agent
        </Banner>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Banner color="var(--accent)" title="RESOLVED → Agent Address → AgentPassport">
          {shortHex(result.query)} signs for passport {shortHex(result.passport.passportId)}
        </Banner>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
            gap: 16,
          }}
        >
          <IdentityCard passport={result.passport} />
          <PermissionManifestCard passport={result.passport} />
        </div>
      </div>
    );
  }

  if (result.kind === "record") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Banner color="var(--sealed)" title="RESOLVED → ProvenanceRecord → Agent → Principal">
          backward chain: artifact resolved to producing agent and human principal
        </Banner>
        <RecordDetailCard
          record={result.record}
          passport={result.passport}
          verified={result.verified}
        />
      </div>
    );
  }

  if (result.kind === "output") {
    if (!result.record) {
      return (
        <Banner color="var(--accent)" title="OUTPUT HASH MATCHED">
          recordId {shortHex(result.recordId)} — but record metadata could not be loaded
        </Banner>
      );
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Banner color="var(--sealed)" title="RESOLVED → Output Hash → ProvenanceRecord">
          this artifact was notarized as record {shortHex(result.recordId)}
        </Banner>
        <RecordDetailCard
          record={result.record}
          passport={null}
          verified={{ valid: true, reason: "" }}
        />
      </div>
    );
  }

  if (result.kind === "notfound") {
    return (
      <Banner color="var(--danger)" title="NOT FOUND">
        {shortHex(result.query)} is not a registered passportId, recordId, or output hash on
        SigilRegistry / ProvenanceNotary
      </Banner>
    );
  }

  return (
    <Banner color="var(--danger)" title="INVALID INPUT">
      expected a 32-byte hex (passportId, recordId, output hash) or 20-byte address
    </Banner>
  );
}

function Banner({
  color,
  title,
  children,
}: {
  color: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "12px 16px",
        border: `1px solid ${color}`,
        borderRadius: 3,
        background: `color-mix(in srgb, ${color} 6%, transparent)`,
        fontFamily: "var(--font-mono)",
        animation: "fade-up .3s ease both",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          color,
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-2)" }}>{children}</div>
    </div>
  );
}
