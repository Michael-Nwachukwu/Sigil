"use client";

import { useEffect, useState } from "react";
import type { Eip1193Provider } from "ethers";
import { BrowserProvider, Contract } from "ethers";
import { SigilMark, HashDisplay, OnChainLink } from "../../../components/shared/primitives";
import deployments from "../../../../../deployments/galileo-testnet.json";

const CHAIN_ID = deployments.chainId;
const CHAIN_ID_HEX = "0x" + CHAIN_ID.toString(16);
const REGISTRY_ADDRESS = deployments.contracts.SigilRegistry;
const EXPLORER_URL = deployments.explorerUrl;

const REGISTRY_ABI = [
  "function register(bytes32 passportId, address principal, address agentAddress, bytes32 permissionManifestHash, string metadataUri) external",
] as const;

interface PendingData {
  requestId: string;
  agentAddress: string;
  passportId: string;
  agentDescription: string;
  permissions: Record<string, unknown>;
  permissionManifestHash: string;
  createdAt: number;
  expiresAt: number;
}

type PageState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; data: PendingData }
  | { phase: "connecting" }
  | { phase: "wrong-wallet"; connected: string; expected: string }
  | { phase: "signing"; data: PendingData; walletAddress: string }
  | { phase: "sending"; data: PendingData; walletAddress: string }
  | { phase: "done"; txHash: string; passportId: string }
  | { phase: "already-approved" };

function ts(ms: number) {
  return new Date(ms).toLocaleString();
}

function PermissionsTable({ perms }: { perms: Record<string, unknown> }) {
  return (
    <div
      style={{
        background: "var(--code-bg)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        padding: 14,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--text-2)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {JSON.stringify(perms, null, 2)}
    </div>
  );
}

export default function ApprovePage({
  params,
}: {
  params: { requestId: string };
}) {
  const { requestId } = params;
  const [state, setState] = useState<PageState>({ phase: "loading" });
  const [principalAddress, setPrincipalAddress] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/passport/register/status/${requestId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setState({ phase: "error", message: data.error });
          return;
        }
        if (data.status === "approved") {
          setState({ phase: "already-approved" });
          return;
        }
        if (data.status === "pending") {
          setState({ phase: "ready", data: data as PendingData });
          return;
        }
        setState({ phase: "error", message: `Unknown status: ${data.status}` });
      })
      .catch((err) => {
        setState({ phase: "error", message: String(err) });
      });
  }, [requestId]);

  async function connectAndApprove() {
    if (
      state.phase !== "ready" &&
      state.phase !== "wrong-wallet" &&
      state.phase !== "signing"
    )
      return;
    const data =
      state.phase === "ready"
        ? state.data
        : state.phase === "wrong-wallet"
          ? (state as unknown as { data: PendingData }).data
          : (state as { data: PendingData }).data;

    if (!window.ethereum) {
      setState({
        phase: "error",
        message: "No browser wallet found. Install MetaMask or another EVM wallet.",
      });
      return;
    }

    setState({ phase: "connecting" });

    let provider: BrowserProvider;
    let walletAddress: string;
    try {
      provider = new BrowserProvider(window.ethereum as Eip1193Provider);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      walletAddress = await signer.getAddress();
      setPrincipalAddress(walletAddress);
    } catch (err) {
      setState({ phase: "error", message: `Wallet connect failed: ${String(err)}` });
      return;
    }

    // Check network
    const network = await provider.getNetwork();
    if (Number(network.chainId) !== CHAIN_ID) {
      try {
        await provider.send("wallet_switchEthereumChain", [{ chainId: CHAIN_ID_HEX }]);
      } catch {
        try {
          await provider.send("wallet_addEthereumChain", [
            {
              chainId: CHAIN_ID_HEX,
              chainName: "0G-Galileo-Testnet",
              nativeCurrency: { name: "OG", symbol: "OG", decimals: 18 },
              rpcUrls: ["https://evmrpc-testnet.0g.ai"],
              blockExplorerUrls: [EXPLORER_URL],
            },
          ]);
        } catch (err2) {
          setState({
            phase: "error",
            message: `Please switch your wallet to 0G Galileo Testnet (chainId ${CHAIN_ID}): ${String(err2)}`,
          });
          return;
        }
      }
    }

    setState({ phase: "signing", data, walletAddress });
  }

  async function submitApproval() {
    if (state.phase !== "signing") return;
    const { data, walletAddress } = state;

    const provider = new BrowserProvider(window.ethereum as Eip1193Provider);
    const signer = await provider.getSigner();

    // Sign the approval proof message
    const approvalMessage = `sigil-approve:${requestId}`;
    let principalSignature: string;
    try {
      principalSignature = await signer.signMessage(approvalMessage);
    } catch (err) {
      setState({ phase: "error", message: `Signature rejected: ${String(err)}` });
      return;
    }

    setState({ phase: "sending", data, walletAddress });

    // Call SigilRegistry.register() directly from the browser
    const registry = new Contract(REGISTRY_ADDRESS, REGISTRY_ABI, signer);
    let txHash: string;
    let confirmedPassportId: string = data.passportId;

    try {
      const tx = await registry.register(
        data.passportId,
        walletAddress,
        data.agentAddress,
        data.permissionManifestHash,
        "", // metadataUri — empty for API-sponsored registrations
      );
      const receipt = await tx.wait();
      txHash = receipt.hash ?? tx.hash;

      // Parse AgentRegistered event if emitted (passportId confirmation)
      if (receipt.logs) {
        for (const log of receipt.logs) {
          if (log.topics && log.topics[1]) {
            confirmedPassportId = log.topics[1];
            break;
          }
        }
      }
    } catch (err) {
      setState({ phase: "error", message: `Transaction failed: ${String(err)}` });
      return;
    }

    // Notify the API server that registration was approved
    try {
      const res = await fetch(`/api/v1/passport/approve/${requestId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash,
          passportId: confirmedPassportId,
          principalSignature,
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        console.warn("Approve API call failed (tx already landed):", errBody);
      }
    } catch (err) {
      console.warn("Approve API call threw (tx already landed):", err);
    }

    setState({ phase: "done", txHash, passportId: confirmedPassportId });
  }

  return (
    <div
      data-theme="vault"
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--font-body-src), sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        padding: "48px 16px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 32,
        }}
      >
        <SigilMark size={32} />
        <span
          style={{
            fontFamily: "var(--font-display-src)",
            fontSize: 22,
            letterSpacing: "-0.01em",
            color: "var(--text)",
          }}
        >
          Sigil Protocol
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono-src)",
            fontSize: 11,
            color: "var(--accent)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            background: "var(--accent-dim)",
            padding: "2px 8px",
            borderRadius: 4,
          }}
        >
          Agent Approval
        </span>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 540,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Loading */}
        {state.phase === "loading" && (
          <Card>
            <div style={{ color: "var(--text-2)", padding: 24, textAlign: "center" }}>
              Loading registration request…
            </div>
          </Card>
        )}

        {/* Error */}
        {state.phase === "error" && (
          <Card>
            <div
              style={{
                padding: 20,
                color: "var(--danger)",
                fontFamily: "var(--font-mono-src)",
                fontSize: 13,
              }}
            >
              {state.message}
            </div>
          </Card>
        )}

        {/* Already approved */}
        {state.phase === "already-approved" && (
          <Card>
            <div
              style={{
                padding: 24,
                textAlign: "center",
                color: "var(--ok)",
                fontSize: 15,
              }}
            >
              This registration has already been approved.
            </div>
          </Card>
        )}

        {/* Done */}
        {state.phase === "done" && (
          <Card>
            <div
              style={{
                padding: 24,
                display: "flex",
                flexDirection: "column",
                gap: 16,
              }}
            >
              <div
                style={{ color: "var(--ok)", fontSize: 16, fontWeight: 600 }}
              >
                Agent registered successfully
              </div>
              <Row label="passportId">
                <HashDisplay hash={state.passportId} />
              </Row>
              <Row label="Transaction">
                <OnChainLink hash={state.txHash} type="tx" label="View on explorer" />
              </Row>
              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: "var(--accent-dim)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "var(--text-2)",
                  lineHeight: 1.6,
                }}
              >
                The agent can now poll{" "}
                <code
                  style={{
                    fontFamily: "var(--font-mono-src)",
                    color: "var(--accent)",
                  }}
                >
                  GET /api/v1/passport/register/status/{requestId}
                </code>{" "}
                to receive its private key and begin notarizing outputs.
              </div>
            </div>
          </Card>
        )}

        {/* Ready / Connecting / Wrong wallet / Signing / Sending */}
        {(state.phase === "ready" ||
          state.phase === "connecting" ||
          state.phase === "wrong-wallet" ||
          state.phase === "signing" ||
          state.phase === "sending") && (() => {
          const data =
            state.phase === "ready"
              ? state.data
              : state.phase === "wrong-wallet"
                ? null
                : (state as { data: PendingData }).data;
          if (!data) return null;

          return (
            <>
              {/* Agent info card */}
              <Card>
                <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                  <SectionLabel>Registration Request</SectionLabel>
                  <Row label="Request ID">
                    <span style={{ fontFamily: "var(--font-mono-src)", fontSize: 12, color: "var(--text-2)" }}>
                      {requestId.slice(0, 8)}…{requestId.slice(-4)}
                    </span>
                  </Row>
                  <Row label="Agent address">
                    <span style={{ fontFamily: "var(--font-mono-src)", fontSize: 12, color: "var(--accent)" }}>
                      {data.agentAddress.slice(0, 10)}…{data.agentAddress.slice(-6)}
                    </span>
                  </Row>
                  <Row label="Passport ID">
                    <HashDisplay hash={data.passportId} />
                  </Row>
                  <Row label="Expires">
                    <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                      {ts(data.expiresAt)}
                    </span>
                  </Row>
                </div>
              </Card>

              {/* Description + permissions */}
              <Card>
                <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                  <SectionLabel>Agent Description</SectionLabel>
                  <p style={{ margin: 0, fontSize: 14, color: "var(--text)", lineHeight: 1.6 }}>
                    {data.agentDescription}
                  </p>
                  <SectionLabel style={{ marginTop: 8 }}>Requested Permissions</SectionLabel>
                  <PermissionsTable perms={data.permissions} />
                </div>
              </Card>

              {/* Warning */}
              <div
                style={{
                  padding: 12,
                  background: "var(--sealed-dim)",
                  border: "1px solid var(--sealed)",
                  borderRadius: 6,
                  fontSize: 12,
                  color: "var(--sealed)",
                  lineHeight: 1.6,
                }}
              >
                You are about to mint an ERC-7857 AgentPassport on 0G Galileo Testnet. This
                transaction permanently binds the agent address to your wallet (principal). Review
                the permissions above before approving.
              </div>

              {/* Wallet status */}
              {state.phase === "wrong-wallet" && (
                <div
                  style={{
                    padding: 12,
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid var(--danger)",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "var(--danger)",
                  }}
                >
                  Wrong wallet connected ({state.connected.slice(0, 10)}…). The
                  principal must be{" "}
                  {state.expected.slice(0, 10)}….
                </div>
              )}

              {/* Action buttons */}
              {(state.phase === "ready" || state.phase === "wrong-wallet") && (
                <button
                  onClick={connectAndApprove}
                  style={btnStyle("accent")}
                >
                  Connect Wallet &amp; Review
                </button>
              )}

              {state.phase === "connecting" && (
                <button disabled style={btnStyle("muted")}>
                  Connecting…
                </button>
              )}

              {state.phase === "signing" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div
                    style={{
                      padding: 12,
                      background: "var(--accent-dim)",
                      borderRadius: 6,
                      fontSize: 12,
                      color: "var(--accent)",
                    }}
                  >
                    Connected as{" "}
                    <span style={{ fontFamily: "var(--font-mono-src)" }}>
                      {state.walletAddress.slice(0, 10)}…{state.walletAddress.slice(-4)}
                    </span>
                  </div>
                  <button
                    onClick={submitApproval}
                    style={btnStyle("accent")}
                  >
                    Sign &amp; Register Agent On-Chain
                  </button>
                </div>
              )}

              {state.phase === "sending" && (
                <button disabled style={btnStyle("muted")}>
                  Sending transaction…
                </button>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--card-bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "var(--shadow)",
      }}
    >
      {children}
    </div>
  );
}

function SectionLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono-src)",
        fontSize: 10,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--text-3)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        borderBottom: "1px solid var(--border)",
        paddingBottom: 8,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono-src)",
          fontSize: 11,
          color: "var(--text-3)",
          letterSpacing: "0.04em",
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

function btnStyle(variant: "accent" | "muted"): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    padding: "14px 0",
    borderRadius: 6,
    border: "none",
    cursor: variant === "accent" ? "pointer" : "default",
    fontFamily: "var(--font-body-src), sans-serif",
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "0.02em",
    background: variant === "accent" ? "var(--accent)" : "var(--bg-overlay)",
    color: variant === "accent" ? "#000" : "var(--text-3)",
    opacity: variant === "muted" ? 0.7 : 1,
    transition: "opacity .15s",
  };
}

declare global {
  interface Window {
    ethereum?: unknown;
  }
}
