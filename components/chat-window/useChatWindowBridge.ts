"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { collectFileChanges, type FileChange } from "@/lib/file-changes";
import type { ContextUsage, SessionStats } from "./types";

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

interface Options {
  handleAgentEventRef: RefObject<((event: AgentEvent) => void) | null>;
  soundEnabled: boolean;
  playDoneSound: () => void;
  sessionStats: SessionStats | null;
  contextUsage: ContextUsage | null;
  taskStatus: "done" | "running" | "error";
  taskStatusMessage: string | null;
  messages: readonly unknown[];
  onSessionStatsChange?: (stats: SessionStats | null) => void;
  onFileChangesChange?: (changes: FileChange[]) => void;
  onContextUsageChange?: (usage: ContextUsage | null) => void;
  onTaskStatusChange?: (status: "done" | "running" | "error", message?: string | null) => void;
}

export function useChatWindowBridge({
  handleAgentEventRef,
  soundEnabled,
  playDoneSound,
  sessionStats,
  contextUsage,
  taskStatus,
  taskStatusMessage,
  messages,
  onSessionStatsChange,
  onFileChangesChange,
  onContextUsageChange,
  onTaskStatusChange,
}: Options) {
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  useEffect(() => {
    handleAgentEventRef.current = (event) => {
      if (event.type === "agent_end" && soundEnabledRef.current) playDoneSoundRef.current();
    };
    return () => {
      handleAgentEventRef.current = null;
    };
  }, [handleAgentEventRef]);

  const statsKey = sessionStats
    ? `${sessionStats.tokens.input}|${sessionStats.tokens.output}|${sessionStats.tokens.cacheRead}|${sessionStats.tokens.cacheWrite}|${sessionStats.cost ?? 0}`
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [onSessionStatsChange, statsKey]);
  useEffect(() => () => onSessionStatsChange?.(null), [onSessionStatsChange]);

  const contextKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [contextKey, onContextUsageChange]);
  useEffect(() => () => onContextUsageChange?.(null), [onContextUsageChange]);

  const changes = useMemo(() => collectFileChanges(messages), [messages]);
  const changesRef = useRef(changes);
  changesRef.current = changes;
  // Only notify when the change set actually differs, not on every token update.
  const changesKey = useMemo(
    () => changes.map((change) => `${change.path}:${change.diff.length}:${change.isError ? 1 : 0}`).join("|"),
    [changes],
  );
  useEffect(() => {
    onFileChangesChange?.(changesRef.current);
  }, [changesKey, onFileChangesChange]);
  useEffect(() => () => onFileChangesChange?.([]), [onFileChangesChange]);

  useEffect(() => {
    onTaskStatusChange?.(taskStatus, taskStatusMessage);
  }, [onTaskStatusChange, taskStatus, taskStatusMessage]);
  useEffect(() => () => onTaskStatusChange?.("done", null), [onTaskStatusChange]);
}
