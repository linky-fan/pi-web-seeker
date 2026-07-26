"use client";

import { memo, type RefObject } from "react";
import type { AgentMessage, ToolExecutionStatus } from "@/lib/types";
import type { AgentPhase } from "@/hooks/useAgentSession";
import { ChatMinimap, useMessageRefs } from "../ChatMinimap";
import { MessageView } from "../MessageView";
import { HistoricalMessageTimeline } from "./MessageTimeline";
import { phaseLabel, type MessageProjection } from "./messageProjection";

interface Props {
  isFluid: boolean;
  messages: AgentMessage[];
  entryIds: string[];
  projection: MessageProjection;
  streamingMessage: Partial<AgentMessage> | null;
  isStreaming: boolean;
  agentRunning: boolean;
  agentPhase: AgentPhase;
  runningToolIds: Set<string>;
  toolExecutionStatuses: Map<string, ToolExecutionStatus>;
  modelNames: Record<string, string>;
  isNew: boolean;
  forkingEntryId: string | null;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  lastUserMsgRef: RefObject<HTMLDivElement | null>;
  onFork: (entryId: string) => void;
  onNavigate: (entryId: string) => void;
  onEditContent: (content: string) => void;
}

const LiveAgentOutput = memo(function LiveAgentOutput({
  streamingMessage,
  isStreaming,
  agentRunning,
  agentPhase,
  runningToolIds,
  toolExecutionStatuses,
  modelNames,
}: Pick<Props, "streamingMessage" | "isStreaming" | "agentRunning" | "agentPhase" | "runningToolIds" | "toolExecutionStatuses" | "modelNames">) {
  return (
    <>
      {isStreaming && streamingMessage && (
        <MessageView
          message={streamingMessage as AgentMessage}
          isStreaming
          runningToolIds={runningToolIds}
          toolExecutionStatuses={toolExecutionStatuses}
          modelNames={modelNames}
        />
      )}
      {agentRunning && !streamingMessage && (
        <div className="pi-running-phase py-2 text-[13px] text-text-muted">
          <span className="animate-[pulse_1.5s_infinite]">{phaseLabel(agentPhase)}</span>
        </div>
      )}
    </>
  );
});

export const ConversationRegion = memo(function ConversationRegion(props: Props) {
  const messageRefs = useMessageRefs(props.projection.visibleMessageCount);
  return (
    <div className={`${props.isFluid ? "pi-fluid-chat-body" : "pi-chat-body"} relative flex flex-1 overflow-hidden`}>
      <div ref={props.scrollContainerRef} className="pi-chat-scroll flex-1 overflow-y-auto pt-4 [scrollbar-width:none]">
        <div className="pi-message-stack mx-auto max-w-[820px] px-4">
          <HistoricalMessageTimeline
            messages={props.messages}
            entryIds={props.entryIds}
            projection={props.projection}
            scrollRoot={props.scrollContainerRef}
            messageRefs={messageRefs}
            lastUserMsgRef={props.lastUserMsgRef}
            runningToolIds={props.runningToolIds}
            toolExecutionStatuses={props.toolExecutionStatuses}
            modelNames={props.modelNames}
            agentRunning={props.agentRunning}
            isNew={props.isNew}
            forkingEntryId={props.forkingEntryId}
            onFork={props.onFork}
            onNavigate={props.onNavigate}
            onEditContent={props.onEditContent}
          />
          <LiveAgentOutput
            streamingMessage={props.streamingMessage}
            isStreaming={props.isStreaming}
            agentRunning={props.agentRunning}
            agentPhase={props.agentPhase}
            runningToolIds={props.runningToolIds}
            toolExecutionStatuses={props.toolExecutionStatuses}
            modelNames={props.modelNames}
          />
          <div ref={props.messagesEndRef} />
          {props.agentRunning && (
            <div style={{ height: props.scrollContainerRef.current ? props.scrollContainerRef.current.clientHeight : "80vh" }} />
          )}
        </div>
      </div>
      {!props.isFluid && (
        <ChatMinimap
          messages={props.messages}
          streamingMessage={props.streamingMessage}
          scrollContainer={props.scrollContainerRef}
          messageRefs={messageRefs}
        />
      )}
    </div>
  );
});
