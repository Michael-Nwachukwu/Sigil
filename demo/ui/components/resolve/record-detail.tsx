"use client";

import {
  ARTIFACT_TYPE_LABEL,
  EXPLORER_URL,
  formatTimestamp,
  shortHex,
  type PassportRecord,
  type ProvenanceRecord,
} from "../../lib/sigil-read";

export function RecordDetailCard({
  record,
  passport,
  verified,
}: {
  record: ProvenanceRecord;
  passport: PassportRecord | null;
  verified: { valid: boolean; reason: string };
}) {
  const sealed = record.modelFingerprintHash !== "0x0000000000000000000000000000000000000000000000000000000000000000";

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
        {[
          ["recordId", record.recordId, true],
          ["passportId", record.passportId, true],
          ["artifactType", ARTIFACT_TYPE_LABEL[record.artifactType] ?? "?", false],
          ["modelId", record.modelId || "—", false],
          ["outputHash", record.outputHash, true],
          ["inputContextHash", record.inputContextHash, true],
          ["inputContextSize", `${record.inputContextSize.toString()} bytes`, false],
          ["modelFingerprintHash", record.modelFingerprintHash, true],
          ["nonce", record.nonce.toString(), false],
          ["timestamp", formatTimestamp(record.timestamp), false],
          ["blockNumber", record.blockNumber.toString(), false],
          ["executionFingerprintRef", record.executionFingerprintRef, true],
        ].map(([label, value, mono]) => (
          <div
            key={label as string}
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
            <span style={{ color: "var(--text-3)" }}>{label as string}</span>
            <span
              style={{
                color: mono ? "var(--accent)" : "var(--text-2)",
                wordBreak: "break-all",
              }}
            >
              {value as string}
            </span>
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
          <a
            href={`${EXPLORER_URL}/address/${record.agent}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--accent)",
              textDecoration: "none",
              borderBottom: "1px dashed var(--border-strong)",
              wordBreak: "break-all",
            }}
          >
            {record.agent}
          </a>
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
          <a
            href={`${EXPLORER_URL}/address/${record.principal}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "var(--accent)",
              textDecoration: "none",
              borderBottom: "1px dashed var(--border-strong)",
              wordBreak: "break-all",
            }}
          >
            {record.principal}
          </a>
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
              producing passport: <span style={{ color: "var(--accent)" }}>{shortHex(passport.passportId)}</span>{" "}
              · reputation {passport.reputationScore.toString()}/1000 · {passport.taskCount.toString()} tasks
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
