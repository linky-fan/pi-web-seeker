"use client";

import { memo, useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useTheme } from "@/hooks/useTheme";
import { useLocale } from "@/lib/i18n";
import { markdownMathOptions, normalizeMarkdownMath } from "@/lib/markdown";
import { isSubagentCustomType, messageContentToText, parseSubagentNotifications, type SubagentNotification } from "@/lib/subagents";
import type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  ToolExecutionStatus,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  ToolCallContent,
  ThinkingContent,
  CustomMessage,
} from "@/lib/types";

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  runningToolIds?: Set<string>;
  toolExecutionStatuses?: Map<string, ToolExecutionStatus>;
  modelNames?: Record<string, string>;
  comsNetResponse?: ComsNetResponseHint;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  nextTimestamp?: number;
}

export interface ComsNetResponseHint {
  peer: string;
  msgId?: string;
}

function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch {
    return Promise.reject();
  }
}

function estimateToolInputLength(input: unknown): number {
  if (input === null || input === undefined) return 0;
  if (typeof input === "string") return input.length;
  try {
    return JSON.stringify(input).length;
  } catch {
    return 0;
  }
}

function estimateBlockChars(block: AssistantContentBlock): number {
  if (block.type === "text") return (block as TextContent).text?.length ?? 0;
  if (block.type === "thinking") return (block as ThinkingContent).thinking?.length ?? 0;
  if (block.type === "toolCall") return estimateToolInputLength((block as ToolCallContent).input);
  return 0;
}

export const MessageView = memo(function MessageView({ message, isStreaming, toolResults, runningToolIds, toolExecutionStatuses, modelNames, comsNetResponse, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent, showTimestamp, prevTimestamp, nextTimestamp }: Props) {
  if (message.role === "user") {
    const legacyComsNetEvent = parseLegacyComsNetUserMessage(message as UserMessage);
    if (legacyComsNetEvent) {
      return (
        <div style={{ marginBottom: 16 }}>
          <ComsNetMessageCard event={legacyComsNetEvent} />
        </div>
      );
    }
    return <UserMessageView message={message as UserMessage} entryId={entryId} onFork={onFork} forking={forking} onNavigate={onNavigate} prevAssistantEntryId={prevAssistantEntryId} onEditContent={onEditContent} />;
  }
  if (message.role === "assistant") {
    if (comsNetResponse) {
      const response = assistantMessageText(message as AssistantMessage);
      if (response) {
        return (
          <div style={{ marginBottom: 16 }}>
            <ComsNetMessageCard
              event={{
                direction: "response-out",
                title: "Answered coms-net request",
                peer: comsNetResponse.peer,
                response,
                msgId: comsNetResponse.msgId,
              }}
            />
          </div>
        );
      }
    }
    return <AssistantMessageView message={message as AssistantMessage} isStreaming={isStreaming} toolResults={toolResults} runningToolIds={runningToolIds} toolExecutionStatuses={toolExecutionStatuses} modelNames={modelNames} showTimestamp={showTimestamp} prevTimestamp={prevTimestamp} nextTimestamp={nextTimestamp} />;
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    return <CustomMessageView message={message as CustomMessage} showTimestamp={showTimestamp} />;
  }
  return null;
});

function UserMessageView({ message, entryId, onFork, forking, onNavigate, prevAssistantEntryId, onEditContent }: {
  message: UserMessage;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  onNavigate?: (entryId: string) => void;
  prevAssistantEntryId?: string;
  onEditContent?: (content: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);

  const content = messageContentToText(message.content);

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image");

  const time = formatTime(message.timestamp);
  const canFork = !!entryId && !!onFork;
  const canNavigate = !!prevAssistantEntryId && !!onNavigate;

  const copyContent = () => {
    copyText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      style={{ marginBottom: 16, display: "flex", flexDirection: "column", alignItems: "flex-end" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, maxWidth: "85%" }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--user-bg)",
            border: "1px solid rgba(59,130,246,0.2)",
            borderRadius: 12,
            padding: "8px 12px",
            fontSize: 14,
            lineHeight: 1.6,
            color: "var(--text)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {imageBlocks.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: content ? 8 : 0 }}>
              {imageBlocks.map((img, i) => {
                // lib/types.ts ImageContent uses {source:{type,data,media_type,url}}
                // pi-ai on-disk format uses flat {data, mimeType} — handle both
                const flat = img as unknown as { data?: string; mimeType?: string };
                const src = img.source
                  ? img.source.type === "base64"
                    ? `data:${img.source.media_type};base64,${img.source.data}`
                    : img.source.url ?? ""
                  : flat.data
                    ? `data:${flat.mimeType};base64,${flat.data}`
                    : "";
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={src}
                    alt=""
                    style={{ maxWidth: 240, maxHeight: 240, borderRadius: 6, objectFit: "contain", display: "block", border: "1px solid rgba(59,130,246,0.15)" }}
                  />
                );
              })}
            </div>
          )}
          {content}
        </div>

      </div>

      {/* Bottom row: action buttons + timestamp */}
      {(time || canFork || canNavigate || true) && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          gap: 6, marginTop: 3,
        }}>
          <div style={{
            display: "flex", gap: 3,
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? "auto" : "none",
            transition: "opacity 0.12s",
          }}>
            <button
              onClick={copyContent}
              title="Copy message"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "3px 8px", height: 22,
                background: "none", border: "none",
                borderRadius: 5,
                color: copied ? "var(--accent)" : "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11, fontWeight: 400,
                whiteSpace: "nowrap",
                transition: "color 0.12s",
              }}
              onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
              onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
            >
              {copied ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {(canFork || canNavigate) && (
            <div style={{
              display: "flex", gap: 3,
              opacity: (hovered || forking) ? 1 : 0,
              pointerEvents: (hovered || forking) ? "auto" : "none",
              transition: "opacity 0.12s",
            }}>
              {canNavigate && (
                <button
                  onClick={() => { onNavigate!(prevAssistantEntryId!); onEditContent?.(content); }}
                  title="Edit from here — branches within this session"
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: 22,
                    background: "none", border: "none",
                    borderRadius: 5,
                    color: "var(--text-dim)",
                    cursor: "pointer",
                    fontSize: 11, fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 10 20 15 15 20" />
                    <path d="M4 4v7a4 4 0 0 0 4 4h12" />
                  </svg>
                  Edit from here
                </button>
              )}
              {canFork && (
                <button
                  onClick={() => { onFork!(entryId!); }}
                  disabled={forking}
                  title={forking ? "Creating new session…" : "New session — creates an independent copy from here"}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "3px 8px", height: 22,
                    background: "none", border: "none",
                    borderRadius: 5,
                    color: forking ? "var(--accent)" : "var(--text-dim)",
                    cursor: forking ? "not-allowed" : "pointer",
                    fontSize: 11, fontWeight: 400,
                    whiteSpace: "nowrap",
                    transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!forking) e.currentTarget.style.color = "var(--accent)"; }}
                  onMouseLeave={(e) => { if (!forking) e.currentTarget.style.color = "var(--text-dim)"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  {forking ? "Creating…" : "New session"}
                </button>
              )}
            </div>
          )}
          {time && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{time}</span>}
        </div>
      )}
    </div>
  );
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function getSubagentStatusStyle(status: string): { label: string; kind: "done" | "active" | "error"; color: string; bg: string; border: string } {
  const s = status.toLowerCase();
  if (s === "error" || s === "stopped" || s === "aborted") {
    return { label: s, kind: "error", color: "#f87171", bg: "rgba(248,113,113,0.06)", border: "rgba(248,113,113,0.35)" };
  }
  if (s === "running" || s === "queued") {
    return { label: s, kind: "active", color: "var(--accent)", bg: "rgba(96,165,250,0.06)", border: "rgba(96,165,250,0.32)" };
  }
  return { label: s === "steered" ? "completed (steered)" : "completed", kind: "done", color: "#16a34a", bg: "rgba(34,197,94,0.05)", border: "rgba(34,197,94,0.28)" };
}

function formatAgentName(id?: string): string {
  if (!id) return "agent";
  return id
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function CustomMessageView({ message, showTimestamp }: { message: CustomMessage; showTimestamp?: boolean }) {
  if (message.display === false) return null;

  const content = messageContentToText(message.content);
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const isSubagent = isSubagentCustomType(message.customType, message.content);
  const comsNet = parseComsNetMessage(message.customType, content, message.details);

  if (comsNet) {
    return (
      <div style={{ marginBottom: 16 }}>
        <ComsNetMessageCard event={comsNet} />
        {time && <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-dim)" }}>{time}</div>}
      </div>
    );
  }

  if (isSubagent) {
    const notifications = parseSubagentNotifications(content, message.details);
    if (notifications.length > 0) {
      return (
        <div style={{ marginBottom: 16 }}>
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
    <div style={{ marginBottom: 16 }}>
      <div className="markdown-body">
        <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, markdownMathOptions]]} rehypePlugins={[rehypeKatex]}>
          {normalizeMarkdownMath(content)}
        </ReactMarkdown>
      </div>
      {time && <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-dim)" }}>{time}</div>}
    </div>
  );
}

type ComsNetDirection = "inbound" | "outbound" | "response-in" | "response-out";

interface ComsNetEvent {
  direction: ComsNetDirection;
  title: string;
  peer: string;
  prompt?: string;
  response?: string;
  msgId?: string;
  status?: string;
  error?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringifyDetail(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function assistantMessageText(message: AssistantMessage): string {
  return message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parseComsNetMessage(customType: string, content: string, details: unknown): ComsNetEvent | null {
  if (!customType.startsWith("coms-net-")) return null;
  const d = isRecord(details) ? details : {};
  const sender = isRecord(d.sender) ? d.sender : {};
  const target = isRecord(d.target) ? d.target : {};
  const peer = stringValue(sender.name) ?? stringValue(target.name) ?? stringValue(d.target) ?? "peer";
  const msgId = stringValue(d.msg_id);
  const status = stringValue(d.status);
  const prompt = stringValue(d.prompt) ?? content.replace(/^Sent coms-net request to [\s\S]*?:\s*/, "").replace(/^coms-net request from [\s\S]*?:\s*/, "");
  const response = stringifyDetail(d.response);
  const error = stringValue(d.error) ?? null;

  if (customType === "coms-net-inbound") {
    return { direction: "inbound", title: "Received coms-net request", peer, prompt, msgId, error };
  }
  if (customType === "coms-net-outbound") {
    return { direction: "outbound", title: "Sent coms-net request", peer, prompt, msgId, status, error };
  }
  if (customType === "coms-net-response-received") {
    return { direction: "response-in", title: error ? "coms-net response failed" : "Received coms-net response", peer, prompt, response, msgId, error };
  }
  if (customType === "coms-net-response-sent") {
    return { direction: "response-out", title: error ? "Failed to answer coms-net request" : "Answered coms-net request", peer, response, msgId, error };
  }
  return null;
}

function parseLegacyComsNetUserMessage(message: UserMessage): ComsNetEvent | null {
  const content = messageContentToText(message.content);
  const match = content.match(/^A coms-net peer named "([^"]+)" asked for help\.\n\nRequest:\n([\s\S]*?)\n\nAnswer the peer directly\./);
  if (!match) return null;
  return {
    direction: "inbound",
    title: "Received coms-net request",
    peer: match[1],
    prompt: match[2].trim(),
  };
}

function ComsNetMessageCard({ event }: { event: ComsNetEvent }) {
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

function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  runningToolIds,
  toolExecutionStatuses,
  modelNames,
  showTimestamp,
  prevTimestamp,
  nextTimestamp,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  runningToolIds?: Set<string>;
  toolExecutionStatuses?: Map<string, ToolExecutionStatus>;
  modelNames?: Record<string, string>;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  nextTimestamp?: number;
}) {
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blocks = useMemo(() => message.content ?? [], [message.content]);
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const estimatedChars = useMemo(() => {
    let chars = 0;
    for (const block of blocks) chars += estimateBlockChars(block);
    return chars;
  }, [blocks]);
  const estimatedCharsRef = useRef(estimatedChars);
  estimatedCharsRef.current = estimatedChars;

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // Thinking duration derived from file timestamps: time from prev message end to this message end
  // This is the total generation time (thinking + any text before first tool call)
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    const secs = Math.round((message.timestamp - prevTimestamp) / 1000);
    return secs > 0 ? secs : undefined;
  }, [message.timestamp, prevTimestamp]);

  // Tool call durations derived from session file timestamps (accurate for completed messages)
  // assistant message timestamp = when generation ended = when tools started running
  // toolResult timestamp = when tool execution finished
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    if (!toolResults || !message.timestamp) return map;
    for (const [callId, result] of toolResults) {
      if (result.timestamp && message.timestamp) {
        const secs = Math.round((result.timestamp - message.timestamp) / 1000);
        if (secs > 0) map.set(callId, secs);
      }
    }
    return map;
  }, [toolResults, message.timestamp]);

  const missingResultDuration = useMemo<number | undefined>(() => {
    if (isStreaming || !message.timestamp || !nextTimestamp) return undefined;
    const secs = Math.round((nextTimestamp - message.timestamp) / 1000);
    return secs > 0 ? secs : undefined;
  }, [isStreaming, message.timestamp, nextTimestamp]);

  const textContent = useMemo(() => blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n"), [blocks]);

  const copyContent = () => {
    copyText(textContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = Date.now();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) next.set(idx, Math.round((now - start) / 1000));
        }
        return next;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const bs = blocksRef.current;
      const now = Date.now();

      // Record start time for each block the first time we see it
      bs.forEach((_, i) => {
        if (!blockStartTimesRef.current.has(i)) blockStartTimesRef.current.set(i, now);
      });

      // When a non-last block has a successor already started, finalise its duration
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < bs.length - 1; i++) {
          if (!next.has(i) && blockStartTimesRef.current.has(i)) {
            const start = blockStartTimesRef.current.get(i)!;
            const nextStart = blockStartTimesRef.current.get(i + 1) ?? now;
            next.set(i, Math.round((nextStart - start) / 1000));
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      const chars = estimatedCharsRef.current;
      if (chars === 0) return;
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed > 0.5) setTps(chars / 4 / elapsed);
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [isStreaming]);

  return (
    <div
      style={{ marginBottom: 16 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Model label */}
      <div
        style={{
          fontSize: 11,
          color: "var(--text-dim)",
          marginBottom: 4,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {message.provider && (
          <span>{modelNames?.[`${message.provider}:${message.model}`] ?? modelNames?.[message.model] ?? message.model}</span>
        )}
        {isStreaming && (() => {
          const est = Math.round(estimatedChars / 4);
          return (
            <>

              {est > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text)" }} title="预估 token 数（流式接收中）">
                  <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11, fontWeight: 400 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                    </svg>
                    {est}
                  </span>
                  {tps !== null && (() => {
                    const bg = tps >= 50 ? "#53b3cb" : tps >= 30 ? "#9bc53d" : tps >= 15 ? "#f9c22e" : "#e01a4f";
                    return (
                      <span style={{ marginLeft: 6, padding: "1px 6px", borderRadius: 4, background: bg, color: "#fff", fontSize: 11, fontWeight: 400 }}>
                        {tps.toFixed(1)} t/s
                      </span>
                    );
                  })()}
                </span>
              )}
            </>
          );
        })()}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blocks.map((block, i) => (
          <BlockView key={i} block={block} toolResults={toolResults} runningToolIds={runningToolIds} toolExecutionStatuses={toolExecutionStatuses} isStreaming={isStreaming} streamingDuration={streamingDurations.get(i) ?? (block.type === "thinking" ? thinkingDurationFromFile : undefined)} toolCallDurations={toolCallDurations} missingResultDuration={missingResultDuration} />
        ))}
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginTop: 4,
      }}>
        {message.usage && !isStreaming && (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {formatUsage(message.usage)}
          </div>
        )}
        {textContent && !isStreaming && (
          <button
            onClick={copyContent}
            title="Copy message"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 8px", height: 22,
              background: "none", border: "none",
              borderRadius: 5,
              color: copied ? "var(--accent)" : "var(--text-dim)",
              cursor: "pointer",
              fontSize: 11, fontWeight: 400,
              whiteSpace: "nowrap",
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? "auto" : "none",
              transition: "opacity 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!copied) e.currentTarget.style.color = "var(--accent)"; }}
            onMouseLeave={(e) => { if (!copied) e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            {copied ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        {time && !isStreaming && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: "auto" }}>{time}</span>
        )}
      </div>
    </div>
  );
}

function BlockView({ block, toolResults, runningToolIds, toolExecutionStatuses, isStreaming, streamingDuration, toolCallDurations, missingResultDuration }: { block: AssistantContentBlock; toolResults?: Map<string, ToolResultMessage>; runningToolIds?: Set<string>; toolExecutionStatuses?: Map<string, ToolExecutionStatus>; isStreaming?: boolean; streamingDuration?: number; toolCallDurations?: Map<string, number>; missingResultDuration?: number }) {
  if (block.type === "text") {
    return <TextBlock block={block as TextContent} />;
  }
  if (block.type === "thinking") {
    return <ThinkingBlock block={block as ThinkingContent} duration={streamingDuration} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    const isRunning = Boolean((tc.toolCallId && runningToolIds?.has(tc.toolCallId)) || (isStreaming && !result));
    const liveStatus = tc.toolCallId ? toolExecutionStatuses?.get(tc.toolCallId) : undefined;
    const duration = toolCallDurations?.get(tc.toolCallId);
    const comsNetToolEvent = parseComsNetToolCall(tc, result);
    if (comsNetToolEvent) {
      return <ComsNetMessageCard event={comsNetToolEvent} />;
    }
    return <ToolCallBlock block={tc} result={result} isRunning={isRunning} liveStatus={liveStatus} duration={duration} missingDuration={missingResultDuration} />;
  }
  return null;
}

function parseToolResultJson(result?: ToolResultMessage): Record<string, unknown> {
  const resultWithDetails = result as (ToolResultMessage & { details?: unknown }) | undefined;
  const fromDetails = isRecord(resultWithDetails?.details) ? resultWithDetails.details : null;
  if (fromDetails) return fromDetails;
  const text = result?.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseComsNetToolCall(block: ToolCallContent, result?: ToolResultMessage): ComsNetEvent | null {
  const input = isRecord(block.input) ? block.input : {};
  const resultDetails = parseToolResultJson(result);
  const resultText = result?.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  if (block.toolName === "coms_net_send") {
    const target = stringValue(input.target) ?? stringValue(input.target_session) ?? "peer";
    const prompt = stringValue(input.prompt) ?? "";
    return {
      direction: "outbound",
      title: "Sent coms-net request",
      peer: target,
      prompt,
      msgId: stringValue(resultDetails.msg_id),
      status: stringValue(resultDetails.status),
      error: result?.isError ? (resultText || "send_failed") : null,
    };
  }

  if (block.toolName === "coms_net_await") {
    return {
      direction: "response-in",
      title: result?.isError ? "coms-net response failed" : "Received coms-net response",
      peer: "peer",
      response: resultText,
      msgId: stringValue(input.msg_id),
      error: result?.isError ? (resultText || "response_failed") : null,
    };
  }

  return null;
}

function TextBlock({ block }: { block: TextContent }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, markdownMathOptions]]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const lang = className?.replace("language-", "") ?? "";
            const raw = String(children);
            const isBlock = className?.includes("language-") || raw.includes("\n");
            if (isBlock) {
              return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
            }
            return (
              <code
                style={{
                  background: "var(--bg-selected)",
                  padding: "1px 4px",
                  borderRadius: 3,
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.9em",
                }}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children }) {
            // Unwrap <pre> wrapper — CodeBlock handles its own container
            return <>{children}</>;
          },
        }}
      >
        {normalizeMarkdownMath(block.text)}
      </ReactMarkdown>
    </div>
  );
}

function ThinkingBlock({ block, duration }: { block: ThinkingContent; duration?: number }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        overflow: "hidden",
        fontSize: 13,
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "6px 10px",
          background: "var(--bg-panel)",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
      >
        <span>{t("message.thinking")}</span>
        {duration !== undefined && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{duration}s</span>
        )}
      </button>
      {expanded && (
        <div
          style={{
            padding: "8px 10px",
            color: "var(--text-muted)",
            fontSize: 12,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            background: "var(--bg-panel)",
            borderTop: "1px solid var(--border)",
          }}
        >
          {block.thinking}
        </div>
      )}
    </div>
  );
}

function formatDurationBrief(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest > 0 ? `${hours}h ${minuteRest}m` : `${hours}h`;
}

function toolTimeoutSeconds(input: Record<string, unknown>): number | null {
  const value = input.timeout ?? input.timeoutSeconds ?? input.timeout_ms ?? input.timeoutMs;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 10_000 ? Math.round(value / 1000) : Math.round(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed > 10_000 ? Math.round(parsed / 1000) : Math.round(parsed);
  }
  return null;
}

function ToolCallBlock({ block, result, isRunning, liveStatus, duration, missingDuration }: { block: ToolCallContent; result?: ToolResultMessage; isRunning?: boolean; liveStatus?: ToolExecutionStatus; duration?: number; missingDuration?: number }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [nowMs, setNowMs] = useState(0);
  const inputStr = JSON.stringify(block.input, null, 2);
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
  const resultText = result
    ? result.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n")
    : null;
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


function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}

function formatUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}): string {
  const parts = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}



function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const { isDark } = useTheme();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    copyText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      style={{
        position: "relative",
        marginTop: 4,
        marginBottom: 4,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid var(--border)",
      }}
    >
      <div
        style={{
          padding: "3px 10px",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{lang}</span>
        <button
          onClick={copy}
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <SyntaxHighlighter
        language={lang || "text"}
        style={isDark ? vscDarkPlus : vs}
        showLineNumbers
        lineNumberStyle={{ color: "var(--text-dim)", fontStyle: "normal" }}
        customStyle={{
          margin: 0,
          padding: "10px 12px",
          fontSize: 12.5,
          lineHeight: 1.6,
          borderRadius: 0,
          background: "var(--bg)",
        }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}
