import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentMessage, SessionInfo } from "@/lib/types";
import { sendAgentCommand } from "@/lib/agent-client";
import { apiPath } from "@/lib/api-path";
import {
  BUDDY_MODE_STORAGE_PREFIX,
  PLAN_EXECUTION_MODE_STORAGE_PREFIX,
  PLAN_MODE_STORAGE_PREFIX,
  SUBAGENTS_MODE_STORAGE_PREFIX,
} from "./helpers";
import type { AttachedImage, ThinkingLevelOption } from "./types";
import type { BuddyMode, ModelRef, PlanExecutionMode, PlanMode } from "@/lib/plan-mode";

interface CommandsOptions {
  identity: string;
  session: SessionInfo | null;
  newSessionCwd: string | null;
  isNew: boolean;
  sessionIdRef: React.MutableRefObject<string | null>;
  agentRunning: boolean;
  setAgentRunning: (running: boolean) => void;
  setAgentPhase: React.Dispatch<React.SetStateAction<import("./types").AgentPhase>>;
  dispatch: React.Dispatch<import("./types").StreamAction>;
  setMessages: React.Dispatch<React.SetStateAction<AgentMessage[]>>;
  setTaskError: (message: string | null) => void;
  isCompacting: boolean;
  setIsCompacting: (value: boolean) => void;
  setCompactError: (message: string | null) => void;
  loadSession: (sid: string, options?: { showLoading?: boolean; includeState?: boolean }) => Promise<unknown>;
  loadContext: (sid: string, leafId: string | null) => Promise<boolean>;
  setActiveLeafId: (leafId: string | null) => void;
  setPendingModel: (model: { provider: string; modelId: string } | null) => void;
  connectEvents: (sid: string, options?: { syncOnConnect?: boolean }) => void;
  newSessionModel: { provider: string; modelId: string } | null;
  thinkingLevel: ThinkingLevelOption;
  planMode: PlanMode;
  planExecutionMode: PlanExecutionMode;
  buddyMode: BuddyMode;
  buddyReviewerModel: ModelRef | null;
  subagentsEnabled: boolean;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  pendingScrollToUserRef: React.MutableRefObject<boolean>;
}

function persistMigratedMode(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* localStorage may be unavailable */ }
}

export function useCommandsController(options: CommandsOptions) {
  const {
    identity, session, newSessionCwd, isNew, sessionIdRef, agentRunning, setAgentRunning,
    setAgentPhase, dispatch, setMessages, setTaskError, isCompacting, setIsCompacting,
    setCompactError, loadSession, loadContext, setActiveLeafId, setPendingModel,
    connectEvents, newSessionModel, thinkingLevel, planMode, planExecutionMode,
    buddyMode, buddyReviewerModel, subagentsEnabled, onSessionCreated, onSessionForked, pendingScrollToUserRef,
  } = options;
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const operationRef = useRef({ send: 0, fork: 0, compact: 0, navigate: 0 });

  useEffect(() => {
    operationRef.current.send += 1;
    operationRef.current.fork += 1;
    operationRef.current.compact += 1;
    operationRef.current.navigate += 1;
    setForkingEntryId(null);
  }, [identity]);

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]): Promise<boolean> => {
    if ((!message.trim() && !images?.length) || agentRunning) return false;
    const operation = ++operationRef.current.send;
    const imageBlocks = images?.map((image) => ({ type: "image" as const, source: { type: "base64" as const, media_type: image.mimeType, data: image.data } }));
    const userMessage: AgentMessage = {
      role: "user",
      content: imageBlocks?.length ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks] : message,
      timestamp: Date.now(),
    };
    setMessages((current) => [...current, userMessage]);
    setAgentRunning(true);
    setAgentPhase({ kind: "waiting_model" });
    dispatch({ type: "start" });
    pendingScrollToUserRef.current = true;
    const commandImages = images?.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType }));
    try {
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        if (selectedModel) setPendingModel(selectedModel);
        const response = await fetch(apiPath("agent/new"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: newSessionCwd, type: "prompt", message, planMode: planMode === "plan", planExecutionMode,
            buddyMode, buddyReviewerModel, subagentsEnabled, ...(commandImages?.length ? { images: commandImages } : {}),
            ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
            ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
          }),
        });
        const result = await response.json() as { sessionId?: string; error?: string };
        if (!response.ok || result.error || !result.sessionId) throw new Error(result.error ?? `HTTP ${response.status}`);
        if (operation !== operationRef.current.send) return false;
        const realId = result.sessionId;
        sessionIdRef.current = realId;
        if (planMode === "plan") {
          persistMigratedMode(`${PLAN_MODE_STORAGE_PREFIX}:session:${realId}`, "plan");
          persistMigratedMode(`${PLAN_EXECUTION_MODE_STORAGE_PREFIX}:session:${realId}`, planExecutionMode === "subagent" ? "subagent" : null);
          persistMigratedMode(`${PLAN_MODE_STORAGE_PREFIX}:cwd:${newSessionCwd}`, null);
          persistMigratedMode(`${PLAN_EXECUTION_MODE_STORAGE_PREFIX}:cwd:${newSessionCwd}`, null);
        }
        if (buddyMode !== "off") {
          persistMigratedMode(`${BUDDY_MODE_STORAGE_PREFIX}:session:${realId}`, buddyMode);
          persistMigratedMode(`${BUDDY_MODE_STORAGE_PREFIX}:cwd:${newSessionCwd}`, null);
        }
        if (subagentsEnabled) {
          persistMigratedMode(`${SUBAGENTS_MODE_STORAGE_PREFIX}:session:${realId}`, "enabled");
          persistMigratedMode(`${SUBAGENTS_MODE_STORAGE_PREFIX}:cwd:${newSessionCwd}`, null);
        }
        connectEvents(realId, { syncOnConnect: false });
        onSessionCreated?.({
          id: realId, path: "", cwd: newSessionCwd, name: undefined,
          created: new Date().toISOString(), modified: new Date().toISOString(),
          messageCount: 1, firstMessage: message,
        });
      } else if (session) {
        const sid = session.id;
        connectEvents(sid, { syncOnConnect: false });
        await sendAgentCommand(sid, {
          type: "prompt", message, planMode: planMode === "plan", planExecutionMode,
          buddyMode, buddyReviewerModel, subagentsEnabled, ...(commandImages?.length ? { images: commandImages } : {}),
        });
      } else throw new Error("No active session");
      return operation === operationRef.current.send;
    } catch (caught) {
      if (operation !== operationRef.current.send) return false;
      console.error("Failed to send message:", caught);
      setMessages((current) => current[current.length - 1] === userMessage ? current.slice(0, -1) : current);
      setAgentRunning(false); setAgentPhase(null); dispatch({ type: "end" });
      setTaskError(caught instanceof Error ? caught.message : String(caught));
      return false;
    }
  }, [agentRunning, buddyMode, buddyReviewerModel, connectEvents, dispatch, isNew, newSessionCwd, newSessionModel, onSessionCreated, pendingScrollToUserRef, planExecutionMode, planMode, session, sessionIdRef, setAgentPhase, setAgentRunning, setMessages, setPendingModel, setTaskError, subagentsEnabled, thinkingLevel]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try { await sendAgentCommand(sid, { type: "abort" }); }
    catch (caught) { if (sid === sessionIdRef.current) console.error("Failed to abort:", caught); }
  }, [sessionIdRef]);

  const handleFork = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const operation = ++operationRef.current.fork;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, { type: "fork", entryId });
      if (operation === operationRef.current.fork && sid === sessionIdRef.current && !result?.cancelled && result?.newSessionId) onSessionForked?.(result.newSessionId);
    } catch (caught) {
      if (operation === operationRef.current.fork && sid === sessionIdRef.current) console.error("Fork failed:", caught);
    } finally {
      if (operation === operationRef.current.fork && sid === sessionIdRef.current) setForkingEntryId(null);
    }
  }, [onSessionForked, sessionIdRef]);

  const handleNavigate = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const operation = ++operationRef.current.navigate;
    setActiveLeafId(entryId);
    void sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
    await loadContext(sid, entryId);
    if (operation !== operationRef.current.navigate || sid !== sessionIdRef.current) return;
  }, [loadContext, sessionIdRef, setActiveLeafId]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    const sid = sessionIdRef.current;
    setActiveLeafId(leafId);
    if (!sid) return;
    const operation = ++operationRef.current.navigate;
    await loadContext(sid, leafId);
    if (operation === operationRef.current.navigate && sid === sessionIdRef.current && leafId) {
      void sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
    }
  }, [loadContext, sessionIdRef, setActiveLeafId]);

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || isCompacting) return;
    const operation = ++operationRef.current.compact;
    setIsCompacting(true); setCompactError(null); setTaskError(null);
    try {
      await sendAgentCommand(sid, { type: "compact" });
      if (operation === operationRef.current.compact && sid === sessionIdRef.current) await loadSession(sid, { showLoading: true });
    } catch (caught) {
      if (operation !== operationRef.current.compact || sid !== sessionIdRef.current) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      setCompactError(message); setTaskError(message);
    } finally {
      if (operation === operationRef.current.compact && sid === sessionIdRef.current) setIsCompacting(false);
    }
  }, [isCompacting, loadSession, sessionIdRef, setCompactError, setIsCompacting, setTaskError]);

  const sendQueued = useCallback(async (type: "steer" | "follow_up", message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setMessages((current) => [...current, { role: "user", content: message, timestamp: Date.now() } as AgentMessage]);
    const commandImages = images?.map((image) => ({ type: "image" as const, data: image.data, mimeType: image.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type, message, ...(type === "steer" ? { interrupt: true } : {}),
        planMode: planMode === "plan", planExecutionMode, buddyMode, buddyReviewerModel, subagentsEnabled,
        ...(commandImages?.length ? { images: commandImages } : {}),
      });
    } catch (caught) { if (sid === sessionIdRef.current) console.error(`Failed to ${type}:`, caught); }
  }, [buddyMode, buddyReviewerModel, planExecutionMode, planMode, sessionIdRef, setMessages, subagentsEnabled]);

  const handleSteer = useCallback((message: string, images?: AttachedImage[]) => sendQueued("steer", message, images), [sendQueued]);
  const handleFollowUp = useCallback((message: string, images?: AttachedImage[]) => sendQueued("follow_up", message, images), [sendQueued]);
  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try { await sendAgentCommand(sid, { type: "abort_compaction" }); }
    catch (caught) { if (sid === sessionIdRef.current) console.error("Failed to abort compaction:", caught); }
  }, [sessionIdRef]);

  return {
    forkingEntryId, setForkingEntryId, handleSend, handleAbort, handleFork, handleNavigate,
    handleLeafChange, handleCompact, handleSteer, handleFollowUp, handleAbortCompaction,
  };
}
