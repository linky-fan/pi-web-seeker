"use client";

import { memo, type RefObject } from "react";
import type { AgentMessage, ToolExecutionStatus } from "@/lib/types";
import { MessageView } from "../MessageView";
import { LazyMessageSlot } from "./LazyMessageSlot";
import { areHistoricalTimelinePropsEqual } from "./memoComparators";
import { estimateMessageHeight, shouldRenderMessageEagerly, type MessageProjection } from "./messageProjection";

export interface HistoricalMessageTimelineProps {
  messages: AgentMessage[];
  entryIds: string[];
  projection: MessageProjection;
  scrollRoot: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  lastUserMsgRef: RefObject<HTMLDivElement | null>;
  runningToolIds: Set<string>;
  toolExecutionStatuses: Map<string, ToolExecutionStatus>;
  modelNames: Record<string, string>;
  agentRunning: boolean;
  isNew: boolean;
  forkingEntryId: string | null;
  onFork: (entryId: string) => void;
  onNavigate: (entryId: string) => void;
  onEditContent: (content: string) => void;
}

function timestampOf(message: AgentMessage | undefined): number | undefined {
  return (message as (AgentMessage & { timestamp?: number }) | undefined)?.timestamp;
}

function HistoricalMessageTimelineImpl({
  messages,
  entryIds,
  projection,
  scrollRoot,
  messageRefs,
  lastUserMsgRef,
  runningToolIds,
  toolExecutionStatuses,
  modelNames,
  agentRunning,
  isNew,
  forkingEntryId,
  onFork,
  onNavigate,
  onEditContent,
}: HistoricalMessageTimelineProps) {
  let visibleRefIndex = 0;
  return messages.map((message, index) => {
    if (projection.hiddenMessageIndexes.has(index)) return null;
    const entryId = entryIds[index];
    const messageKey = entryId ?? `${message.role}-${index}`;
    const previousAssistantEntryId = message.role === "user" && index > 0 && messages[index - 1].role === "assistant"
      ? entryIds[index - 1]
      : undefined;
    const isVisible = message.role === "user" || message.role === "assistant";
    const currentRefIndex = isVisible ? visibleRefIndex++ : -1;
    const isForking = forkingEntryId === entryId;
    const view = (
      <MessageView
        key={messageKey}
        message={message}
        toolResults={projection.toolResultsMap}
        runningToolIds={runningToolIds}
        toolExecutionStatuses={toolExecutionStatuses}
        modelNames={modelNames}
        comsNetResponse={projection.comsNetResponses.get(index)}
        entryId={entryId}
        onFork={agentRunning || isNew || (index === 0 && message.role === "user") ? undefined : onFork}
        forking={isForking}
        onNavigate={agentRunning ? undefined : onNavigate}
        prevAssistantEntryId={agentRunning ? undefined : previousAssistantEntryId}
        onEditContent={onEditContent}
        showTimestamp={projection.showTimestamp[index]}
        prevTimestamp={timestampOf(messages[index - 1])}
        nextTimestamp={timestampOf(messages[index + 1])}
      />
    );
    if (message.role === "toolResult") return view;

    const registerRef = isVisible
      ? (element: HTMLDivElement | null) => {
          messageRefs.current[currentRefIndex] = element;
          if (index === projection.lastUserIdx) lastUserMsgRef.current = element;
        }
      : undefined;
    return (
      <LazyMessageSlot
        key={messageKey}
        eager={shouldRenderMessageEagerly(index, messages.length, projection.lastUserIdx, isForking)}
        estimatedHeight={estimateMessageHeight(message)}
        registerRef={registerRef}
        scrollRoot={scrollRoot}
      >
        {view}
      </LazyMessageSlot>
    );
  });
}

export const HistoricalMessageTimeline = memo(HistoricalMessageTimelineImpl, areHistoricalTimelinePropsEqual);
