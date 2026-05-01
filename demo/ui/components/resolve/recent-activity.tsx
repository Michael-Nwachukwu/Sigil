"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ARTIFACT_TYPE_LABEL,
  recentActivity,
  type RecentActivityFeed,
  type RecentActivityItem,
} from "../../lib/sigil-read";
import { ChainValue } from "../shared/primitives";

function UseValueButton({
  label,
  value,
  onSelect,
}: {
  label: string;
  value: string;
  onSelect: (value: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        padding: "6px 10px",
        background: "transparent",
        border: "1px solid var(--border-strong)",
        borderRadius: 999,
        cursor: "pointer",
        color: "var(--text-2)",
        transition: "border-color .2s, color .2s, transform .15s",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = "var(--accent)";
        event.currentTarget.style.color = "var(--accent)";
        event.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = "var(--border-strong)";
        event.currentTarget.style.color = "var(--text-2)";
        event.currentTarget.style.transform = "translateY(0)";
      }}
      title={value}
    >
      use {label}
    </button>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "74px minmax(0, 1fr)",
        gap: 10,
        alignItems: "start",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-3)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function ActivityRow({
  item,
  onSelect,
}: {
  item: RecentActivityItem;
  onSelect: (value: string) => void;
}) {
  const actionSet = [
    item.passportId ? { label: "passportId", value: item.passportId } : null,
    item.recordId ? { label: "recordId", value: item.recordId } : null,
    item.outputHash ? { label: "outputHash", value: item.outputHash } : null,
    item.agentAddress ? { label: "agent", value: item.agentAddress } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <div
      style={{
        padding: "16px 0",
        borderTop: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span className={`tag ${item.kind === "registration" ? "tag-accent" : "tag-sealed"}`}>
          {item.kind === "registration" ? "passport registered" : "artifact notarized"}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-3)",
            letterSpacing: "0.06em",
          }}
          title={
            item.source === "live"
              ? "Discovered live from chain logs"
              : "Curated index of on-chain agents — every value resolves end-to-end"
          }
        >
          {item.source === "live"
            ? `live · block ${item.blockNumber ?? "?"}`
            : `on-chain · block ${item.blockNumber ?? "?"}`}
        </span>
      </div>

      <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.7 }}>
        {item.kind === "registration"
          ? "Newly registered agent identity. The owner should receive the passportId immediately, and the agent should be able to report it back later."
          : `Recent ${
              ARTIFACT_TYPE_LABEL[item.artifactType ?? 6] ?? "artifact"
            } proof. Consumers can resolve by recordId directly or by outputHash if the publisher carries it beside the artifact.`}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {item.passportId ? (
          <DetailRow label="passport">
            <ChainValue value={item.passportId} kind="hash" />
          </DetailRow>
        ) : null}
        {item.recordId ? (
          <DetailRow label="record">
            <ChainValue value={item.recordId} kind="hash" />
          </DetailRow>
        ) : null}
        {item.outputHash ? (
          <DetailRow label="output">
            <ChainValue value={item.outputHash} kind="hash" />
          </DetailRow>
        ) : null}
        {item.agentAddress ? (
          <DetailRow label="agent">
            <ChainValue value={item.agentAddress} kind="address" />
          </DetailRow>
        ) : null}
        {item.txHash ? (
          <DetailRow label="tx">
            <ChainValue value={item.txHash} kind="tx" />
          </DetailRow>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {actionSet.map((query) => (
          <UseValueButton
            key={`${item.id}-${query.label}`}
            label={query.label}
            value={query.value}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

export function RecentActivityPanel({
  onSelectQuery,
}: {
  onSelectQuery: (value: string) => void;
}) {
  const [feed, setFeed] = useState<RecentActivityFeed | null>(null);
  const [loading, setLoading] = useState(true);

  const loadFeed = useCallback(async () => {
    setLoading(true);
    const next = await recentActivity(6);
    setFeed(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const next = await recentActivity(6);
      if (!cancelled) {
        setFeed(next);
        setLoading(false);
      }
    })();

    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        void loadFeed();
      }
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [loadFeed]);

  const statusLabel =
    feed?.mode === "live"
      ? `live on-chain · ${feed.liveCount} recent events`
      : feed?.mode === "mixed"
        ? `${feed.liveCount} live + ${feed.indexedCount} indexed`
        : `${feed?.indexedCount ?? 0} indexed agents on testnet`;

  return (
    <div className="card resolve-sidebar" style={{ animation: "fade-up .3s ease both" }}>
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
          Discoverability · Recent activity
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-3)",
            letterSpacing: "0.06em",
          }}
        >
          {loading ? "refreshing..." : statusLabel}
        </span>
      </div>

      <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
        <div
          style={{
            padding: "12px 14px",
            border: "1px solid var(--border)",
            borderRadius: 12,
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
            where IDs come from
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              "Owners get passportId back from register().",
              "Agents should print passportId and recordId from local credentials.",
              "Consumers should receive recordId or outputHash with the artifact.",
            ].map((line) => (
              <div key={line} style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.65 }}>
                {line}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-3)",
              letterSpacing: "0.12em",
              marginBottom: 10,
            }}
          >
            SELECT A VALUE TO PREFILL THE RESOLVER
          </div>
          {loading ? (
            <div
              style={{
                padding: "24px 0",
                textAlign: "center",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-3)",
              }}
            >
              querying recent events from Galileo...
            </div>
          ) : feed ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {feed.mode === "indexed-only" ? (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 10,
                    background: "var(--bg-raised)",
                    fontSize: 12,
                    color: "var(--text-2)",
                    lineHeight: 1.6,
                  }}
                >
                  These are real agents and notarized records on Galileo testnet — every value
                  below resolves directly against SigilRegistry / ProvenanceNotary. The public
                  RPC throttles <code>eth_getLogs</code>, so live event discovery is best-effort;
                  this curated index is always up.
                </div>
              ) : null}
              {feed.items.map((item) => (
                <ActivityRow key={item.id} item={item} onSelect={onSelectQuery} />
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          style={{ justifyContent: "center", width: "100%" }}
          onClick={() => void loadFeed()}
        >
          Refresh recent activity
        </button>
      </div>
    </div>
  );
}
