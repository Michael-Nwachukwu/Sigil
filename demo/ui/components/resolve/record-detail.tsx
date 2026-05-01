"use client";

import { useEffect, useState } from "react";

import {
  ARTIFACT_TYPE_LABEL,
  fetchProvenanceEnvelope,
  formatTimestamp,
  type PassportRecord,
  type ProvenanceEnvelopeResult,
  type ProvenanceRecord,
} from "../../lib/sigil-read";
import { ChainValue } from "../shared/primitives";

export function RecordDetailCard({
  record,
  passport,
  verified,
}: {
  record: ProvenanceRecord;
  passport: PassportRecord | null;
  verified: { valid: boolean; reason: string };
}) {
  const sealed =
    record.modelFingerprintHash !==
    "0x0000000000000000000000000000000000000000000000000000000000000000";

  const [envelope, setEnvelope] = useState<ProvenanceEnvelopeResult | null>(null);
  const [envelopeLoading, setEnvelopeLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setEnvelopeLoading(true);
    fetchProvenanceEnvelope(
      record.executionFingerprintRef,
      record.outputHash,
      record.modelFingerprintHash,
    )
      .then((result) => {
        if (!cancelled) {
          setEnvelope(result);
          setEnvelopeLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEnvelope({ status: "error", reason: (err as Error).message });
          setEnvelopeLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [record.executionFingerprintRef, record.outputHash, record.modelFingerprintHash]);

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
          ProvenanceRecord · Detail
        </span>
        <span
          className={verified.valid ? "tag tag-ok" : "tag"}
          style={{
            borderColor: verified.valid ? "var(--ok)" : "var(--danger)",
            color: verified.valid ? "var(--ok)" : "var(--danger)",
          }}
          title={verified.reason}
        >
          {verified.valid ? "verified" : "invalid"}
        </span>
      </div>

      <div style={{ padding: 20 }}>
        <OutputPanel envelope={envelope} loading={envelopeLoading} />

        <div
          style={{
            marginBottom: 16,
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
              letterSpacing: "0.08em",
              color: "var(--accent)",
              marginBottom: 6,
            }}
          >
            WHAT THIS RECORD ACTUALLY PROVES
          </div>
          <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.7 }}>
            This is the on-chain provenance envelope, not the raw artifact body. It proves that
            an authorized agent notarized a{" "}
            {ARTIFACT_TYPE_LABEL[record.artifactType] ?? "GENERIC_REPORT"} artifact at{" "}
            {formatTimestamp(record.timestamp)} using model {record.modelId || "—"}, with a fixed
            output hash, input-context hash, nonce, signer, and proof reference. The detailed
            report text or private inputs live off-chain by design.
          </div>
        </div>

        {[
          { label: "recordId", value: record.recordId, kind: "hash" as const },
          { label: "passportId", value: record.passportId, kind: "hash" as const },
          {
            label: "artifactType",
            value: ARTIFACT_TYPE_LABEL[record.artifactType] ?? "?",
            kind: "text" as const,
          },
          { label: "modelId", value: record.modelId || "—", kind: "text" as const },
          { label: "outputHash", value: record.outputHash, kind: "hash" as const },
          { label: "inputContextHash", value: record.inputContextHash, kind: "hash" as const },
          {
            label: "inputContextSize",
            value: `${record.inputContextSize.toString()} bytes`,
            kind: "text" as const,
          },
          {
            label: "modelFingerprintHash",
            value: record.modelFingerprintHash,
            kind: "hash" as const,
          },
          { label: "nonce", value: record.nonce.toString(), kind: "text" as const },
          { label: "timestamp", value: formatTimestamp(record.timestamp), kind: "text" as const },
          { label: "blockNumber", value: record.blockNumber.toString(), kind: "text" as const },
          {
            label: "executionFingerprintRef",
            value: record.executionFingerprintRef,
            kind: "hash" as const,
          },
        ].map((entry) => (
          <div
            key={entry.label}
            style={{
              display: "grid",
              gridTemplateColumns: "180px 1fr",
              gap: 12,
              padding: "8px 0",
              borderBottom: "1px solid var(--border)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
            }}
          >
            <span style={{ color: "var(--text-3)" }}>{entry.label}</span>
            {entry.kind === "hash" ? (
              <ChainValue value={entry.value} kind="hash" />
            ) : (
              <span style={{ color: "var(--text-2)", wordBreak: "break-all" }}>{entry.value}</span>
            )}
          </div>
        ))}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "180px 1fr",
            gap: 12,
            padding: "8px 0",
            borderBottom: "1px solid var(--border)",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          <span style={{ color: "var(--text-3)" }}>agent</span>
          <ChainValue value={record.agent} kind="address" />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "180px 1fr",
            gap: 12,
            padding: "8px 0",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
          }}
        >
          <span style={{ color: "var(--text-3)" }}>principal</span>
          <ChainValue value={record.principal} kind="address" />
        </div>

        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            background: sealed && verified.valid ? "rgba(34,197,94,0.06)" : "rgba(200,120,48,0.06)",
            border: `1px solid ${sealed && verified.valid ? "var(--ok)" : "var(--unsealed)"}`,
            borderRadius: 3,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: sealed && verified.valid ? "var(--ok)" : "var(--unsealed)",
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            artifact → agent → principal · chain resolved
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-3)",
            }}
          >
            {sealed && verified.valid
              ? "EIP-712 agent signature recovers; agent registered as authorized signer for passport"
              : verified.reason || "agent-attested only — no TEE inference receipt"}
          </div>
          {passport ? (
            <div
              style={{
                marginTop: 6,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-3)",
              }}
            >
              producing passport: <ChainValue value={passport.passportId} kind="hash" /> ·
              reputation {passport.reputationScore.toString()}/1000 · {passport.taskCount.toString()} tasks
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OutputPanel({
  envelope,
  loading,
}: {
  envelope: ProvenanceEnvelopeResult | null;
  loading: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  const headerColor =
    envelope?.status === "v2"
      ? "var(--ok)"
      : envelope?.status === "v2-tampered"
        ? "var(--danger)"
        : "var(--accent)";

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div style={{ fontSize: 12, color: "var(--text-3)" }}>
        Fetching envelope from 0G Storage…
      </div>
    );
  } else if (!envelope) {
    body = (
      <div style={{ fontSize: 12, color: "var(--text-3)" }}>No envelope data.</div>
    );
  } else if (envelope.status === "v2") {
    const text = envelope.output;
    const PREVIEW = 1200;
    const overflows = text.length > PREVIEW;
    const shown = expanded || !overflows ? text : text.slice(0, PREVIEW) + "…";
    body = (
      <>
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: "var(--bg-base)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-1)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: expanded ? "none" : 360,
            overflow: "auto",
          }}
        >
          {shown}
        </pre>
        <div
          style={{
            marginTop: 8,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-3)",
          }}
        >
          <span>
            {text.length.toLocaleString()} chars · {envelope.outputContentType ?? "text/plain"} · output
            hash re-verified against on-chain anchor
          </span>
          {overflows ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{
                background: "transparent",
                color: "var(--accent)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "2px 8px",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
              }}
            >
              {expanded ? "collapse" : "expand"}
            </button>
          ) : null}
        </div>
      </>
    );
  } else if (envelope.status === "v2-tampered") {
    body = (
      <div style={{ fontSize: 12, color: "var(--danger)", lineHeight: 1.6 }}>
        ENVELOPE REJECTED — {envelope.reason}. The off-chain bytes do not match the on-chain
        anchor, so the output below is not displayed.
      </div>
    );
  } else if (envelope.status === "v1-or-unknown") {
    body = (
      <div style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>
        Output not embedded in this envelope (legacy v1 record — only the sealed-inference proof
        was written to 0G Storage). On-chain hashes are still verifiable; future agent runs use
        the v2 envelope which inlines the output.
      </div>
    );
  } else if (envelope.status === "missing") {
    body = (
      <div style={{ fontSize: 12, color: "var(--text-3)" }}>
        No executionFingerprintRef on this record.
      </div>
    );
  } else {
    body = (
      <div style={{ fontSize: 12, color: "var(--danger)" }}>
        Could not load envelope — {envelope.reason}
      </div>
    );
  }

  return (
    <div
      style={{
        marginBottom: 16,
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
          letterSpacing: "0.08em",
          color: headerColor,
          marginBottom: 8,
        }}
      >
        WHAT THE AGENT PRODUCED
      </div>
      {body}
    </div>
  );
}
