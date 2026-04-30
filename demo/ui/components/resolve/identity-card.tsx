"use client";

import {
  EXPLORER_URL,
  formatTimestamp,
  shortHex,
  type PassportRecord,
} from "../../lib/sigil-read";

function repPercent(score: bigint): string {
  const n = Number(score);
  if (n <= 0) return "0%";
  if (n >= 1000) return "100%";
  return `${(n / 10).toFixed(1)}%`;
}

export function IdentityCard({ passport }: { passport: PassportRecord }) {
  return (
    <div
      className="card"
      style={{ animation: "fade-up .3s ease both" }}
    >
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
          AgentPassport · Identity
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: passport.active ? "var(--ok)" : "var(--danger)",
              boxShadow: passport.active ? "0 0 5px var(--ok)" : "none",
              animation: passport.active ? "pulse-dot 2s ease infinite" : "none",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: passport.active ? "var(--ok)" : "var(--danger)",
              letterSpacing: "0.06em",
            }}
          >
            {passport.active ? "ACTIVE" : "REVOKED"}
          </span>
        </span>
      </div>

      <div style={{ padding: 20 }}>
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-3)",
              letterSpacing: "0.08em",
              marginBottom: 4,
            }}
          >
            PASSPORT ID
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--accent)",
              wordBreak: "break-all",
              background: "var(--code-bg)",
              padding: "8px 12px",
              borderRadius: 3,
              lineHeight: 1.5,
            }}
          >
            {passport.passportId}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            marginBottom: 14,
          }}
        >
          {[
            ["PRINCIPAL", passport.principal],
            ["AGENT ADDRESS", passport.agentAddress],
          ].map(([label, address]) => (
            <div key={label}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--text-3)",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                {label}
              </div>
              <a
                href={`${EXPLORER_URL}/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-2)",
                  textDecoration: "none",
                  borderBottom: "1px dashed var(--border-strong)",
                }}
              >
                {shortHex(address)}
              </a>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 12,
            marginBottom: 14,
          }}
        >
          {[
            ["TOKEN ID", passport.tokenId.toString()],
            ["TASKS", passport.taskCount.toString()],
            ["FAILURES", passport.failureCount.toString()],
            ["RECORDS", passport.provenanceRecordCount.toString()],
            ["FINGERPRINTS", passport.executionFingerprintCount.toString()],
          ].map(([label, value]) => (
            <div key={label}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--text-3)",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                {label}
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text)" }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-3)",
                letterSpacing: "0.08em",
              }}
            >
              REPUTATION
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text)" }}>
              {passport.reputationScore.toString()} / 1000
            </span>
          </div>
          <div style={{ height: 4, background: "var(--border-strong)", borderRadius: 2, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: repPercent(passport.reputationScore),
                background: "linear-gradient(90deg,var(--accent),var(--ok))",
                borderRadius: 2,
                transition: "width .8s ease",
              }}
            />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-3)",
          }}
        >
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", marginBottom: 4 }}>CREATED AT</div>
            <div style={{ color: "var(--text-2)" }}>
              {formatTimestamp(passport.createdAt)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", marginBottom: 4 }}>BLOCK</div>
            <div style={{ color: "var(--text-2)" }}>{passport.createdBlock.toString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PermissionManifestCard({ passport }: { passport: PassportRecord }) {
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
          Permission Manifest
        </span>
        <span className="tag tag-accent">AES-256-GCM · 0G KV</span>
      </div>
      <div style={{ padding: 20 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-3)",
            letterSpacing: "0.08em",
            marginBottom: 6,
          }}
        >
          MANIFEST HASH (KECCAK256 OF CIPHERTEXT)
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--accent)",
            wordBreak: "break-all",
            background: "var(--code-bg)",
            padding: "8px 12px",
            borderRadius: 3,
            lineHeight: 1.5,
            marginBottom: 14,
          }}
        >
          {passport.permissionManifestHash}
        </div>

        <p
          style={{
            fontSize: 12,
            color: "var(--text-3)",
            lineHeight: 1.6,
            margin: 0,
          }}
        >
          The manifest itself lives encrypted in 0G Storage KV under the passport namespace.
          Only the principal can decrypt it — the on-chain hash binds the ciphertext so any
          tampering is detectable. To inspect the plaintext, query KV with your principal
          signature using the SDK.
        </p>
      </div>
    </div>
  );
}
