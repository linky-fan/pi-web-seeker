"use client";

import { useCallback, useMemo } from "react";
import { useAgentSession } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useUiMode } from "@/hooks/useUiMode";
import type { ChatInputProps } from "./chat-input/types";
import { ComposerSurface } from "./chat-window/ComposerSurface";
import { ConversationRegion } from "./chat-window/ConversationRegion";
import { DragOverlay } from "./chat-window/DragOverlay";
import { ExtensionLayer } from "./chat-window/ExtensionUi";
import { buildMessageProjection, buildPromptHistory } from "./chat-window/messageProjection";
import type { ChatWindowProps } from "./chat-window/types";
import { useChatWindowBridge } from "./chat-window/useChatWindowBridge";

export function ChatWindow({
  session,
  newSessionCwd,
  onAgentEnd,
  onSessionCreated,
  onSessionForked,
  modelsRefreshKey,
  chatInputRef,
  onBranchDataChange,
  onSystemPromptChange,
  onSessionStatsChange,
  onContextUsageChange,
  onTaskStatusChange,
  onComposerActivityChange,
}: ChatWindowProps) {
  const { isFluid } = useUiMode();
  const agent = useAgentSession({
    session,
    newSessionCwd,
    onAgentEnd,
    onSessionCreated,
    onSessionForked,
    modelsRefreshKey,
    chatInputRef,
    onBranchDataChange,
    onSystemPromptChange,
  });
  const { soundEnabled, onSoundToggle, playDoneSound } = useAudio();

  const taskStatusMessage = agent.error ?? agent.taskError ?? agent.compactError ?? null;
  const taskStatus = taskStatusMessage ? "error" : agent.agentRunning ? "running" : "done";
  useChatWindowBridge({
    handleAgentEventRef: agent.handleAgentEventRef,
    soundEnabled,
    playDoneSound,
    sessionStats: agent.sessionStats,
    contextUsage: agent.contextUsage,
    taskStatus,
    taskStatusMessage,
    onSessionStatsChange,
    onContextUsageChange,
    onTaskStatusChange,
  });

  const onDrop = useCallback((files: File[]) => chatInputRef?.current?.addImages(files), [chatInputRef]);
  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const projection = useMemo(
    () => buildMessageProjection(agent.messages, agent.streamState.isStreaming),
    [agent.messages, agent.streamState.isStreaming],
  );
  const promptHistory = useMemo(() => buildPromptHistory(agent.messages), [agent.messages]);
  const runningToolIds = useMemo(
    () => agent.agentPhase?.kind === "running_tools"
      ? new Set(agent.agentPhase.tools.map((tool) => tool.id))
      : new Set<string>(),
    [agent.agentPhase],
  );
  const handleEditMessageContent = useCallback(
    (content: string) => chatInputRef?.current?.insertIfEmpty(content),
    [chatInputRef],
  );

  const activeCwd = session?.cwd ?? newSessionCwd ?? null;
  const draftStorageKey = session?.id
    ? `session:${session.id}`
    : newSessionCwd
      ? `cwd:${newSessionCwd}`
      : "new";
  const canControlSession = Boolean(session || agent.isNew);
  const availableThinkingLevels = agent.displayModel
    ? agent.modelThinkingLevels[`${agent.displayModel.provider}:${agent.displayModel.modelId}`] ?? null
    : null;
  const currentThinkingLevelMap = agent.displayModel
    ? agent.modelThinkingLevelMaps[`${agent.displayModel.provider}:${agent.displayModel.modelId}`] ?? null
    : null;

  const inputProps = useMemo<ChatInputProps>(() => ({
    onSend: agent.handleSend,
    onAbort: agent.handleAbort,
    onSteer: agent.agentRunning ? agent.handleSteer : undefined,
    onFollowUp: agent.agentRunning ? agent.handleFollowUp : undefined,
    isStreaming: agent.agentRunning,
    model: agent.displayModel,
    modelNames: agent.modelNames,
    modelList: agent.modelList,
    onModelChange: agent.handleModelChange,
    onCompact: canControlSession ? agent.handleCompact : undefined,
    onAbortCompaction: agent.handleAbortCompaction,
    isCompacting: agent.isCompacting,
    compactError: agent.compactError,
    contextUsage: agent.contextUsage,
    thinkingLevel: agent.thinkingLevel,
    onThinkingLevelChange: canControlSession ? agent.handleThinkingLevelChange : undefined,
    planMode: agent.planMode,
    planExecutionMode: agent.planExecutionMode,
    planModeStatus: agent.planModeStatus,
    onPlanModeChange: agent.handlePlanModeChange,
    buddyMode: agent.buddyMode,
    buddyReviewerModel: agent.buddyReviewerModel,
    onBuddyModeChange: agent.handleBuddyModeChange,
    onBuddyReviewerChange: agent.handleBuddyReviewerChange,
    availableThinkingLevels,
    thinkingLevelMap: currentThinkingLevelMap,
    retryInfo: agent.retryInfo,
    soundEnabled,
    onSoundToggle,
    promptHistory,
    draftStorageKey,
    cwd: activeCwd,
    onActivityChange: onComposerActivityChange,
  }), [
    activeCwd,
    agent.agentRunning,
    agent.buddyMode,
    agent.buddyReviewerModel,
    agent.compactError,
    agent.contextUsage,
    agent.displayModel,
    agent.handleAbort,
    agent.handleAbortCompaction,
    agent.handleBuddyModeChange,
    agent.handleBuddyReviewerChange,
    agent.handleCompact,
    agent.handleFollowUp,
    agent.handleModelChange,
    agent.handlePlanModeChange,
    agent.handleSend,
    agent.handleSteer,
    agent.handleThinkingLevelChange,
    agent.isCompacting,
    agent.modelList,
    agent.modelNames,
    agent.planExecutionMode,
    agent.planMode,
    agent.planModeStatus,
    agent.retryInfo,
    agent.thinkingLevel,
    availableThinkingLevels,
    canControlSession,
    currentThinkingLevelMap,
    draftStorageKey,
    onComposerActivityChange,
    onSoundToggle,
    promptHistory,
    soundEnabled,
  ]);

  const aboveWidgets = useMemo(
    () => agent.extensionWidgets.filter((widget) => widget.placement === "aboveEditor"),
    [agent.extensionWidgets],
  );
  const belowWidgets = useMemo(
    () => agent.extensionWidgets.filter((widget) => widget.placement !== "aboveEditor"),
    [agent.extensionWidgets],
  );
  const isEmptyNew = agent.isNew && agent.messages.length === 0 && !agent.streamState.isStreaming && !agent.agentRunning;

  if (agent.loading) {
    return <div className="flex h-full items-center justify-center text-text-muted">Loading session...</div>;
  }
  if (agent.error) {
    return <div className="flex h-full items-center justify-center text-red-400">{agent.error}</div>;
  }

  return (
    <div
      className="pi-chat-window relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && <DragOverlay />}
      <ExtensionLayer
        statuses={agent.extensionStatuses}
        notices={agent.notices}
        dialog={agent.extensionDialog}
        customUi={agent.extensionCustomUi}
        onRespond={agent.respondToExtensionUi}
        onCustomInput={agent.sendExtensionCustomInput}
      />
      {!isEmptyNew && (
        <ConversationRegion
          isFluid={isFluid}
          messages={agent.messages}
          entryIds={agent.entryIds}
          projection={projection}
          streamingMessage={agent.streamState.streamingMessage}
          isStreaming={agent.streamState.isStreaming}
          agentRunning={agent.agentRunning}
          agentPhase={agent.agentPhase}
          runningToolIds={runningToolIds}
          toolExecutionStatuses={agent.toolExecutionStatuses}
          modelNames={agent.modelNames}
          isNew={agent.isNew}
          forkingEntryId={agent.forkingEntryId}
          scrollContainerRef={agent.scrollContainerRef}
          messagesEndRef={agent.messagesEndRef}
          lastUserMsgRef={agent.lastUserMsgRef}
          onFork={agent.handleFork}
          onNavigate={agent.handleNavigate}
          onEditContent={handleEditMessageContent}
        />
      )}
      <ComposerSurface
        empty={isEmptyNew}
        isFluid={isFluid}
        activeCwd={activeCwd}
        inputRef={chatInputRef}
        inputProps={inputProps}
        aboveWidgets={aboveWidgets}
        belowWidgets={belowWidgets}
      />
    </div>
  );
}
