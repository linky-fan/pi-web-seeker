"use client";

import { memo } from "react";
import type { AssistantMessage, CustomMessage, UserMessage } from "@/lib/types";
import { AssistantMessageView } from "./message-view/AssistantMessageView";
import { ComsNetMessageCard } from "./message-view/ComsNetMessageCard";
import { CustomMessageView } from "./message-view/CustomMessageView";
import {
  areMessageViewPropsEqual,
  assistantMessageText,
  parseLegacyComsNetUserMessage,
} from "./message-view/helpers";
import type { MessageViewProps } from "./message-view/types";
import { UserMessageView } from "./message-view/UserMessageView";

export type { ComsNetResponseHint } from "./message-view/types";

function MessageViewImpl({
  message,
  isStreaming,
  toolResults,
  runningToolIds,
  toolExecutionStatuses,
  modelNames,
  comsNetResponse,
  entryId,
  onFork,
  forking,
  onNavigate,
  prevAssistantEntryId,
  onEditContent,
  showTimestamp,
  prevTimestamp,
  nextTimestamp,
}: MessageViewProps) {
  if (message.role === "user") {
    const legacyComsNetEvent = parseLegacyComsNetUserMessage(message as UserMessage);
    if (legacyComsNetEvent) {
      return (
        <div style={{ marginBottom: 16 }}>
          <ComsNetMessageCard event={legacyComsNetEvent} />
        </div>
      );
    }
    return (
      <UserMessageView
        message={message as UserMessage}
        entryId={entryId}
        onFork={onFork}
        forking={forking}
        onNavigate={onNavigate}
        prevAssistantEntryId={prevAssistantEntryId}
        onEditContent={onEditContent}
      />
    );
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
    return (
      <AssistantMessageView
        message={message as AssistantMessage}
        isStreaming={isStreaming}
        toolResults={toolResults}
        runningToolIds={runningToolIds}
        toolExecutionStatuses={toolExecutionStatuses}
        modelNames={modelNames}
        showTimestamp={showTimestamp}
        prevTimestamp={prevTimestamp}
        nextTimestamp={nextTimestamp}
      />
    );
  }

  if (message.role === "custom") {
    return <CustomMessageView message={message as CustomMessage} showTimestamp={showTimestamp} />;
  }
  return null;
}

export const MessageView = memo(MessageViewImpl, areMessageViewPropsEqual);
