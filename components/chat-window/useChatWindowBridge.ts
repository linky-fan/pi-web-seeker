"use client";

import { useEffect, useRef, type RefObject } from "react";
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
  onSessionStatsChange?: (stats: SessionStats | null) => void;
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
  onSessionStatsChange,
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

  useEffect(() => {
    onTaskStatusChange?.(taskStatus, taskStatusMessage);
  }, [onTaskStatusChange, taskStatus, taskStatusMessage]);
  useEffect(() => () => onTaskStatusChange?.("done", null), [onTaskStatusChange]);
}
