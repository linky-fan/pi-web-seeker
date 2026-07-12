"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { AgentMessage, AssistantMessage, CustomMessage, ExtensionUiRequest, SessionInfo, SessionTreeNode, TextContent, ToolCallContent } from "@/lib/types";
import { MessageView, type ComsNetResponseHint } from "./MessageView";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { AgentsMdStatus } from "./AgentsMdStatus";
import { useAgentSession, type AgentPhase, type NoticeItem } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import { BrandTypewriterHeader } from "./BrandTypewriter";
import { useUiMode } from "@/hooks/useUiMode";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsChange?: (stats: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number } | null) => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onTaskStatusChange?: (status: "done" | "running" | "error", message?: string | null) => void;
}

const LAZY_RECENT_MESSAGE_COUNT = 24;
const LAZY_MESSAGE_THRESHOLD = 60;
const LAZY_ROOT_MARGIN_PX = 1600;

function phaseLabel(phase: AgentPhase): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return "Running tool...";
    if (names.length === 1) return `Running ${names[0]}...`;
    if (names.length <= 3) return `Running ${names.join(", ")}...`;
    return `Running ${names.slice(0, 2).join(", ")} (+${names.length - 2})...`;
  }
  if (phase?.kind === "waiting_model") return "Waiting for model...";
  return "Thinking...";
}

function userMessageText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") return message.content.trim() || null;
  const text = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text || null;
}

interface ComsNetInboundHint {
  peer: string;
  prompt: string;
  msgId?: string;
}

interface ComsNetResponseSentHint {
  peer: string;
  response?: string;
  msgId: string;
  index: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeComsNetText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function comsNetInboundKey(hint: ComsNetInboundHint): string {
  return `${hint.peer}\n${normalizeComsNetText(hint.prompt)}`;
}

function extractComsNetInbound(message: AgentMessage): ComsNetInboundHint | null {
  if (message.role === "custom") {
    const custom = message as CustomMessage;
    if (custom.customType !== "coms-net-inbound") return null;
    const details = isRecord(custom.details) ? custom.details : {};
    const sender = isRecord(details.sender) ? details.sender : {};
    const content = typeof custom.content === "string"
      ? custom.content
      : custom.content.filter((part): part is TextContent => part.type === "text").map((part) => part.text).join("\n");
    const prompt = stringValue(details.prompt)
      ?? content.replace(/^coms-net request from [\s\S]*?:\s*/, "").trim();
    return {
      peer: stringValue(sender.name) ?? "peer",
      prompt,
      msgId: stringValue(details.msg_id),
    };
  }

  if (message.role !== "user") return null;
  const content = userMessageText(message);
  if (!content) return null;
  const match = content.match(/^A coms-net peer named "([^"]+)" asked for help\.\n\nRequest:\n([\s\S]*?)\n\nAnswer the peer directly\./);
  if (!match) return null;
  return {
    peer: match[1],
    prompt: match[2].trim(),
  };
}

function extractComsNetResponseSent(message: AgentMessage, index: number): ComsNetResponseSentHint | null {
  if (message.role !== "custom") return null;
  const custom = message as CustomMessage;
  if (custom.customType !== "coms-net-response-sent") return null;
  const details = isRecord(custom.details) ? custom.details : {};
  const msgId = stringValue(details.msg_id);
  if (!msgId) return null;
  const target = isRecord(details.target) ? details.target : {};
  return {
    peer: stringValue(target.name) ?? stringValue(details.target) ?? "peer",
    response: stringValue(details.response),
    msgId,
    index,
  };
}

function comsNetCustomMsgId(message: AgentMessage, customType: string): string | undefined {
  if (message.role !== "custom") return undefined;
  const custom = message as CustomMessage;
  if (custom.customType !== customType) return undefined;
  const details = isRecord(custom.details) ? custom.details : {};
  return stringValue(details.msg_id);
}

function comsNetAnyCustomMsgId(message: AgentMessage): string | undefined {
  if (message.role !== "custom") return undefined;
  const custom = message as CustomMessage;
  if (!custom.customType.startsWith("coms-net-")) return undefined;
  const details = isRecord(custom.details) ? custom.details : {};
  return stringValue(details.msg_id);
}

function isComsNetResponseSent(message: AgentMessage): boolean {
  return message.role === "custom" && (message as CustomMessage).customType === "coms-net-response-sent";
}

function assistantResponseText(message: AgentMessage): string {
  if (message.role !== "assistant") return "";
  return (message as AssistantMessage).content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function assistantOnlyCallsComsNetTool(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  const blocks = (message as AssistantMessage).content;
  return blocks.some((part): part is ToolCallContent => part.type === "toolCall" && part.toolName.startsWith("coms_net_"));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateTextHeight(text: string, base = 52): number {
  const explicitLines = text.split("\n").length;
  const wrappedLines = Math.ceil(text.length / 90);
  return base + Math.max(explicitLines, wrappedLines) * 20;
}

function estimateMessageHeight(message: AgentMessage): number {
  if (message.role === "user") {
    const content = message.content;
    if (typeof content === "string") return clampNumber(estimateTextHeight(content, 44), 54, 360);
    const text = content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const imageCount = content.filter((block) => block.type === "image").length;
    return clampNumber(estimateTextHeight(text, 44) + imageCount * 132, 76, 520);
  }

  if (message.role === "assistant") {
    const blocks = message.content ?? [];
    let textLength = 0;
    let textLines = 0;
    let extraBlocks = 0;
    for (const block of blocks) {
      if (block.type === "text") {
        const text = block.text ?? "";
        textLength += text.length;
        textLines += text.split("\n").length;
      } else {
        extraBlocks += 1;
      }
    }
    const lines = Math.max(textLines, Math.ceil(textLength / 90));
    return clampNumber(54 + lines * 22 + extraBlocks * 76, 70, 640);
  }

  if (message.role === "custom") {
    const content = typeof message.content === "string" ? message.content : "";
    return clampNumber(estimateTextHeight(content, 54), 70, 420);
  }

  return 1;
}

function LazyMessageSlot({
  children,
  eager,
  estimatedHeight,
  registerRef,
  scrollRoot,
}: {
  children: ReactNode;
  eager: boolean;
  estimatedHeight: number;
  registerRef?: (el: HTMLDivElement | null) => void;
  scrollRoot: RefObject<HTMLDivElement | null>;
}) {
  const [shouldRender, setShouldRender] = useState(eager);
  const slotRef = useRef<HTMLDivElement | null>(null);

  const setSlotRef = useCallback((el: HTMLDivElement | null) => {
    slotRef.current = el;
    registerRef?.(el);
  }, [registerRef]);

  useEffect(() => {
    if (eager) {
      setShouldRender(true);
      return;
    }
    if (shouldRender) return;

    const el = slotRef.current;
    const root = scrollRoot.current;
    if (!el || !root || typeof IntersectionObserver === "undefined") {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
        setShouldRender(true);
        observer.disconnect();
      }
    }, {
      root,
      rootMargin: `${LAZY_ROOT_MARGIN_PX}px 0px`,
      threshold: 0,
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [eager, scrollRoot, shouldRender]);

  const style = shouldRender
    ? ({
        contentVisibility: "auto",
        containIntrinsicSize: `${estimatedHeight}px`,
      } as CSSProperties)
    : ({
        minHeight: estimatedHeight,
        contentVisibility: "auto",
        containIntrinsicSize: `${estimatedHeight}px`,
        contain: "layout style paint",
      } as CSSProperties);

  return (
    <div ref={setSlotRef} style={style}>
      {shouldRender ? children : null}
    </div>
  );
}

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsChange, onContextUsageChange, onTaskStatusChange }: Props) {
  const { isFluid } = useUiMode();
  const {
    loading, error, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, displayModel: displayModelValue, sessionStats,
    taskError,
    agentPhase,
    toolExecutionStatuses,
    planMode,
    planExecutionMode,
    planModeStatus,
    buddyMode,
    buddyReviewerModel,
    notices,
    extensionDialog,
    extensionCustomUi,
    extensionStatuses,
    extensionWidgets,
    isNew,
    messagesEndRef, scrollContainerRef,
    lastUserMsgRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handleAbortCompaction,
    handleThinkingLevelChange, handlePlanModeChange, handleBuddyModeChange, handleBuddyReviewerChange, handleAgentEventRef,
    respondToExtensionUi, sendExtensionCustomInput,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange,
  });

  const { soundEnabled, onSoundToggle, playDoneSound } = useAudio();
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  // Wrap agent event handler to play sound on agent_end
  const origHandler = handleAgentEventRef.current;
  useEffect(() => {
    handleAgentEventRef.current = (event) => {
      if (event.type === "agent_end" && soundEnabledRef.current) {
        playDoneSoundRef.current();
      }
      origHandler?.(event);
    };
  }, [origHandler, handleAgentEventRef]);

  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? `${sessionStats.tokens.input}|${sessionStats.tokens.output}|${sessionStats.tokens.cacheRead}|${sessionStats.tokens.cacheWrite}|${sessionStats.cost ?? 0}`
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const taskStatusMessage = error ?? taskError ?? compactError ?? null;
  const taskStatus = taskStatusMessage ? "error" : agentRunning ? "running" : "done";
  useEffect(() => {
    onTaskStatusChange?.(taskStatus, taskStatusMessage);
  }, [onTaskStatusChange, taskStatus, taskStatusMessage]);
  useEffect(() => () => { onTaskStatusChange?.("done", null); }, [onTaskStatusChange]);

  const onDrop = useCallback((files: File[]) => {
    chatInputRef?.current?.addImages(files);
  }, [chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const promptHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = userMessageText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history;
  }, [messages]);

  const runningToolIds = useMemo(() => {
    if (agentPhase?.kind !== "running_tools") return new Set<string>();
    return new Set(agentPhase.tools.map((tool) => tool.id));
  }, [agentPhase]);

  const messageRenderData = useMemo(() => {
    const toolResultsMap = new Map<string, import("@/lib/types").ToolResultMessage>();
    const showTimestamp = new Array<boolean>(messages.length).fill(false);
    const hiddenMessageIndexes = new Set<number>();
    const comsNetResponses = new Map<number, ComsNetResponseHint>();
    const customInboundKeys = new Set<string>();
    const inboundIndexByMsgId = new Map<string, number>();
    const responseSentByMsgId = new Map<string, ComsNetResponseSentHint>();
    const responseReceivedMsgIds = new Set<string>();
    let lastUserIdx = -1;
    let seenAssistantSinceUser = false;
    let pendingInbound: (ComsNetInboundHint & { index: number; key: string }) | null = null;
    let inferredResponseIdx: number | null = null;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "custom") {
        const inbound = extractComsNetInbound(msg);
        if (inbound) {
          customInboundKeys.add(comsNetInboundKey(inbound));
          if (inbound.msgId) inboundIndexByMsgId.set(inbound.msgId, i);
        }
        const responseSent = extractComsNetResponseSent(msg, i);
        if (responseSent) responseSentByMsgId.set(responseSent.msgId, responseSent);
        const responseReceivedMsgId = comsNetCustomMsgId(msg, "coms-net-response-received");
        if (responseReceivedMsgId) responseReceivedMsgIds.add(responseReceivedMsgId);
      }
    }
    const loopbackMsgIds = new Set([...responseSentByMsgId.keys()].filter((msgId) => responseReceivedMsgIds.has(msgId)));

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const anyComsNetMsgId = comsNetAnyCustomMsgId(msg);
      if (anyComsNetMsgId && loopbackMsgIds.has(anyComsNetMsgId)) {
        hiddenMessageIndexes.add(i);
      }
      if (msg.role === "user") {
        const inbound = extractComsNetInbound(msg);
        if (inbound && customInboundKeys.has(comsNetInboundKey(inbound))) {
          hiddenMessageIndexes.add(i);
        }
      }
      const responseReceivedMsgId = comsNetCustomMsgId(msg, "coms-net-response-received");
      if (responseReceivedMsgId && responseSentByMsgId.has(responseReceivedMsgId)) {
        hiddenMessageIndexes.add(i);
      }
    }

    for (const [msgId, responseSent] of responseSentByMsgId) {
      const inboundIndex = inboundIndexByMsgId.get(msgId);
      if (inboundIndex === undefined) continue;
      for (let i = inboundIndex + 1; i < responseSent.index; i++) {
        if (messages[i].role === "assistant" && assistantResponseText(messages[i])) {
          hiddenMessageIndexes.add(i);
        }
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (hiddenMessageIndexes.has(i)) continue;
      const inbound = extractComsNetInbound(msg);
      if (inbound) {
        const key = comsNetInboundKey(inbound);
        if (inbound.msgId && responseSentByMsgId.has(inbound.msgId)) {
          pendingInbound = null;
          inferredResponseIdx = null;
          continue;
        }
        pendingInbound = { ...inbound, index: i, key };
        inferredResponseIdx = null;
        continue;
      }

      if (isComsNetResponseSent(msg)) {
        if (inferredResponseIdx !== null) comsNetResponses.delete(inferredResponseIdx);
        pendingInbound = null;
        inferredResponseIdx = null;
        continue;
      }

      if (msg.role === "user") {
        pendingInbound = null;
        inferredResponseIdx = null;
        continue;
      }

      if (pendingInbound && msg.role === "assistant" && assistantResponseText(msg)) {
        comsNetResponses.set(i, {
          peer: pendingInbound.peer,
          msgId: pendingInbound.msgId,
        });
        inferredResponseIdx = i;
        pendingInbound = null;
        continue;
      }

      if (pendingInbound && msg.role === "assistant" && !assistantOnlyCallsComsNetTool(msg)) {
        pendingInbound = null;
        inferredResponseIdx = null;
      }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      if (hiddenMessageIndexes.has(i)) continue;
      const msg = messages[i];
      if (msg.role === "toolResult") {
        toolResultsMap.set((msg as import("@/lib/types").ToolResultMessage).toolCallId, msg as import("@/lib/types").ToolResultMessage);
      }
      if (lastUserIdx < 0 && msg.role === "user") lastUserIdx = i;
      if (msg.role === "user") {
        seenAssistantSinceUser = false;
      } else if (msg.role === "assistant") {
        showTimestamp[i] = !seenAssistantSinceUser;
        seenAssistantSinceUser = true;
      }
    }

    if (streamState.isStreaming && messages.length > 0) {
      showTimestamp[messages.length - 1] = false;
    }

    return { toolResultsMap, lastUserIdx, showTimestamp, hiddenMessageIndexes, comsNetResponses };
  }, [messages, streamState.isStreaming]);

  const visibleMessages = useMemo(
    () => messages.filter((m, idx) => !messageRenderData.hiddenMessageIndexes.has(idx) && (m.role === "user" || m.role === "assistant")),
    [messages, messageRenderData.hiddenMessageIndexes],
  );
  const messageRefs = useMessageRefs(visibleMessages.length);

  const handleEditMessageContent = useCallback((content: string) => {
    chatInputRef?.current?.insertIfEmpty(content);
  }, [chatInputRef]);

  const draftStorageKey = session?.id
    ? `session:${session.id}`
    : newSessionCwd
      ? `cwd:${newSessionCwd}`
      : "new";
  const activeCwd = session?.cwd ?? newSessionCwd ?? null;
  const classicAgentsMdElement = activeCwd && !isFluid ? <AgentsMdStatus cwd={activeCwd} variant="classic" /> : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      isStreaming={agentRunning}
      model={displayModelValue}
      modelNames={modelNames}
      modelList={modelList}
      onModelChange={handleModelChange}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      contextUsage={contextUsage}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      planMode={planMode}
      planExecutionMode={planExecutionMode}
      planModeStatus={planModeStatus}
      onPlanModeChange={handlePlanModeChange}
      buddyMode={buddyMode}
      buddyReviewerModel={buddyReviewerModel}
      onBuddyModeChange={handleBuddyModeChange}
      onBuddyReviewerChange={handleBuddyReviewerChange}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      promptHistory={promptHistory}
      draftStorageKey={draftStorageKey}
      cwd={activeCwd}
    />
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        Loading session...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className="pi-chat-window relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[rgba(37,99,235,0.06)] backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[rgba(37,99,235,0.5)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-[0_6px_18px_rgba(37,99,235,0.18)]"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.50)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="rgba(37,99,235,0.16)" stroke="rgba(37,99,235,0.40)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="rgba(37,99,235,0.22)" stroke="rgba(37,99,235,0.55)" strokeWidth="1.6"/>
            <g stroke="rgba(37,99,235,0.45)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      <ExtensionNotices notices={notices} statuses={extensionStatuses} />

      {extensionDialog && (
        <ExtensionDialog
          request={extensionDialog}
          onRespond={respondToExtensionUi}
        />
      )}

      {extensionCustomUi && (
        <ExtensionCustomPanel
          request={extensionCustomUi}
          onInput={sendExtensionCustomInput}
        />
      )}

      {isEmptyNew ? (
        <div
          className={`${isFluid ? "pi-fluid-empty-chat" : "pi-empty-chat"} flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8`}
          style={isFluid ? {
            padding: "76px 48px 42px",
            background: "transparent",
          } : undefined}
        >
          <div className="w-full max-w-[820px]">
            <div
              className="mb-3"
              style={{
                marginLeft: 16,
                marginRight: 52,
              }}
            >
              <BrandTypewriterHeader />
            </div>
            {classicAgentsMdElement}
            <ExtensionWidgets widgets={extensionWidgets.filter((widget) => widget.placement === "aboveEditor")} />
            {chatInputElement}
            <ExtensionWidgets widgets={extensionWidgets.filter((widget) => widget.placement !== "aboveEditor")} />
          </div>
        </div>
      ) : (
      <>
      <div
        className={`${isFluid ? "pi-fluid-chat-body" : "pi-chat-body"} relative flex flex-1 overflow-hidden`}
      >
        <div ref={scrollContainerRef} className="pi-chat-scroll flex-1 overflow-y-auto pt-4 [scrollbar-width:none]">
          <div className="pi-message-stack mx-auto max-w-[820px] px-4">

            {(() => {
              let refIdx = 0;
              const shouldUseLazyMessages = messages.length >= LAZY_MESSAGE_THRESHOLD;
              return messages.map((msg, idx) => {
                if (messageRenderData.hiddenMessageIndexes.has(idx)) return null;
                const messageKey = entryIds[idx] ?? `${msg.role}-${idx}`;
                const prevAssistantEntryId =
                  msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
                    ? entryIds[idx - 1]
                    : undefined;
                const isVisible = msg.role === "user" || msg.role === "assistant";
                const currentRefIdx = isVisible ? refIdx++ : -1;
                const shouldRenderEagerly =
                  !shouldUseLazyMessages ||
                  idx >= messages.length - LAZY_RECENT_MESSAGE_COUNT ||
                  idx === messageRenderData.lastUserIdx ||
                  forkingEntryId === entryIds[idx];
                const view = (
                  <MessageView
                    key={messageKey}
                    message={msg}
                    toolResults={messageRenderData.toolResultsMap}
                    runningToolIds={runningToolIds}
                    toolExecutionStatuses={toolExecutionStatuses}
                    modelNames={modelNames}
                    comsNetResponse={messageRenderData.comsNetResponses.get(idx)}
                    entryId={entryIds[idx]}
                    onFork={agentRunning || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
                    forking={forkingEntryId === entryIds[idx]}
                    onNavigate={agentRunning ? undefined : handleNavigate}
                    prevAssistantEntryId={agentRunning ? undefined : prevAssistantEntryId}
                    onEditContent={handleEditMessageContent}
                    showTimestamp={messageRenderData.showTimestamp[idx]}
                    prevTimestamp={idx > 0 ? (messages[idx - 1] as import("@/lib/types").AgentMessage & { timestamp?: number }).timestamp : undefined}
                    nextTimestamp={idx < messages.length - 1 ? (messages[idx + 1] as import("@/lib/types").AgentMessage & { timestamp?: number }).timestamp : undefined}
                  />
                );
                if (msg.role === "toolResult") return view;

                const registerRef = isVisible
                  ? (el: HTMLDivElement | null) => {
                      messageRefs.current[currentRefIdx] = el;
                      if (idx === messageRenderData.lastUserIdx) {
                        (lastUserMsgRef as { current: HTMLDivElement | null }).current = el;
                      }
                    }
                  : undefined;

                return (
                  <LazyMessageSlot
                    key={messageKey}
                    eager={shouldRenderEagerly}
                    estimatedHeight={estimateMessageHeight(msg)}
                    registerRef={registerRef}
                    scrollRoot={scrollContainerRef}
                  >
                    {view}
                  </LazyMessageSlot>
                );
              });
            })()}

            {streamState.isStreaming && streamState.streamingMessage && (
              <MessageView message={streamState.streamingMessage as AgentMessage} isStreaming runningToolIds={runningToolIds} toolExecutionStatuses={toolExecutionStatuses} modelNames={modelNames} />
            )}

            {agentRunning && !streamState.streamingMessage && (
              <div className="pi-running-phase py-2 text-[13px] text-text-muted">
                <span className="animate-[pulse_1.5s_infinite]">{phaseLabel(agentPhase)}</span>
              </div>
            )}

            <div ref={messagesEndRef} />

            {agentRunning && (
              <div style={{ height: scrollContainerRef.current ? scrollContainerRef.current.clientHeight : "80vh" }} />
            )}
          </div>
        </div>
        {!isFluid && (
          <ChatMinimap
            messages={messages}
            streamingMessage={streamState.streamingMessage}
            scrollContainer={scrollContainerRef}
            messageRefs={messageRefs}
          />
        )}
      </div>

      <div
        className={`${isFluid ? "pi-fluid-composer-dock" : "pi-composer-dock"} relative`}
        style={isFluid ? {
          background: "linear-gradient(180deg, transparent, color-mix(in srgb, var(--bg) 82%, transparent) 28px, color-mix(in srgb, var(--bg) 90%, transparent))",
        } : undefined}
      >
        {classicAgentsMdElement}
        <ExtensionWidgets widgets={extensionWidgets.filter((widget) => widget.placement === "aboveEditor")} />
        {chatInputElement}
        <ExtensionWidgets widgets={extensionWidgets.filter((widget) => widget.placement !== "aboveEditor")} />
      </div>
      </>
      )}
    </div>
  );
}

type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

function ExtensionNotices({
  notices,
  statuses,
}: {
  notices: NoticeItem[];
  statuses: Array<{ key: string; text: string }>;
}) {
  if (notices.length === 0 && statuses.length === 0) return null;
  return (
    <div className="pointer-events-none absolute right-4 top-4 z-[90] flex w-[min(360px,calc(100%-32px))] flex-col gap-2">
      {statuses.map((status) => (
        <div
          key={status.key}
          className="rounded-md border border-border bg-bg-panel px-3 py-2 text-[12px] text-text-muted shadow-lg"
        >
          <span className="font-mono text-[11px] text-text-dim">{status.key}</span>
          <span className="ml-2 text-text">{status.text}</span>
        </div>
      ))}
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="rounded-md border border-border bg-bg-panel px-3 py-2 text-[13px] shadow-lg"
          style={{
            color: notice.type === "error" ? "#fca5a5" : notice.type === "warning" ? "#fbbf24" : "var(--text)",
          }}
        >
          {notice.message}
        </div>
      ))}
    </div>
  );
}

function ExtensionWidgets({
  widgets,
}: {
  widgets: Array<{ key: string; lines: string[]; placement?: "aboveEditor" | "belowEditor" }>;
}) {
  if (widgets.length === 0) return null;
  return (
    <div className="mx-auto mb-2 flex w-full max-w-[820px] flex-col gap-2 px-4">
      {widgets.map((widget) => (
        <pre
          key={widget.key}
          className="m-0 overflow-auto rounded-md border border-border bg-bg-panel px-3 py-2 font-mono text-[12px] leading-[1.45] text-text-muted"
        >
          {widget.lines.join("\n")}
        </pre>
      ))}
    </div>
  );
}

function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: { value?: unknown; confirmed?: boolean; cancelled?: boolean }) => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    setValue(request.method === "editor" ? request.prefill ?? "" : "");
  }, [request]);

  const cancel = () => onRespond(request, { cancelled: true });
  const submitValue = () => onRespond(request, { value });

  return (
    <div className="absolute inset-0 z-[94] flex items-center justify-center bg-[rgba(0,0,0,0.18)] p-5">
      <div className="w-[min(520px,100%)] overflow-hidden rounded-lg border border-border bg-bg shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
        <div className="border-b border-border px-4 py-3 text-[14px] font-semibold text-text">
          {request.title}
        </div>
        <div className="p-4">
          {request.method === "select" && (
            <div className="flex flex-col gap-2">
              {request.options.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="rounded-md border border-border bg-bg-panel px-3 py-2 text-left text-[13px] text-text hover:border-accent"
                  onClick={() => onRespond(request, { value: option })}
                >
                  {option}
                </button>
              ))}
            </div>
          )}
          {request.method === "confirm" && (
            <div className="text-[13px] leading-6 text-text-muted">{request.message}</div>
          )}
          {request.method === "input" && (
            <input
              autoFocus
              className="w-full rounded-md border border-border bg-bg-panel px-3 py-2 text-[13px] text-text outline-none focus:border-accent"
              placeholder={request.placeholder}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitValue();
                if (event.key === "Escape") cancel();
              }}
            />
          )}
          {request.method === "editor" && (
            <textarea
              autoFocus
              className="min-h-[180px] w-full resize-y rounded-md border border-border bg-bg-panel px-3 py-2 font-mono text-[13px] text-text outline-none focus:border-accent"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") cancel();
              }}
            />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            className="rounded-md border border-border bg-bg-panel px-3 py-1.5 text-[12px] text-text-muted hover:text-text"
            onClick={cancel}
          >
            Cancel
          </button>
          {request.method === "confirm" ? (
            <>
              <button
                type="button"
                className="rounded-md border border-border bg-bg-panel px-3 py-1.5 text-[12px] text-text hover:border-accent"
                onClick={() => onRespond(request, { confirmed: false })}
              >
                No
              </button>
              <button
                type="button"
                className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] text-white"
                onClick={() => onRespond(request, { confirmed: true })}
              >
                Yes
              </button>
            </>
          ) : request.method !== "select" ? (
            <button
              type="button"
              className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] text-white"
              onClick={submitValue}
            >
              OK
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function toTerminalKeyData(event: KeyboardEvent): string | null {
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
    const ch = event.key.toLowerCase();
    if (ch >= "a" && ch <= "z") {
      return String.fromCharCode(ch.charCodeAt(0) - 96);
    }
  }

  switch (event.key) {
    case "ArrowUp":
      return "\x1b[A";
    case "ArrowDown":
      return "\x1b[B";
    case "ArrowRight":
      return "\x1b[C";
    case "ArrowLeft":
      return "\x1b[D";
    case "Enter":
      return "\r";
    case "Escape":
      return "\x1b";
    case "Backspace":
      return "\x7f";
    case "Tab":
      return "\t";
    case " ":
      return " ";
    default:
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) return event.key;
      return null;
  }
}

const ANSI_ESCAPE_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const ANSI_ESCAPE_AT_START_RE = /^\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/;
const ANSI_SGR_RE = /\x1B\[([0-9;]*)m/g;
const ANSI_8_COLORS = ["#1f2937", "#dc2626", "#16a34a", "#d97706", "#2563eb", "#9333ea", "#0891b2", "#6b7280"];
const ANSI_BRIGHT_COLORS = ["#9ca3af", "#ef4444", "#22c55e", "#f59e0b", "#3b82f6", "#a855f7", "#06b6d4", "#e5e7eb"];

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

function visibleCharPositions(text: string): Array<{ start: number; end: number; char: string }> {
  const positions: Array<{ start: number; end: number; char: string }> = [];
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b) {
      const match = text.slice(i).match(ANSI_ESCAPE_AT_START_RE);
      if (match) {
        i += match[0].length;
        continue;
      }
    }
    const codePoint = text.codePointAt(i);
    if (codePoint === undefined) break;
    const char = String.fromCodePoint(codePoint);
    positions.push({ start: i, end: i + char.length, char });
    i += char.length;
  }
  return positions;
}

function removeVisibleCharAt(text: string, index: number): string {
  const pos = visibleCharPositions(text)[index];
  if (!pos) return text;
  return text.slice(0, pos.start) + text.slice(pos.end);
}

function firstVisibleChar(text: string): string | undefined {
  return visibleCharPositions(text)[0]?.char;
}

function lastNonSpaceVisibleCharIndex(text: string): number {
  const positions = visibleCharPositions(text);
  for (let i = positions.length - 1; i >= 0; i--) {
    if (positions[i].char.trim() !== "") return i;
  }
  return -1;
}

function trimEndVisibleSpaces(text: string): string {
  let next = text;
  while (true) {
    const positions = visibleCharPositions(next);
    const last = positions[positions.length - 1];
    if (!last || last.char.trim() !== "") return next;
    next = next.slice(0, last.start) + next.slice(last.end);
  }
}

function normalizeCustomPanelLines(lines: string[]): string[] {
  const horizontalFrameLine = /^[┌├└╭╰][─┬┴┼]+[┐┤┘╮╯]$/;
  const normalized: string[] = [];

  for (const rawLine of lines) {
    const plain = stripAnsi(rawLine).trimEnd();
    if (horizontalFrameLine.test(plain)) continue;
    let line = rawLine;
    const first = firstVisibleChar(line);
    if (first === "│" || first === "┃") {
      line = removeVisibleCharAt(line, 0);
      if (firstVisibleChar(line) === " ") line = removeVisibleCharAt(line, 0);
    }
    const rightBorderIndex = lastNonSpaceVisibleCharIndex(line);
    const rightBorder = rightBorderIndex >= 0 ? visibleCharPositions(line)[rightBorderIndex]?.char : undefined;
    if (rightBorder === "│" || rightBorder === "┃") line = removeVisibleCharAt(line, rightBorderIndex);
    normalized.push(trimEndVisibleSpaces(line));
  }

  while (normalized.length > 0 && stripAnsi(normalized[0]).trim() === "") normalized.shift();
  while (normalized.length > 0 && stripAnsi(normalized[normalized.length - 1]).trim() === "") normalized.pop();
  return normalized.length ? normalized : lines;
}

function ansi256Color(index: number): string | undefined {
  if (index >= 0 && index < 8) return ANSI_8_COLORS[index];
  if (index >= 8 && index < 16) return ANSI_BRIGHT_COLORS[index - 8];
  if (index >= 16 && index <= 231) {
    const n = index - 16;
    const r = Math.floor(n / 36);
    const g = Math.floor((n % 36) / 6);
    const b = n % 6;
    const scale = (value: number) => value === 0 ? 0 : 55 + value * 40;
    return `rgb(${scale(r)}, ${scale(g)}, ${scale(b)})`;
  }
  if (index >= 232 && index <= 255) {
    const gray = 8 + (index - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  return undefined;
}

function applyAnsiCodes(style: CSSProperties, codes: number[]): CSSProperties {
  const next: CSSProperties = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    if (code === 0) {
      for (const key of Object.keys(next) as Array<keyof CSSProperties>) delete next[key];
    } else if (code === 1) next.fontWeight = 700;
    else if (code === 2) next.opacity = 0.65;
    else if (code === 3) next.fontStyle = "italic";
    else if (code === 4) next.textDecoration = "underline";
    else if (code === 22) {
      delete next.fontWeight;
      delete next.opacity;
    } else if (code === 23) delete next.fontStyle;
    else if (code === 24) delete next.textDecoration;
    else if (code === 39) delete next.color;
    else if (code === 49) delete next.backgroundColor;
    else if (code >= 30 && code <= 37) next.color = ANSI_8_COLORS[code - 30];
    else if (code >= 90 && code <= 97) next.color = ANSI_BRIGHT_COLORS[code - 90];
    else if (code >= 40 && code <= 47) next.backgroundColor = ANSI_8_COLORS[code - 40];
    else if (code >= 100 && code <= 107) next.backgroundColor = ANSI_BRIGHT_COLORS[code - 100];
    else if ((code === 38 || code === 48) && codes[i + 1] === 2) {
      const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
      if ([r, g, b].every((value) => typeof value === "number" && Number.isFinite(value))) {
        if (code === 38) next.color = `rgb(${r}, ${g}, ${b})`;
        else next.backgroundColor = `rgb(${r}, ${g}, ${b})`;
      }
      i += 4;
    } else if ((code === 38 || code === 48) && codes[i + 1] === 5) {
      const color = ansi256Color(codes[i + 2]);
      if (color) {
        if (code === 38) next.color = color;
        else next.backgroundColor = color;
      }
      i += 2;
    }
  }
  return next;
}

function renderAnsiLine(line: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let style: CSSProperties = {};
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  ANSI_SGR_RE.lastIndex = 0;

  while ((match = ANSI_SGR_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      const text = line.slice(lastIndex, match.index);
      nodes.push(Object.keys(style).length > 0 ? <span key={`${keyPrefix}-${nodes.length}`} style={style}>{text}</span> : text);
    }
    const codes = match[1] ? match[1].split(";").map((part) => Number(part || "0")) : [0];
    style = applyAnsiCodes(style, codes);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    const text = line.slice(lastIndex);
    nodes.push(Object.keys(style).length > 0 ? <span key={`${keyPrefix}-${nodes.length}`} style={style}>{text}</span> : text);
  }

  return nodes;
}

function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const displayLines = normalizeCustomPanelLines(request.lines);

  useEffect(() => {
    panelRef.current?.focus();
  }, [request.id]);

  return (
    <div className="absolute inset-0 z-[95] flex items-center justify-center bg-[rgba(0,0,0,0.18)] p-5">
      <div
        ref={panelRef}
        tabIndex={0}
        role="dialog"
        aria-modal="true"
        className="w-[min(920px,100%)] overflow-hidden rounded-lg border border-border bg-bg shadow-[0_20px_60px_rgba(0,0,0,0.28)] outline-none"
        style={{ maxHeight: "min(760px, calc(100vh - 40px))" }}
        onKeyDown={(event) => {
          const data = toTerminalKeyData(event);
          if (!data) return;
          event.preventDefault();
          event.stopPropagation();
          onInput(request, data);
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="text-[13px] font-semibold text-text">Extension panel</div>
          <button
            type="button"
            className="rounded-md border border-border bg-bg-panel px-2.5 py-1 text-[12px] text-text-muted hover:text-text"
            onClick={() => onInput(request, "\x03")}
          >
            Close
          </button>
        </div>
        <pre
          className="m-0 overflow-auto bg-bg-panel p-3 font-mono text-[13px] leading-[1.45] text-text"
          style={{ maxHeight: "calc(min(760px, 100vh - 40px) - 48px)", whiteSpace: "pre" }}
        >
          {(displayLines.length ? displayLines : [""]).map((line, index, allLines) => (
            <Fragment key={index}>
              {renderAnsiLine(line, `line-${index}`)}
              {index < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}
