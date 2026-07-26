"use client";

import { memo } from "react";
import type { ComsNetEvent } from "./types";

function ComsNetMessageCardImpl({ event }: { event: ComsNetEvent }) {
  const isError = Boolean(event.error);
  const isInbound = event.direction === "inbound" || event.direction === "response-in";
  const color = isError ? "#f87171" : isInbound ? "#0ea5e9" : "#16a34a";
  const bg = isError ? "rgba(248,113,113,0.06)" : isInbound ? "rgba(14,165,233,0.07)" : "rgba(34,197,94,0.06)";
  const border = isError ? "rgba(248,113,113,0.45)" : isInbound ? "rgba(14,165,233,0.35)" : "rgba(34,197,94,0.32)";
  const tinyMonoStyle = { fontFamily: "var(--font-mono)", fontSize: 11 } as const;
  const label = event.direction === "inbound"
    ? "From teammate"
    : event.direction === "outbound"
      ? "To teammate"
      : event.direction === "response-in"
        ? "From teammate"
        : "To teammate";

  return (
    <div
      className={`pi-status-card pi-coms-card pi-coms-card-${event.direction}${isError ? " pi-status-card-error" : ""}`}
      style={{
        border: `1px solid ${border}`,
        borderLeft: `3px solid ${color}`,
        background: `linear-gradient(135deg, ${bg}, var(--bg-panel))`,
        borderRadius: 7,
        overflow: "hidden",
        fontSize: 13,
        boxShadow: "0 4px 14px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ display: "flex", gap: 9, padding: "9px 10px", minWidth: 0 }}>
        <span
          aria-hidden="true"
          style={{
            width: 34,
            height: 28,
            borderRadius: 6,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color,
            background: "var(--bg)",
            border: `1px solid ${border}`,
            fontSize: 9,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          NET
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 5 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 18,
                padding: "0 7px",
                borderRadius: 4,
                border: `1px solid ${border}`,
                background: "var(--bg)",
                color,
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
              }}
            >
              {label}
            </span>
            <span style={{ color: "var(--text)", fontWeight: 650 }}>{event.title}</span>
            <span style={{ color: "var(--text-dim)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {event.peer}
            </span>
          </div>

          {event.prompt && (
            <ComsNetDetail label="Request" text={event.prompt} />
          )}
          {event.response && (
            <ComsNetDetail label={event.error ? "Error" : "Response"} text={event.error ?? event.response} isError={Boolean(event.error)} />
          )}
          {!event.response && event.error && (
            <ComsNetDetail label="Error" text={event.error} isError />
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: event.prompt || event.response || event.error ? 8 : 0, color: "var(--text-dim)", fontSize: 11 }}>
            {event.status && <span>status: <span style={tinyMonoStyle}>{event.status}</span></span>}
            {event.msgId && <span>msg: <span style={tinyMonoStyle}>{event.msgId}</span></span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function ComsNetDetail({ label, text, isError }: { label: string; text: string; isError?: boolean }) {
  return (
    <div style={{ marginTop: 7 }}>
      <div style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div
        style={{
          border: "1px solid var(--border)",
          background: "var(--bg)",
          borderRadius: 6,
          padding: "7px 8px",
          color: isError ? "#f87171" : "var(--text-muted)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: 240,
          overflow: "auto",
          lineHeight: 1.45,
          fontSize: 12,
        }}
      >
        {text}
      </div>
    </div>
  );
}


export const ComsNetMessageCard = memo(ComsNetMessageCardImpl);
