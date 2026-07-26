"use client";

import { memo, useMemo, useState } from "react";
import type {
  AssistantMessage,
  TextContent,
  ToolCallContent,
  ToolExecutionStatus,
  ToolResultMessage,
} from "@/lib/types";
import { estimateBlockChars, formatTime, formatUsage } from "./helpers";
import { MessageBlock } from "./MessageBlocks";
import { StreamingMetrics } from "./StreamingMetrics";
import { useCopyFeedback } from "./useCopyFeedback";
import { useStreamingDurations } from "./useStreamingDurations";

interface AssistantMessageViewProps {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  runningToolIds?: Set<string>;
  toolExecutionStatuses?: Map<string, ToolExecutionStatus>;
  modelNames?: Record<string, string>;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  nextTimestamp?: number;
}

function AssistantMessageViewImpl({
  message,
  isStreaming,
  toolResults,
  runningToolIds,
  toolExecutionStatuses,
  modelNames,
  showTimestamp,
  prevTimestamp,
  nextTimestamp,
}: AssistantMessageViewProps) {
  const blocks = useMemo(() => message.content ?? [], [message.content]);
  const [hovered, setHovered] = useState(false);
  const estimatedChars = useMemo(
    () => blocks.reduce((total, block) => total + estimateBlockChars(block), 0),
    [blocks],
  );
  const streamingDurations = useStreamingDurations(blocks, isStreaming);
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (!message.timestamp || !prevTimestamp) return undefined;
    const seconds = Math.round((message.timestamp - prevTimestamp) / 1000);
    return seconds > 0 ? seconds : undefined;
  }, [message.timestamp, prevTimestamp]);
  const missingResultDuration = useMemo<number | undefined>(() => {
    if (isStreaming || !message.timestamp || !nextTimestamp) return undefined;
    const seconds = Math.round((nextTimestamp - message.timestamp) / 1000);
    return seconds > 0 ? seconds : undefined;
  }, [isStreaming, message.timestamp, nextTimestamp]);
  const toolCallDurations = useMemo(() => {
    const durations = new Map<string, number>();
    if (!message.timestamp) return durations;
    for (const block of blocks) {
      if (block.type !== "toolCall") continue;
      const result = toolResults?.get(block.toolCallId);
      if (!result?.timestamp) continue;
      const seconds = Math.round((result.timestamp - message.timestamp) / 1000);
      if (seconds > 0) durations.set(block.toolCallId, seconds);
    }
    return durations;
  }, [blocks, message.timestamp, toolResults]);
  const textContent = useMemo(() => blocks
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n"), [blocks]);
  const { copied, copy: copyContent } = useCopyFeedback(textContent);
  const time = showTimestamp ? formatTime(message.timestamp) : null;

  return (
    <div
      className={`pi-message pi-message-assistant${isStreaming ? " pi-message-streaming" : ""}`}
      style={{ marginBottom: 16 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
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
        <StreamingMetrics estimatedChars={estimatedChars} isStreaming={isStreaming} />
      </div>

      <div className="pi-message-blocks" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blocks.map((block, index) => {
          if (block.type !== "toolCall") {
            return (
              <MessageBlock
                key={index}
                block={block}
                streamingDuration={block.type === "thinking"
                  ? streamingDurations.get(index) ?? thinkingDurationFromFile
                  : undefined}
              />
            );
          }
          const toolCall = block as ToolCallContent;
          const result = toolResults?.get(toolCall.toolCallId);
          const isRunning = Boolean(
            runningToolIds?.has(toolCall.toolCallId) || (isStreaming && !result),
          );
          return (
            <MessageBlock
              key={index}
              block={block}
              result={result}
              isRunning={isRunning}
              liveStatus={toolExecutionStatuses?.get(toolCall.toolCallId)}
              toolDuration={toolCallDurations.get(toolCall.toolCallId)}
              missingResultDuration={missingResultDuration}
            />
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        {message.usage && !isStreaming && (
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{formatUsage(message.usage)}</div>
        )}
        {textContent && !isStreaming && (
          <button
            onClick={copyContent}
            title="Copy message"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              height: 22,
              background: "none",
              border: "none",
              borderRadius: 5,
              color: copied ? "var(--accent)" : "var(--text-dim)",
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 400,
              whiteSpace: "nowrap",
              opacity: hovered ? 1 : 0,
              pointerEvents: hovered ? "auto" : "none",
              transition: "opacity 0.12s, color 0.12s",
            }}
            onMouseEnter={(event) => { if (!copied) event.currentTarget.style.color = "var(--accent)"; }}
            onMouseLeave={(event) => { if (!copied) event.currentTarget.style.color = "var(--text-dim)"; }}
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

export const AssistantMessageView = memo(AssistantMessageViewImpl);
