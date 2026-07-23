"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ComposerActivity } from "../ChatInput";
import { updateBrowserTaskStatus } from "./helpers";
import { reconcileWorkspaceSelection, sessionUrl } from "./session-state";
import type { ShellContextUsage, ShellSessionStats, TaskStatus } from "./types";

interface Options {
  onResetTransientUi: () => void;
}

export function useSessionWorkspaceController({ onResetTransientUi }: Options) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [sessionStats, setSessionStats] = useState<ShellSessionStats | null>(null);
  const [contextUsage, setContextUsage] = useState<ShellContextUsage | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("done");
  const [composerActivity, setComposerActivity] = useState<ComposerActivity>({ focused: false, hasDraft: false });
  const [initialSessionId] = useState<string | null>(() => searchParams.get("session"));
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !searchParams.get("session"));
  const branchLeafChangeRef = useRef<((leafId: string | null) => void) | null>(null);
  const suppressCwdBumpRef = useRef(false);

  const resetSessionDetails = useCallback(() => {
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
  }, []);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeRef.current?.(leafId);
  }, []);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  const handleSessionStatsChange = useCallback((stats: ShellSessionStats | null) => {
    setSessionStats(stats);
  }, []);

  const handleContextUsageChange = useCallback((usage: ShellContextUsage | null) => {
    setContextUsage(usage);
  }, []);

  const handleTaskStatusChange = useCallback((status: TaskStatus) => {
    setTaskStatus(status);
  }, []);

  const handleComposerActivityChange = useCallback((activity: ComposerActivity) => {
    setComposerActivity(activity);
  }, []);

  useEffect(() => {
    updateBrowserTaskStatus(taskStatus);
  }, [taskStatus]);

  const handleCwdChange = useCallback((cwd: string | null) => {
    setActiveCwd(cwd);
    const transition = reconcileWorkspaceSelection(selectedSession, newSessionCwd, cwd, suppressCwdBumpRef.current);
    if (!transition.shouldReset) return;
    setSelectedSession(transition.selectedSession);
    setNewSessionCwd(transition.newSessionCwd);
    setSessionKey((key) => key + 1);
    resetSessionDetails();
    onResetTransientUi();
    router.replace(sessionUrl(null), { scroll: false });
  }, [newSessionCwd, onResetTransientUi, resetSessionDetails, router, selectedSession]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionKey((key) => key + 1);
    setSystemPrompt(null);
    setInitialSessionRestored(true);
    if (isRestore) {
      suppressCwdBumpRef.current = true;
      setTimeout(() => { suppressCwdBumpRef.current = false; }, 0);
    } else {
      router.replace(sessionUrl(session.id), { scroll: false });
    }
  }, [router]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((key) => key + 1);
    resetSessionDetails();
    onResetTransientUi();
    router.replace(sessionUrl(null), { scroll: false });
  }, [onResetTransientUi, resetSessionDetails, router]);

  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((key) => key + 1);
    router.replace(sessionUrl(session.id), { scroll: false });
  }, [router]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((key) => key + 1);
    setExplorerRefreshKey((key) => key + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((key) => key + 1);
    setSessionKey((key) => key + 1);
    setNewSessionCwd(null);
    setSelectedSession((previous) => ({
      ...(previous ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    router.replace(sessionUrl(newSessionId), { scroll: false });
  }, [router]);

  const applyImportedSession = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((key) => key + 1);
    setSessionKey((key) => key + 1);
    resetSessionDetails();
    onResetTransientUi();
    router.replace(sessionUrl(session.id), { scroll: false });
  }, [onResetTransientUi, resetSessionDetails, router]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((key) => key + 1);
    if (selectedSession?.id !== sessionId) return;
    setSelectedSession(null);
    setNewSessionCwd(selectedSession.cwd ?? null);
    setSessionKey((key) => key + 1);
    resetSessionDetails();
    onResetTransientUi();
    router.replace(sessionUrl(null), { scroll: false });
  }, [onResetTransientUi, resetSessionDetails, router, selectedSession]);

  const refreshModels = useCallback(() => {
    setModelsRefreshKey((key) => key + 1);
  }, []);

  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const capabilitiesCwd = activeCwd || selectedSession?.cwd || newSessionCwd || null;
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const showPlaceholder = initialSessionRestored && !showChat;

  return {
    selectedSession,
    newSessionCwd,
    activeCwd,
    refreshKey,
    sessionKey,
    explorerRefreshKey,
    modelsRefreshKey,
    branchTree,
    branchActiveLeafId,
    systemPrompt,
    sessionStats,
    contextUsage,
    taskStatus,
    composerActivity,
    initialSessionId,
    effectiveNewSessionCwd,
    capabilitiesCwd,
    showChat,
    showPlaceholder,
    handleBranchDataChange,
    handleBranchLeafChange,
    handleSystemPromptChange,
    handleSessionStatsChange,
    handleContextUsageChange,
    handleTaskStatusChange,
    handleComposerActivityChange,
    handleCwdChange,
    handleSelectSession,
    handleNewSession,
    handleSessionCreated,
    handleAgentEnd,
    handleSessionForked,
    applyImportedSession,
    handleInitialRestoreDone,
    handleSessionDeleted,
    refreshModels,
  };
}
