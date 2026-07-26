"use client";

import { useCallback, useEffect, useRef } from "react";
import { useCommandsController } from "./agent-session/useCommandsController";
import { useLifecycleGate } from "./agent-session/useLifecycleGate";
import { usePreferencesController } from "./agent-session/usePreferencesController";
import { useRuntimeController } from "./agent-session/useRuntimeController";
import { useScrollController } from "./agent-session/useScrollController";
import { useSessionDataController } from "./agent-session/useSessionDataController";
import type { LiveAgentState, UseAgentSessionOptions } from "./agent-session/types";

export type {
  AgentPhase,
  AttachedImage,
  ChatInputHandle,
  NoticeItem,
  NoticeType,
  SessionData,
  ThinkingLevelOption,
  UseAgentSessionOptions,
} from "./agent-session/types";

export function useAgentSession(options: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange,
  } = options;
  const isNew = session === null && newSessionCwd !== null;
  const identity = session?.id ? `session:${session.id}` : `cwd:${newSessionCwd ?? "none"}`;
  const gate = useLifecycleGate(identity);
  const sessionData = useSessionDataController({ session, isNew, gate });

  const applyPreferenceStateRef = useRef<((state: LiveAgentState | undefined) => void) | null>(null);
  const applyPreferenceState = useCallback((state: LiveAgentState | undefined) => {
    applyPreferenceStateRef.current?.(state);
  }, []);

  const runtime = useRuntimeController({
    identity,
    sessionIdRef: sessionData.sessionIdRef,
    messagesRef: sessionData.messagesRef,
    setMessages: sessionData.setMessages,
    gate,
    loadSession: sessionData.loadSession,
    applyPreferenceState,
    onAgentEnd,
    chatInputRef: options.chatInputRef,
  });

  const preferences = usePreferencesController({
    sessionId: session?.id ?? null,
    sessionCwd: session?.cwd ?? null,
    newSessionCwd,
    isNew,
    modelsRefreshKey,
    sessionIdRef: sessionData.sessionIdRef,
    agentRunningRef: runtime.agentRunningRef,
    gate,
    contextModel: sessionData.data?.context.model ?? null,
    contextThinkingLevel: sessionData.sessionThinkingLevel,
    currentModelOverride: sessionData.currentModelOverride,
    pendingModel: sessionData.pendingModel,
    setCurrentModelOverride: sessionData.setCurrentModelOverride,
    setTaskError: runtime.setTaskError,
    externalSetNewSessionModel: options.setNewSessionModel,
  });
  applyPreferenceStateRef.current = preferences.applyPreferenceState;

  const scroll = useScrollController({
    identity,
    messageCount: sessionData.messages.length,
    agentRunning: runtime.agentRunning,
    agentRunningRef: runtime.agentRunningRef,
    streamState: runtime.streamState,
  });

  const commands = useCommandsController({
    identity,
    session,
    newSessionCwd,
    isNew,
    sessionIdRef: sessionData.sessionIdRef,
    agentRunning: runtime.agentRunning,
    setAgentRunning: runtime.setAgentRunning,
    setAgentPhase: runtime.setAgentPhase,
    dispatch: runtime.dispatch,
    setMessages: sessionData.setMessages,
    setTaskError: runtime.setTaskError,
    isCompacting: runtime.isCompacting,
    setIsCompacting: runtime.setIsCompacting,
    setCompactError: runtime.setCompactError,
    loadSession: sessionData.loadSession,
    loadContext: sessionData.loadContext,
    setActiveLeafId: sessionData.setActiveLeafId,
    setPendingModel: sessionData.setPendingModel,
    connectEvents: runtime.connectEvents,
    newSessionModel: preferences.newSessionModel,
    thinkingLevel: preferences.thinkingLevel,
    planMode: preferences.planMode,
    planExecutionMode: preferences.planExecutionMode,
    buddyMode: preferences.buddyMode,
    buddyReviewerModel: preferences.buddyReviewerModel,
    onSessionCreated,
    onSessionForked,
    pendingScrollToUserRef: scroll.pendingScrollToUserRef,
  });

  const loadSession = sessionData.loadSession;
  const sessionIdRef = sessionData.sessionIdRef;
  const applyAgentState = runtime.applyAgentState;
  const connectEvents = runtime.connectEvents;
  const selectedSessionId = session?.id ?? null;

  useEffect(() => {
    if (!selectedSessionId) return;
    const token = gate.capture();
    const sid = selectedSessionId;
    void loadSession(sid, { showLoading: true, includeState: true }).then((agentState) => {
      if (!gate.isCurrent(token) || sessionIdRef.current !== sid) return;
      applyAgentState(agentState);
      if (agentState?.running && agentState.state?.isStreaming) connectEvents(sid);
    });
  }, [applyAgentState, connectEvents, gate, loadSession, selectedSessionId, sessionIdRef]);

  useEffect(() => {
    onSystemPromptChange?.(runtime.systemPrompt);
  }, [onSystemPromptChange, runtime.systemPrompt]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(
      sessionData.data?.tree ?? [],
      sessionData.activeLeafId,
      commands.handleLeafChange,
    );
  }, [commands.handleLeafChange, onBranchDataChange, sessionData.activeLeafId, sessionData.data?.tree]);

  const currentModel = sessionData.currentModelOverride
    ?? sessionData.data?.context.model
    ?? sessionData.pendingModel
    ?? null;

  return {
    data: sessionData.data,
    loading: sessionData.loading,
    error: sessionData.error,
    activeLeafId: sessionData.activeLeafId,
    messages: sessionData.messages,
    entryIds: sessionData.entryIds,
    streamState: runtime.streamState,
    agentRunning: runtime.agentRunning,
    modelNames: preferences.modelNames,
    modelList: preferences.modelList,
    modelThinkingLevels: preferences.modelThinkingLevels,
    modelThinkingLevelMaps: preferences.modelThinkingLevelMaps,
    newSessionModel: preferences.newSessionModel,
    thinkingLevel: preferences.thinkingLevel,
    retryInfo: runtime.retryInfo,
    contextUsage: runtime.contextUsage,
    systemPrompt: runtime.systemPrompt,
    forkingEntryId: commands.forkingEntryId,
    isCompacting: runtime.isCompacting,
    compactError: runtime.compactError,
    currentModel,
    displayModel: preferences.displayModel,
    sessionStats: sessionData.sessionStats,
    taskError: runtime.taskError,
    agentPhase: runtime.agentPhase,
    toolExecutionStatuses: runtime.toolExecutionStatuses,
    planMode: preferences.planMode,
    planExecutionMode: preferences.planExecutionMode,
    planModeStatus: preferences.planModeStatus,
    buddyMode: preferences.buddyMode,
    buddyReviewerModel: preferences.buddyReviewerModel,
    notices: runtime.notices,
    extensionDialog: runtime.extensionDialog,
    extensionCustomUi: runtime.extensionCustomUi,
    extensionStatuses: runtime.extensionStatuses,
    extensionWidgets: runtime.extensionWidgets,
    isNew,
    sessionIdRef: sessionData.sessionIdRef,
    eventSourceRef: runtime.eventSourceRef,
    messagesEndRef: scroll.messagesEndRef,
    scrollContainerRef: scroll.scrollContainerRef,
    lastUserMsgRef: scroll.lastUserMsgRef,
    pendingScrollToUserRef: scroll.pendingScrollToUserRef,
    initialScrollDoneRef: scroll.initialScrollDoneRef,
    handleSend: commands.handleSend,
    handleAbort: commands.handleAbort,
    handleFork: commands.handleFork,
    handleNavigate: commands.handleNavigate,
    handleModelChange: preferences.handleModelChange,
    handleCompact: commands.handleCompact,
    handleSteer: commands.handleSteer,
    handleFollowUp: commands.handleFollowUp,
    handleAbortCompaction: commands.handleAbortCompaction,
    handleThinkingLevelChange: preferences.handleThinkingLevelChange,
    handlePlanModeChange: preferences.handlePlanModeChange,
    handleBuddyModeChange: preferences.handleBuddyModeChange,
    handleBuddyReviewerChange: preferences.handleBuddyReviewerChange,
    setActiveLeafId: sessionData.setActiveLeafId,
    setData: sessionData.setData,
    setMessages: sessionData.setMessages,
    respondToExtensionUi: runtime.respondToExtensionUi,
    sendExtensionCustomInput: runtime.sendExtensionCustomInput,
    dispatch: runtime.dispatch,
    setAgentRunning: runtime.setAgentRunning,
    setForkingEntryId: commands.setForkingEntryId,
    handleAgentEventRef: runtime.handleAgentEventRef,
  };
}
