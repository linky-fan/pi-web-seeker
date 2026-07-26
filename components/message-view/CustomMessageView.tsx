"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { normalizeMarkdownMath } from "@/lib/markdown";
import { isSubagentCustomType, messageContentToText, parseSubagentNotifications, type SubagentNotification } from "@/lib/subagents";
import type { CustomMessage } from "@/lib/types";
import { ComsNetMessageCard } from "./ComsNetMessageCard";
import { formatAgentName, formatCompactNumber, formatDurationMs, formatTime, getSubagentStatusStyle, parseComsNetMessage } from "./helpers";
import { MESSAGE_REHYPE_PLUGINS, MESSAGE_REMARK_PLUGINS } from "./markdownConfig";

function CustomMessageViewImpl({ message, showTimestamp }: { message: CustomMessage; showTimestamp?: boolean }) {
  if (message.display === false) return null;

  const content = messageContentToText(message.content);
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const isSubagent = isSubagentCustomType(message.customType, message.content);
  const comsNet = parseComsNetMessage(message.customType, content, message.details);

  if (comsNet) {
    return (
      <div className="pi-message pi-message-custom" style={{ marginBottom: 16 }}>
        <ComsNetMessageCard event={comsNet} />
        {time && <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-dim)" }}>{time}</div>}
      </div>
    );
  }

  if (isSubagent) {
    const notifications = parseSubagentNotifications(content, message.details);
    if (notifications.length > 0) {
      return (
        <div className="pi-message pi-message-custom" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {notifications.map((notification, i) => (
              <SubagentNotificationCard key={notification.id ?? i} notification={notification} />
            ))}
          </div>
          {time && <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-dim)" }}>{time}</div>}
        </div>
      );
    }
  }

  return (
    <div className="pi-message pi-message-custom" style={{ marginBottom: 16 }}>
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={MESSAGE_REMARK_PLUGINS} rehypePlugins={MESSAGE_REHYPE_PLUGINS}>
          {normalizeMarkdownMath(content)}
        </ReactMarkdown>
      </div>
      {time && <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-dim)" }}>{time}</div>}
    </div>
  );
}


function SubagentNotificationCard({ notification }: { notification: SubagentNotification }) {
  const [expanded, setExpanded] = useState(false);
  const status = getSubagentStatusStyle(notification.status);
  const agentName = formatAgentName(notification.id);
  const agentLabel = notification.agentType ? `${notification.agentType} / ${agentName}` : agentName;
  const preview = notification.error || notification.resultPreview || "No output.";
  const parts: string[] = [];
  if (notification.turnCount && notification.turnCount > 0) {
    parts.push(notification.maxTurns ? `${notification.turnCount}/${notification.maxTurns} turns` : `${notification.turnCount} turns`);
  }
  if (notification.toolUses && notification.toolUses > 0) parts.push(`${notification.toolUses} tool uses`);
  if (notification.totalTokens && notification.totalTokens > 0) parts.push(`${formatCompactNumber(notification.totalTokens)} tokens`);
  if (notification.contextPercent && notification.contextPercent > 0) parts.push(`${Math.round(notification.contextPercent)}% ctx`);
  if (notification.compactionCount && notification.compactionCount > 0) parts.push(`${notification.compactionCount} compact`);
  if (notification.durationMs && notification.durationMs > 0) parts.push(formatDurationMs(notification.durationMs));

  return (
    <div
      className={`pi-status-card pi-subagent-card pi-status-card-${status.kind}`}
      style={{
        border: `1px solid ${status.border}`,
        borderLeft: `3px solid ${status.color}`,
        background: `linear-gradient(135deg, ${status.bg}, var(--bg-panel))`,
        borderRadius: 7,
        overflow: "hidden",
        fontSize: 13,
        boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        title={expanded ? "Hide subagent result" : "Show subagent result"}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--text)",
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 34,
            height: 28,
            borderRadius: 6,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: status.color,
            background: "var(--bg)",
            border: `1px solid ${status.border}`,
            fontSize: 9,
            fontWeight: 800,
            letterSpacing: 0.2,
            flexShrink: 0,
          }}
        >
          SUB
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, marginBottom: 3 }}>
            <span style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              height: 18,
              padding: "0 7px",
              borderRadius: 4,
              border: `1px solid ${status.border}`,
              background: "var(--bg)",
              color: status.color,
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              flexShrink: 0,
            }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="5" r="2" />
                <circle cx="6" cy="17" r="2" />
                <circle cx="18" cy="17" r="2" />
                <path d="M12 7v4" />
                <path d="M6 15l6-4 6 4" />
              </svg>
              Subagent run
            </span>
            <span style={{ color: "var(--text-dim)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {agentLabel}
            </span>
          </span>
          <span style={{ display: "block", fontWeight: 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.25 }}>
            {notification.description}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, color: "var(--text-dim)", fontSize: 11, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: status.color, fontWeight: 600 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: status.color, display: "inline-block" }} />
              {status.label}
            </span>
            {parts.map((part) => (
              <span key={part} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "var(--text-dim)" }}>/</span>
                {part}
              </span>
            ))}
          </span>
        </span>
        <span
          aria-hidden="true"
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text-dim)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
            <polyline points="2 3.5 5 6.5 8 3.5" />
          </svg>
        </span>
      </button>

      {expanded && (
        <div
          style={{
            padding: "0 10px 10px 42px",
            color: notification.error ? "#f87171" : "var(--text-muted)",
            fontSize: 12,
            lineHeight: 1.5,
          }}
        >
          <div
            style={{
              border: "1px solid var(--border)",
              background: "var(--bg)",
              borderRadius: 6,
              padding: "8px 9px",
            }}
          >
            <div style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>
              {notification.error ? "Error" : "Result"}
            </div>
            <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 420, overflow: "auto" }}>
              {preview}
            </div>
          </div>
          {notification.outputFile && (
            <div style={{ marginTop: 8, color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={notification.outputFile}>
              transcript: {notification.outputFile}
            </div>
          )}
          {notification.toolCallId && (
            <div style={{ marginTop: 4, color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={notification.toolCallId}>
              tool call: {notification.toolCallId}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export const CustomMessageView = memo(CustomMessageViewImpl);
