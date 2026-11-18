"use client";

import { memo, useRef, type RefObject } from "react";
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
  // The timeline keeps its own memory across renders: how many rows it had, and
  // which positions have already animated. A row is "new" only when it extends
  // the list past its previous length, so reloads, branch switches, and remounts
  // caused by upstream key churn never replay the entrance.
  const previousCountRef = useRef<number | null>(null);
  const isFirstRender = previousCountRef.current === null;
  const previousCount = previousCountRef.current ?? messages.length;
  const animatedTokensRef = useRef<Set<string>>(new Set());
  const animatedTokens = animatedTokensRef.current;
  previousCountRef.current = messages.length;
  let visibleRefIndex = 0;
  return messages.map((message, index) => {
    if (projection.hiddenMessageIndexes.has(index)) return null;
    const entryId = entryIds[index];
    // Rows are keyed by position, not by entry id. A live message has no entry id
    // at first and gains one when the session reloads; keying by id would remount
    // the row at that moment, which reset the lazy slot and visibly re-rendered
    // the whole message. The message list is append-only, so position is stable.
    const messageKey = `${message.role}-${index}`;
    const previousAssistantEntryId = message.role === "user" && index > 0 && messages[index - 1].role === "assistant"
      ? entryIds[index - 1]
      : undefined;
    const isVisible = message.role === "user" || message.role === "assistant";
    const currentRefIndex = isVisible ? visibleRefIndex++ : -1;
    const isForking = forkingEntryId === entryId;
    // Only rows appended beyond the previous length are arrivals; a message that
    // replaces content at an existing position (branch navigation) is not.
    const isNewMessage = !isFirstRender && index >= previousCount;
    const animationToken = `${message.role}:${index}`;
    const shouldAnimate = isNewMessage && !animatedTokens.has(animationToken);
    if (shouldAnimate) animatedTokens.add(animationToken);
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
        animateText={shouldAnimate}
        animationToken={animationToken}
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
