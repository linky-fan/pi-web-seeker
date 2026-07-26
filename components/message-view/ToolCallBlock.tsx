"use client";

import { memo, useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n";
import type { ToolCallContent, ToolExecutionStatus, ToolResultMessage } from "@/lib/types";
import { formatDurationBrief, formatToolInput, getToolPreview, toolResultText, toolTimeoutSeconds } from "./helpers";

function ToolCallBlockImpl({ block, result, isRunning, liveStatus, duration, missingDuration }: { block: ToolCallContent; result?: ToolResultMessage; isRunning?: boolean; liveStatus?: ToolExecutionStatus; duration?: number; missingDuration?: number }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const inputStr = formatToolInput(block.input);
  const timeout = toolTimeoutSeconds(block.input);

  useEffect(() => {
    if (!isRunning) {
      setElapsed(0);
      return;
    }
    const started = liveStatus?.startedAt ?? Date.now();
    setNowMs(Date.now());
    const interval = window.setInterval(() => {
      const now = Date.now();
      setNowMs(now);
      setElapsed(Math.max(1, Math.round((now - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isRunning, liveStatus?.startedAt]);

  // Result display
  const resultText = toolResultText(result);
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "");
  const isError = result?.isError ?? false;
  const isTimedOut = Boolean(isError && resultText && /\btimed?\s*out\b|\btimeout\b/i.test(resultText));
  const isMissingResult = !result && !isRunning;
  const secondsSinceUpdate = isRunning && liveStatus?.updatedAt
    ? Math.max(0, Math.round(((nowMs || liveStatus.updatedAt) - liveStatus.updatedAt) / 1000))
    : 0;
  const hasLiveOutput = Boolean(liveStatus?.outputText.trim());
  const showNoOutputWarning = Boolean(isRunning && elapsed >= 60 && (!hasLiveOutput || secondsSinceUpdate >= 60));
  const toolColor = isError ? "#f87171" : isRunning ? "var(--accent)" : isMissingResult ? "#f59e0b" : "#16a34a";
  const borderColor = isError
    ? "rgba(248,113,113,0.45)"
    : isRunning
      ? "rgba(96,165,250,0.35)"
      : isMissingResult
        ? "rgba(245,158,11,0.38)"
        : "rgba(34,197,94,0.25)";
  const background = isError
    ? "rgba(248,113,113,0.05)"
    : isRunning
      ? "rgba(96,165,250,0.06)"
      : isMissingResult
        ? "rgba(245,158,11,0.07)"
        : "rgba(34,197,94,0.04)";

  return (
    <div
      className={`pi-tool-card${isRunning ? " pi-tool-running" : ""}${isError ? " pi-tool-error" : ""}${isMissingResult ? " pi-tool-missing" : ""}`}
      style={{
        borderRadius: 7,
        overflow: "hidden",
        fontSize: 12,
        border: `1px solid ${borderColor}`,
        background,
      }}
    >
      {/* ── Tool call header ── */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          width: "100%",
          padding: "6px 10px",
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span style={{ color: toolColor, fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 11, flexShrink: 0 }}>
          {block.toolName}
        </span>
        {isRunning && (
          <span style={{ color: "var(--accent)", fontSize: 10, flexShrink: 0 }}>
            {t("message.tool.running")} {elapsed > 0 ? formatDurationBrief(elapsed) : ""}
          </span>
        )}
        {isMissingResult && (
          <span style={{ color: "#f59e0b", fontSize: 10, flexShrink: 0 }}>
            {t("message.tool.missingResult")}
          </span>
        )}
        {!isRunning && !isMissingResult && isTimedOut && (
          <span style={{ color: "#f87171", fontSize: 10, flexShrink: 0 }}>
            {t("message.tool.timedOut")}
          </span>
        )}
        {!isRunning && !isMissingResult && isError && !isTimedOut && (
          <span style={{ color: "#f87171", fontSize: 10, flexShrink: 0 }}>
            {t("message.tool.error")}
          </span>
        )}
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
          {getToolPreview(block)}
        </span>
        {timeout !== null && (
          <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
            {t("message.tool.timeout", { duration: formatDurationBrief(timeout) })}
          </span>
        )}
        {duration !== undefined && (
          <span style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{duration}s</span>
        )}
        {isMissingResult && missingDuration !== undefined && (
          <span style={{ fontSize: 11, color: "#f59e0b", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
            {t("message.tool.missingAfter", { duration: formatDurationBrief(missingDuration) })}
          </span>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>

      {/* ── Expanded: input args ── */}
      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: "8px 10px",
            color: "var(--text-muted)",
            fontSize: 12,
            lineHeight: 1.5,
            overflow: "auto",
            background: "var(--bg-subtle)",
            borderTop: isError ? "1px solid rgba(248,113,113,0.25)" : "1px solid rgba(34,197,94,0.2)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
          }}
        >
          {inputStr}
        </pre>
      )}

      {isMissingResult && (
        <div style={{
          padding: "6px 10px",
          borderTop: "1px solid rgba(245,158,11,0.22)",
          color: "var(--text-dim)",
          fontSize: 11,
          lineHeight: 1.45,
        }}>
          {missingDuration !== undefined
            ? t("message.tool.missingAfterHint", { duration: formatDurationBrief(missingDuration) })
            : t("message.tool.missingHint")}
        </div>
      )}

      {isRunning && (hasLiveOutput || showNoOutputWarning) && (
        <div style={{
          padding: "7px 10px",
          borderTop: "1px solid rgba(96,165,250,0.18)",
          color: "var(--text-dim)",
          fontSize: 11,
          lineHeight: 1.45,
          background: "rgba(96,165,250,0.04)",
        }}>
          {showNoOutputWarning && (
            <div style={{ marginBottom: hasLiveOutput ? 6 : 0, color: "#f59e0b" }}>
              {t("message.tool.noRecentOutput", { duration: formatDurationBrief(secondsSinceUpdate || elapsed) })}
            </div>
          )}
          {hasLiveOutput && (
            <>
              <div style={{ marginBottom: 4, fontWeight: 600, color: "var(--text-muted)" }}>
                {t("message.tool.latestOutput")}
              </div>
              <pre style={{
                margin: 0,
                maxHeight: 140,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: 11,
                lineHeight: 1.45,
                color: "var(--text-muted)",
              }}>
                {liveStatus!.outputText}
              </pre>
            </>
          )}
        </div>
      )}

      {/* ── Paired result — only shown when expanded ── */}
      {expanded && result && (
        <PairedResult
          text={resultText ?? ""}
          isEmpty={resultIsEmpty}
          isError={isError}
        />
      )}
    </div>
  );
}

function PairedResult({ text, isEmpty, isError }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  return (
    <div
      style={{
        borderTop: `1px solid ${isError ? "rgba(248,113,113,0.3)" : "rgba(34,197,94,0.15)"}`,
        background: isError ? "rgba(248,113,113,0.04)" : "var(--bg-subtle)",
      }}
    >
      <pre
        style={{
          margin: 0,
          padding: "8px 10px",
          color: isError ? "#f87171" : (isEmpty ? "var(--text-dim)" : "var(--text-muted)"),
          fontSize: 12,
          lineHeight: 1.5,
          overflow: "auto",
          maxHeight: 400,
          background: "var(--bg)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          fontStyle: isEmpty ? "italic" : "normal",
          opacity: isEmpty ? 0.6 : 1,
        }}
      >
        {isEmpty ? "(no output)" : text}
      </pre>
    </div>
  );
}



export const ToolCallBlock = memo(ToolCallBlockImpl, (previous, next) =>
  previous.block === next.block
    && previous.result === next.result
    && previous.isRunning === next.isRunning
    && previous.liveStatus === next.liveStatus
    && previous.duration === next.duration
    && previous.missingDuration === next.missingDuration,
);
