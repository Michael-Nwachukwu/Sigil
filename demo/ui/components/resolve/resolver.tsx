"use client";

import { useMemo, useState } from "react";

import {
  ARTIFACT_TYPE_LABEL,
  detectInputKind,
  EXAMPLE_LOOKUPS,
  shortHex,
  smartResolve,
  type Hex32,
  type ResolveResult,
} from "../../lib/sigil-read";
import { IdentityCard, PermissionManifestCard } from "./identity-card";
import { RecentActivityPanel } from "./recent-activity";
import { RecordDetailCard } from "./record-detail";
import { RecordsList } from "./records-list";

type LookupMode = "agent" | "artifact" | "verify";

const MODE_META: Record<
  LookupMode,
  {
    title: string;
    helper: string;
    placeholder: string;
    expects: string;
  }
> = {
  agent: {
    title: "Look up an agent",
    helper:
      "Resolve who is behind an autonomous agent. Paste a 32-byte passportId or the agent's 20-byte signing address — both land on the AgentPassport identity.",
    placeholder: "passportId (0x… 32 bytes) or agent address (0x… 20 bytes)",
    expects: "passportId · agent address",
  },
  artifact: {
    title: "Look up an artifact",
    helper:
      "Resolve a notarized output back to the agent that produced it. Paste the 32-byte recordId issued at notarize time. Returns the full provenance envelope.",
    placeholder: "recordId (0x… 32 bytes)",
    expects: "recordId",
  },
  verify: {
    title: "Verify an output you already have",
    helper:
      "You hold an artifact and want to confirm it was actually notarized. Paste the keccak256 of the output bytes — Sigil checks it against the on-chain registry.",
    placeholder: "outputHash (keccak256 of the artifact bytes)",
    expects: "outputHash",
  },
};

export function Resolver() {
  const [mode, setMode] = useState<LookupMode>("agent");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(query?: string) {
    const value = (query ?? input).trim();
    if (!value) {
      setError(`paste a ${MODE_META[mode].expects} to resolve`);
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
    setMode("artifact");
    setInput(recordId);
    void run(recordId);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function applyExample(value: string) {
    setInput(value);
    void run(value);
  }

  const inputKind = useMemo(
    () => (input.trim() ? detectInputKind(input.trim()) : "unknown"),
    [input],
  );

  const meta = MODE_META[mode];
  const examples = EXAMPLE_LOOKUPS[mode];

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

        <div style={{ padding: "16px 20px 0", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(Object.keys(MODE_META) as LookupMode[]).map((key) => {
            const active = key === mode;
            return (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setMode(key);
                  setError(null);
                }}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: `1px solid ${active ? "var(--accent)" : "var(--border-strong)"}`,
                  background: active ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-2)",
                  cursor: "pointer",
                  transition: "all .15s",
                }}
              >
                {key === "agent"
                  ? "1. Look up an agent"
                  : key === "artifact"
                    ? "2. Look up an artifact"
                    : "3. Verify an output"}
              </button>
            );
          })}
        </div>

        <div style={{ padding: 20 }}>
          <h2
            style={{
              fontSize: 18,
              margin: 0,
              marginBottom: 6,
              color: "var(--text)",
              fontWeight: 600,
            }}
          >
            {meta.title}
          </h2>
          <p
            style={{
              margin: 0,
              marginBottom: 14,
              fontSize: 13,
              color: "var(--text-2)",
              lineHeight: 1.65,
            }}
          >
            {meta.helper}
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void run();
                }
              }}
              placeholder={meta.placeholder}
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

          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-3)",
                letterSpacing: "0.08em",
              }}
            >
              TRY:
            </span>
            {examples.map((example) => (
              <button
                key={example.value}
                type="button"
                onClick={() => applyExample(example.value)}
                title={`${example.detail} · ${example.value}`}
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--border-strong)",
                  background: "transparent",
                  color: "var(--text-2)",
                  cursor: "pointer",
                  transition: "border-color .15s, color .15s",
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.borderColor = "var(--accent)";
                  event.currentTarget.style.color = "var(--accent)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.borderColor = "var(--border-strong)";
                  event.currentTarget.style.color = "var(--text-2)";
                }}
              >
                {example.label}
              </button>
            ))}
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
        </div>
      </div>

      <div className="resolve-shell">
        <div style={{ minWidth: 0 }}>
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

          {!loading && result ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <ResultSummary mode={mode} result={result} />
              <ResultView result={result} onSelectRecord={selectRecord} />
            </div>
          ) : null}
          {!loading && !result ? <ResolverGuide mode={mode} /> : null}
        </div>

        <RecentActivityPanel
          onSelectQuery={(value) => {
            setInput(value);
            void run(value);
          }}
        />
      </div>
    </div>
  );
}

function ResultSummary({ mode, result }: { mode: LookupMode; result: ResolveResult }) {
  const lines = summarize(mode, result);
  if (lines.length === 0) {
    return null;
  }

  return (
    <div
      className="card"
      style={{
        animation: "fade-up .3s ease both",
        borderColor: "var(--accent)",
      }}
    >
      <div className="card-header">
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--accent)",
          }}
        >
          What you are looking at
        </span>
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        {lines.map((line, index) => (
          <p
            key={index}
            style={{
              margin: 0,
              fontSize: 13,
              color: "var(--text-2)",
              lineHeight: 1.7,
            }}
          >
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function summarize(mode: LookupMode, result: ResolveResult): string[] {
  if (result.kind === "passport") {
    const p = result.passport;
    const principalShort = shortHex(p.principal);
    const agentShort = shortHex(p.agentAddress);
    return [
      `This is the AgentPassport iNFT for an autonomous agent. The principal ${principalShort} owns the passport; the agent at ${agentShort} is the authorized autonomous signer.`,
      `It has notarized ${p.provenanceRecordCount.toString()} ${p.provenanceRecordCount === 1n ? "artifact" : "artifacts"}. ${
        p.taskCount === 0n
          ? "Task counters and reputation stay at zero until the keeper relay appends capability attestations on the separate relay path — that's expected for the demo."
          : `It carries reputation ${p.reputationScore.toString()}/1000 across ${p.taskCount.toString()} attested tasks.`
      }`,
      `The permission manifest hash on the right is the keccak256 of the encrypted permissions blob in 0G Storage KV — only the principal can decrypt it.`,
    ];
  }

  if (result.kind === "address") {
    if (!result.passport) {
      return [
        `The address ${shortHex(result.query)} has no AgentPassport registered against it. That means it has never been authorized as a Sigil agent — anything it signs is unattested.`,
      ];
    }
    return [
      `${shortHex(result.query)} is the autonomous agent wallet. It signs notarizations on behalf of principal ${shortHex(result.passport.principal)} via the AgentPassport below.`,
      `The principal authorized this address once at registration; every signed notarization since then inherits that authorization.`,
    ];
  }

  if (result.kind === "record") {
    const r = result.record;
    const artifactName = ARTIFACT_TYPE_LABEL[r.artifactType] ?? "artifact";
    return [
      `This is a ProvenanceRecord — the on-chain envelope for a ${artifactName} produced by an authorized agent. The full report body is off-chain by design; the chain stores only hashes, the EIP-712 signature, and the nonce.`,
      `Backward chain resolved: artifact → agent ${shortHex(r.agent)} → principal ${shortHex(r.principal)}. The record was notarized at ${new Date(Number(r.timestamp) * 1000).toLocaleString()}.`,
      mode === "verify"
        ? `Because this came from an outputHash lookup, you've now confirmed: the bytes you hold map to a real notarized record on Galileo testnet.`
        : `The model that produced it: ${r.modelId || "(unattested)"}. ${
            r.modelFingerprintHash !== "0x0000000000000000000000000000000000000000000000000000000000000000"
              ? "Includes a sealed-inference proof reference."
              : "No sealed-inference receipt was attached — agent-attested only."
          }`,
    ];
  }

  if (result.kind === "output") {
    if (!result.record) {
      return [
        `The output hash matched recordId ${shortHex(result.recordId)} on-chain, but the record metadata could not be loaded. Try pasting the recordId directly under the artifact tab.`,
      ];
    }
    return [
      `The bytes you hashed match a notarized artifact. RecordId ${shortHex(result.recordId)} produced by agent ${shortHex(result.record.agent)} for principal ${shortHex(result.record.principal)}.`,
      `Use this when a third party hands you a deliverable claiming "an agent signed this." If the keccak256 of their bytes resolves here, the claim holds.`,
    ];
  }

  if (result.kind === "notfound") {
    return [
      `${shortHex(result.query)} is well-formed but does not exist on SigilRegistry / ProvenanceNotary. It may be from a different network, or never have been notarized in the first place.`,
    ];
  }

  return [
    `That input doesn't match the shape of a passportId, recordId, output hash, or agent address. Sigil expects 0x-prefixed 32-byte hex (most lookups) or a 20-byte address (agent lookup).`,
  ];
}

function ResolverGuide({ mode }: { mode: LookupMode }) {
  const meta = MODE_META[mode];
  return (
    <div className="card" style={{ animation: "fade-up .3s ease both" }}>
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
          {meta.title}
        </span>
      </div>
      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", lineHeight: 1.7 }}>
          {mode === "agent"
            ? "Use this when you've been handed an agent identifier and want to know who runs it, what it can do, and what it has produced. The right-hand rail lists indexed agents you can click to start."
            : mode === "artifact"
              ? "Use this when you have a recordId (the receipt issued at notarize time) and want to walk back to the agent and principal that produced it."
              : "Use this when you only have the artifact bytes — hash them with keccak256, paste the digest, and Sigil tells you whether anyone has notarized it on this network."}
        </p>
        <div
          style={{
            padding: "12px 14px",
            border: "1px solid var(--border)",
            borderRadius: 10,
            background: "var(--bg-raised)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--accent)",
              marginBottom: 8,
            }}
          >
            How to get one of these
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(mode === "agent"
              ? [
                  "An agent created via the SDK (`sigil.passport.register()`) returns its passportId on success.",
                  "An agent using the current SKILL.md + local SDK flow should store its passportId locally — ask it to report it.",
                  "Or click an example chip above to use one of the indexed testnet agents.",
                ]
              : mode === "artifact"
                ? [
                    "Calling `sigil.provenance.notarize()` returns the recordId in the result.",
                    "ProvenanceNotary emits `ArtifactNotarized(recordId, …)` — explorers and indexers carry it too.",
                    "Or click an example chip to inspect a real notarized record on Galileo.",
                  ]
                : [
                    "Compute keccak256 of the artifact bytes you received (see SDK helper `hashOutput()`).",
                    "Paste the resulting 32-byte digest above.",
                    "If it resolves, you have proof of who notarized it; if it doesn't, the claim is unverified.",
                  ]
            ).map((line) => (
              <div key={line} style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.65 }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
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
