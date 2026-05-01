"use client";

import { useEffect, useState } from "react";

import {
  ARTIFACT_TYPE_LABEL,
  formatTimestamp,
  resolveRecord,
  verifyRecord,
  type Hex32,
  type ProvenanceRecord,
} from "../../lib/sigil-read";
import { ChainValue } from "../shared/primitives";

type Row = {
  id: Hex32;
  record: ProvenanceRecord | null;
  verified: { valid: boolean; reason: string } | null;
  error: string | null;
  loading: boolean;
};

export function RecordsList({
  recordIds,
  onSelect,
}: {
  recordIds: Hex32[];
  onSelect?: (recordId: Hex32) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    recordIds.map((id) => ({ id, record: null, verified: null, error: null, loading: true })),
  );

  useEffect(() => {
    let cancelled = false;
    setRows(
      recordIds.map((id) => ({ id, record: null, verified: null, error: null, loading: true })),
    );

    (async () => {
      for (const id of recordIds) {
        try {
          const [record, verified] = await Promise.all([resolveRecord(id), verifyRecord(id)]);
          if (cancelled) return;
          setRows((previous) =>
            previous.map((row) =>
              row.id === id ? { ...row, record, verified, loading: false } : row,
            ),
          );
        } catch (err) {
          if (cancelled) return;
          setRows((previous) =>
            previous.map((row) =>
              row.id === id
                ? { ...row, error: (err as Error).message, loading: false }
                : row,
            ),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recordIds]);

  if (recordIds.length === 0) {
    return (
      <div
        style={{
          padding: "24px 18px",
          border: "1px dashed var(--border-strong)",
          borderRadius: 3,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-3)",
          textAlign: "center",
        }}
      >
        no provenance records yet — this agent has not notarized any artifacts
      </div>
    );
  }

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
          Provenance Records · {recordIds.length}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(180px, 240px) 120px minmax(180px, 1fr) 120px 90px",
          gap: 8,
          padding: "0 20px",
        }}
      >
        {["RECORD ID", "TYPE", "OUTPUT HASH", "TIME", "VERIFIED"].map((header) => (
          <div
            key={header}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: "var(--text-3)",
              letterSpacing: "0.12em",
              padding: "12px 0 8px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            {header}
          </div>
        ))}

        {rows.flatMap((row) => {
          const cells: React.ReactNode[] = [];
          const idCell = (
            <div
              key={`${row.id}-id`}
              style={{
                padding: "10px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <ChainValue value={row.id} kind="hash" />
                {onSelect ? (
                  <button
                    type="button"
                    onClick={() => onSelect(row.id)}
                    style={{
                      width: "fit-content",
                      padding: "5px 8px",
                      borderRadius: 999,
                      border: "1px solid var(--border-strong)",
                      background: "transparent",
                      color: "var(--text-2)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      cursor: "pointer",
                    }}
                  >
                    open detail
                  </button>
                ) : null}
              </div>
            </div>
          );
          cells.push(idCell);

          if (row.loading) {
            cells.push(
              <div
                key={`${row.id}-loading`}
                style={{
                  gridColumn: "span 4",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-3)",
                }}
              >
                resolving...
              </div>,
            );
            return cells;
          }

          if (row.error || !row.record) {
            cells.push(
              <div
                key={`${row.id}-error`}
                style={{
                  gridColumn: "span 4",
                  padding: "10px 0",
                  borderBottom: "1px solid var(--border)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--danger)",
                }}
              >
                {row.error ?? "record not found"}
              </div>,
            );
            return cells;
          }

          cells.push(
            <div
              key={`${row.id}-type`}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--text-2)",
                padding: "10px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {ARTIFACT_TYPE_LABEL[row.record.artifactType] ?? "?"}
            </div>,
            <div
              key={`${row.id}-output`}
              style={{
                padding: "10px 0",
                borderBottom: "1px solid var(--border)",
                wordBreak: "break-all",
              }}
            >
              <ChainValue value={row.record.outputHash} kind="hash" color="var(--text-2)" />
            </div>,
            <div
              key={`${row.id}-time`}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-3)",
                padding: "10px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              {formatTimestamp(row.record.timestamp)}
            </div>,
            <div
              key={`${row.id}-verified`}
              style={{
                padding: "10px 0",
                borderBottom: "1px solid var(--border)",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: row.verified?.valid ? "var(--ok)" : "var(--danger)",
              }}
              title={row.verified?.reason ?? ""}
            >
              {row.verified?.valid ? "valid" : "invalid"}
            </div>,
          );

          return cells;
        })}
      </div>
    </div>
  );
}
