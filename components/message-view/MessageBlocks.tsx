"use client";

import { memo } from "react";
import type {
  AssistantContentBlock,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  ToolExecutionStatus,
  ToolResultMessage,
} from "@/lib/types";
import { ComsNetMessageCard } from "./ComsNetMessageCard";
import { parseComsNetToolCall } from "./helpers";
import { MarkdownContent } from "./MarkdownContent";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolCallBlock } from "./ToolCallBlock";

interface MessageBlockProps {
  block: AssistantContentBlock;
  result?: ToolResultMessage;
  isRunning?: boolean;
  liveStatus?: ToolExecutionStatus;
  streamingDuration?: number;
  toolDuration?: number;
  missingResultDuration?: number;
}

function MessageBlockImpl({
  block,
  result,
  isRunning,
  liveStatus,
  streamingDuration,
  toolDuration,
  missingResultDuration,
}: MessageBlockProps) {
  if (block.type === "text") return <MarkdownContent block={block as TextContent} />;
  if (block.type === "thinking") {
    return <ThinkingBlock block={block as ThinkingContent} duration={streamingDuration} />;
  }
  if (block.type === "toolCall") {
    const toolCall = block as ToolCallContent;
    const comsNetEvent = parseComsNetToolCall(toolCall, result);
    if (comsNetEvent) return <ComsNetMessageCard event={comsNetEvent} />;
    return (
      <ToolCallBlock
        block={toolCall}
        result={result}
        isRunning={isRunning}
        liveStatus={liveStatus}
        duration={toolDuration}
        missingDuration={missingResultDuration}
      />
    );
  }
  return null;
}

function blockContentEqual(previous: AssistantContentBlock, next: AssistantContentBlock): boolean {
  if (previous === next) return true;
  if (previous.type !== next.type) return false;
  if (previous.type === "text" && next.type === "text") return previous.text === next.text;
  if (previous.type === "thinking" && next.type === "thinking") return previous.thinking === next.thinking;
  if (previous.type === "toolCall" && next.type === "toolCall") {
    return previous.toolCallId === next.toolCallId
      && previous.toolName === next.toolName
      && previous.input === next.input;
  }
  return false;
}

export const MessageBlock = memo(MessageBlockImpl, (previous, next) =>
  blockContentEqual(previous.block, next.block)
    && previous.result === next.result
    && previous.isRunning === next.isRunning
    && previous.liveStatus === next.liveStatus
    && previous.streamingDuration === next.streamingDuration
    && previous.toolDuration === next.toolDuration
    && previous.missingResultDuration === next.missingResultDuration,
);
