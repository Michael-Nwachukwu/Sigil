"use client";

import { useEffect, useState } from "react";

import { formatTimestamp, type PassportRecord } from "../../lib/sigil-read";
import {
  decryptManifestInBrowser,
  type ManifestDecryptResult,
} from "../../lib/manifest-decrypt";
import { ChainValue } from "../shared/primitives";

function repPercent(score: bigint): string {
  const n = Number(score);
  if (n <= 0) return "0%";
  if (n >= 1000) return "100%";
  return `${(n / 10).toFixed(1)}%`;
}

export function IdentityCard({ passport }: { passport: PassportRecord }) {
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
            <ChainValue value={passport.passportId} kind="hash" full color="var(--accent)" />
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
              <ChainValue value={address} kind="address" color="var(--text-2)" />
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
          <div
            style={{ height: 4, background: "var(--border-strong)", borderRadius: 2, overflow: "hidden" }}
          >
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
          {passport.taskCount > 0n && passport.taskCount < 5n ? (
            <div
              style={{
                marginTop: 8,
                fontSize: 12,
                color: "var(--text-3)",
                lineHeight: 1.6,
              }}
            >
              Early score warning: this is a tiny sample. A score of{" "}
              {passport.reputationScore.toString()} / 1000 after{" "}
              {passport.taskCount.toString()} attested{" "}
              {passport.taskCount === 1n ? "task" : "tasks"} means "perfect so far,"
              not "battle-tested."
            </div>
          ) : null}
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
            <div style={{ color: "var(--text-2)" }}>{formatTimestamp(passport.createdAt)}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.08em", marginBottom: 4 }}>BLOCK</div>
            <div style={{ color: "var(--text-2)" }}>{passport.createdBlock.toString()}</div>
          </div>
        </div>

        {passport.provenanceRecordCount > 0n &&
        passport.taskCount === 0n &&
        passport.failureCount === 0n &&
        passport.executionFingerprintCount === 0n ? (
          <div
            style={{
              marginTop: 14,
              padding: "12px 14px",
              border: "1px solid var(--border)",
              borderRadius: 10,
              background: "var(--bg-raised)",
              fontSize: 12,
              color: "var(--text-2)",
              lineHeight: 1.65,
            }}
          >
            This agent has notarized artifacts, so `records` increased. `tasks`, `failures`,
            `fingerprints`, and `reputation` stay at zero until the keeper relay appends
            execution fingerprints and capability attestations on the separate relay path.
          </div>
        ) : null}
      </div>
    </div>
  );
}

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

function getEthereumProvider(): EthereumProvider | null {
  if (typeof window === "undefined") {
    return null;
  }
  const candidate = (window as Window & { ethereum?: EthereumProvider }).ethereum;
  return candidate ?? null;
}

export function PermissionManifestCard({ passport }: { passport: PassportRecord }) {
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [walletStatus, setWalletStatus] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [manifestResult, setManifestResult] = useState<ManifestDecryptResult | null>(null);

  useEffect(() => {
    const provider = getEthereumProvider();
    if (!provider) {
      return;
    }
    void provider
      .request({ method: "eth_accounts" })
      .then((result) => {
        const accounts = result as string[];
        setConnectedAddress(accounts[0] ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setManifestResult(null);
  }, [passport.passportId, connectedAddress]);

  const matchesPrincipal =
    connectedAddress?.toLowerCase() === passport.principal.toLowerCase();

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
          <ChainValue
            value={passport.permissionManifestHash}
            kind="hash"
            full
            color="var(--accent)"
          />
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
          Only the principal can decrypt it. The on-chain hash binds the ciphertext so any
          tampering is detectable.
        </p>

        <div
          style={{
            marginTop: 14,
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={async () => {
              const provider = getEthereumProvider();
              if (!provider) {
                setWalletStatus("No injected wallet found in this browser.");
                return;
              }

              try {
                const result = await provider.request({ method: "eth_requestAccounts" });
                const accounts = result as string[];
                const next = accounts[0] ?? null;
                setConnectedAddress(next);
                setWalletStatus(
                  next
                    ? "Wallet connected. Match it against the principal address below."
                    : "Wallet connected, but no account was returned.",
                );
              } catch (err) {
                setWalletStatus(`Wallet connection failed: ${(err as Error).message}`);
              }
            }}
          >
            {connectedAddress ? "Reconnect principal wallet" : "Connect principal wallet"}
          </button>
          {connectedAddress ? (
            <span style={{ fontSize: 12, color: "var(--text-2)" }}>
              connected:{" "}
              <ChainValue value={connectedAddress} kind="address" color="var(--text-2)" />
            </span>
          ) : null}
          {matchesPrincipal ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={decrypting}
              onClick={async () => {
                const provider = getEthereumProvider();
                if (!provider || !connectedAddress) {
                  setManifestResult({
                    status: "error",
                    reason: "Connect the recorded principal wallet first.",
                  });
                  return;
                }

                setDecrypting(true);
                setManifestResult(null);
                const result = await decryptManifestInBrowser({
                  passport,
                  wallet: provider,
                  account: connectedAddress,
                });
                setManifestResult(result);
                setDecrypting(false);
              }}
              style={{
                opacity: decrypting ? 0.75 : 1,
                cursor: decrypting ? "wait" : "pointer",
              }}
            >
              {decrypting ? "Decrypting..." : "Decrypt manifest"}
            </button>
          ) : null}
        </div>

        <div
          style={{
            marginTop: 14,
            padding: "12px 14px",
            border: `1px solid ${
              connectedAddress
                ? matchesPrincipal
                  ? "var(--ok)"
                  : "var(--unsealed)"
                : "var(--border)"
            }`,
            borderRadius: 10,
            background: connectedAddress
              ? matchesPrincipal
                ? "rgba(34,197,94,0.06)"
                : "var(--unsealed-dim)"
              : "var(--bg-raised)",
            fontSize: 12,
            color: "var(--text-2)",
            lineHeight: 1.65,
          }}
        >
          {connectedAddress ? (
            matchesPrincipal ? (
              <>
                Connected wallet matches the principal. That means this wallet can derive the
                manifest decryption key locally by signing the passport-specific message. You can
                decrypt the ciphertext in-browser without exporting secrets or leaving this page.
              </>
            ) : (
              <>
                Connected wallet does not match the recorded principal for this passport, so it
                should not be able to decrypt the manifest plaintext.
              </>
            )
          ) : (
            <>
              Connect a wallet to check whether you are the recorded principal. If you are, use
              the same wallet with the SDK to query and decrypt the manifest.
            </>
          )}
        </div>

        {walletStatus ? (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-3)", lineHeight: 1.6 }}>
            {walletStatus}
          </div>
        ) : null}

        {manifestResult ? (
          <div
            style={{
              marginTop: 14,
              padding: "12px 14px",
              border: `1px solid ${
                manifestResult.status === "ok" ? "var(--ok)" : "var(--danger)"
              }`,
              borderRadius: 10,
              background:
                manifestResult.status === "ok"
                  ? "rgba(34,197,94,0.06)"
                  : "rgba(239,68,68,0.06)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: "0.08em",
                color: manifestResult.status === "ok" ? "var(--ok)" : "var(--danger)",
                marginBottom: 8,
              }}
            >
              {manifestResult.status === "ok"
                ? "DECRYPTED MANIFEST"
                : "DECRYPT FAILED"}
            </div>
            {manifestResult.status === "ok" ? (
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  lineHeight: 1.7,
                  color: "var(--text-2)",
                  background: "var(--code-bg)",
                  padding: "12px 14px",
                  borderRadius: 8,
                  overflowX: "auto",
                }}
              >
                {typeof manifestResult.manifest === "string"
                  ? manifestResult.manifest
                  : JSON.stringify(manifestResult.manifest, null, 2)}
              </pre>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.65 }}>
                {manifestResult.reason}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
