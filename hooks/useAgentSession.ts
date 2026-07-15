"use client";

import { useState, useCallback, useRef, useEffect, useReducer, useMemo } from "react";
import type { AgentMessage, ExtensionUiRequest, ExtensionUiResponse, SessionInfo, SessionTreeNode, TextContent, ToolExecutionStatus } from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { getSubagentMessageKey } from "@/lib/subagents";
import { sendAgentCommand } from "@/lib/agent-client";
import { apiPath } from "@/lib/api-path";
import type { BuddyMode, ModelRef, PlanExecutionMode, PlanMode, PlanModeStatus } from "@/lib/plan-mode";

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "end" }
  | { type: "reset" };

function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start":
      return { isStreaming: true, streamingMessage: null };
    case "update":
      return { isStreaming: true, streamingMessage: action.message };
    case "end":
    case "reset":
      return { isStreaming: false, streamingMessage: null };
    default:
      return state;
  }
}

interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type LiveAgentState = {
  isStreaming?: boolean;
  isCompacting?: boolean;
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  planMode?: boolean;
  planExecutionMode?: PlanExecutionMode;
  planModeStatus?: PlanModeStatus;
  buddyMode?: BuddyMode;
  buddyReviewerModel?: ModelRef | null;
};

type AgentStateResponse = { running: boolean; state?: LiveAgentState };

type ExtensionUiDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type ExtensionUiCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

export type NoticeType = "info" | "success" | "warning" | "error";

export type NoticeItem = {
  id: string;
  message: string;
  type: NoticeType;
};

type NoticeState = {
  visible: NoticeItem[];
};

type NoticeAction =
  | { type: "add"; notice: NoticeItem }
  | { type: "dismiss"; id: string };

function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case "add":
      return { visible: [...state.visible.filter((item) => item.id !== action.notice.id), action.notice].slice(-4) };
    case "dismiss":
      return { visible: state.visible.filter((item) => item.id !== action.id) };
    default:
      return state;
  }
}

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 140;
const PLAN_MODE_STORAGE_PREFIX = "pi-web.planMode";
const PLAN_EXECUTION_MODE_STORAGE_PREFIX = "pi-web.planExecutionMode";
const BUDDY_MODE_STORAGE_PREFIX = "pi-web.buddyMode";
const BUDDY_REVIEWER_STORAGE_PREFIX = "pi-web.buddyReviewer";

function userMessageKey(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") return `text:${message.content.trim()}`;
  return message.content
    .map((block) => {
      if (block.type === "text") return `text:${block.text.trim()}`;
      const data = block.source.data ?? "";
      const url = block.source.url ?? "";
      return `image:${block.source.media_type ?? ""}:${data.length}:${data.slice(0, 64)}:${url}`;
    })
    .join("\n");
}

function userMessagesMatch(a: AgentMessage, b: AgentMessage): boolean {
  if (a.role !== "user" || b.role !== "user") return false;
  return userMessageKey(a) === userMessageKey(b);
}

function appendCompletedMessage(messages: AgentMessage[], message: AgentMessage): AgentMessage[] {
  if (message.role === "user") {
    const last = messages[messages.length - 1];
    return last && userMessagesMatch(last, message) ? messages : [...messages, message];
  }
  if (message.role !== "custom") return [...messages, message];
  const key = getSubagentMessageKey(message);
  if (!key) return [...messages, message];
  return messages.some((existing) => existing.role === "custom" && getSubagentMessageKey(existing) === key)
    ? messages
    : [...messages, message];
}

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

function textFromToolPartial(partial: unknown): string {
  const content = (partial as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is TextContent => Boolean(block) && (block as { type?: unknown }).type === "text")
    .map((block) => block.text)
    .join("\n");
}

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  setNewSessionModel?: (model: { provider: string; modelId: string } | null) => void;
}

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (content: string) => void;
  addImages: (files: File[]) => void;
}

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

export function useAgentSession(opts: UseAgentSessionOptions) {
  const {
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange,
  } = opts;

  const isNew = session === null && newSessionCwd !== null;

  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<{ id: string; name: string; provider: string }[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModelState] = useState<{ provider: string; modelId: string } | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [forkingEntryId, setForkingEntryId] = useState<string | null>(null);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [toolExecutionStatuses, setToolExecutionStatuses] = useState<Map<string, ToolExecutionStatus>>(new Map());
  const [planMode, setPlanMode] = useState<PlanMode>("normal");
  const [planExecutionMode, setPlanExecutionMode] = useState<PlanExecutionMode>("main");
  const [planModeStatus, setPlanModeStatus] = useState<PlanModeStatus | null>(null);
  const [buddyMode, setBuddyMode] = useState<BuddyMode>("off");
  const [buddyReviewerModel, setBuddyReviewerModel] = useState<ModelRef | null>(null);
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [] });
  const [extensionDialog, setExtensionDialog] = useState<ExtensionUiDialogRequest | null>(null);
  const [extensionCustomUi, setExtensionCustomUi] = useState<ExtensionUiCustomRequest | null>(null);
  const [extensionStatuses, setExtensionStatuses] = useState<Array<{ key: string; text: string }>>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<Array<{ key: string; lines: string[]; placement?: "aboveEditor" | "belowEditor" }>>([]);

  const eventSourceRef = useRef<EventSource | null>(null);
  const messagesRef = useRef<AgentMessage[]>([]);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const agentRunningRef = useRef(false);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);
  const initialScrollDoneRef = useRef(false);
  const lastUserMsgRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToUserRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowOutputRef = useRef(true);

  const setNewSessionModel = opts.setNewSessionModel ?? setNewSessionModelState;
  messagesRef.current = messages;

  const currentModel = currentModelOverride ?? data?.context.model ?? pendingModel ?? null;
  const displayModel = isNew ? newSessionModel : currentModel;
  const planModeStorageKey = session?.id
    ? `${PLAN_MODE_STORAGE_PREFIX}:session:${session.id}`
    : newSessionCwd
      ? `${PLAN_MODE_STORAGE_PREFIX}:cwd:${newSessionCwd}`
      : null;
  const planExecutionModeStorageKey = session?.id
    ? `${PLAN_EXECUTION_MODE_STORAGE_PREFIX}:session:${session.id}`
    : newSessionCwd
      ? `${PLAN_EXECUTION_MODE_STORAGE_PREFIX}:cwd:${newSessionCwd}`
      : null;
  const buddyModeStorageKey = session?.id
    ? `${BUDDY_MODE_STORAGE_PREFIX}:session:${session.id}`
    : newSessionCwd
      ? `${BUDDY_MODE_STORAGE_PREFIX}:cwd:${newSessionCwd}`
      : null;
  const buddyReviewerStorageKey = newSessionCwd || session?.cwd
    ? `${BUDDY_REVIEWER_STORAGE_PREFIX}:cwd:${newSessionCwd ?? session?.cwd}`
    : BUDDY_REVIEWER_STORAGE_PREFIX;

  const sessionStats = useMemo(() => {
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    let cost = 0;
    for (const msg of messages) {
      if (msg.role !== "assistant") continue;
      const u = (msg as import("@/lib/types").AssistantMessage).usage;
      if (!u) continue;
      tokens.input += u.input ?? 0;
      tokens.output += u.output ?? 0;
      tokens.cacheRead += u.cacheRead ?? 0;
      tokens.cacheWrite += u.cacheWrite ?? 0;
      cost += u.cost?.total ?? 0;
    }
    const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
    return total > 0 ? { tokens, cost } : null;
  }, [messages]);

  const applyAgentState = useCallback((agentState: AgentStateResponse | null | undefined) => {
    if (!agentState) return;

    const isActivelyStreaming = Boolean(agentState.running && agentState.state?.isStreaming);
    setAgentRunning(isActivelyStreaming);
    agentRunningRef.current = isActivelyStreaming;
    if (!isActivelyStreaming) {
      setAgentPhase(null);
      dispatch({ type: "reset" });
    } else {
      setAgentPhase((current) => current ?? { kind: "waiting_model" });
      dispatch({ type: "start" });
    }

    if (!agentState.state) return;
    if (agentState.state.isCompacting !== undefined) setIsCompacting(agentState.state.isCompacting);
    if (agentState.state.contextUsage !== undefined) setContextUsage(agentState.state.contextUsage ?? null);
    if (agentState.state.systemPrompt !== undefined) setSystemPrompt(agentState.state.systemPrompt ?? null);
    if (agentState.state.thinkingLevel !== undefined) setThinkingLevel((agentState.state.thinkingLevel as ThinkingLevelOption) ?? "auto");
    if (agentState.state.planMode !== undefined) setPlanMode(agentState.state.planMode ? "plan" : "normal");
    if (agentState.state.planExecutionMode === "main" || agentState.state.planExecutionMode === "subagent") {
      setPlanExecutionMode(agentState.state.planExecutionMode);
    }
    if (agentState.state.planModeStatus !== undefined) setPlanModeStatus(agentState.state.planModeStatus ?? null);
    if (agentState.state.buddyMode) setBuddyMode(agentState.state.buddyMode);
    if (agentState.state.buddyReviewerModel !== undefined) setBuddyReviewerModel(agentState.state.buddyReviewerModel ?? null);
  }, []);

  useEffect(() => {
    if (!planModeStorageKey) {
      setPlanMode("normal");
      return;
    }
    try {
      setPlanMode(window.localStorage.getItem(planModeStorageKey) === "plan" ? "plan" : "normal");
    } catch {
      setPlanMode("normal");
    }
  }, [planModeStorageKey]);

  useEffect(() => {
    if (!planExecutionModeStorageKey) {
      setPlanExecutionMode("main");
      return;
    }
    try {
      setPlanExecutionMode(window.localStorage.getItem(planExecutionModeStorageKey) === "subagent" ? "subagent" : "main");
    } catch {
      setPlanExecutionMode("main");
    }
  }, [planExecutionModeStorageKey]);

  useEffect(() => {
    if (!buddyModeStorageKey) {
      setBuddyMode("off");
      return;
    }
    try {
      const saved = window.localStorage.getItem(buddyModeStorageKey);
      setBuddyMode(saved === "plan" || saved === "code" ? saved : "off");
    } catch {
      setBuddyMode("off");
    }
  }, [buddyModeStorageKey]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(buddyReviewerStorageKey);
      if (!saved) {
        setBuddyReviewerModel(null);
        return;
      }
      const parsed = JSON.parse(saved) as Partial<ModelRef>;
      setBuddyReviewerModel(typeof parsed.provider === "string" && typeof parsed.modelId === "string"
        ? { provider: parsed.provider, modelId: parsed.modelId }
        : null);
    } catch {
      setBuddyReviewerModel(null);
    }
  }, [buddyReviewerStorageKey]);

  const persistPlanMode = useCallback((key: string | null, mode: PlanMode) => {
    if (!key) return;
    try {
      if (mode === "plan") window.localStorage.setItem(key, "plan");
      else window.localStorage.removeItem(key);
    } catch {
      // localStorage may be unavailable in restricted contexts
    }
  }, []);

  const persistPlanExecutionMode = useCallback((key: string | null, mode: PlanExecutionMode) => {
    if (!key) return;
    try {
      if (mode === "subagent") window.localStorage.setItem(key, "subagent");
      else window.localStorage.removeItem(key);
    } catch {
      // localStorage may be unavailable in restricted contexts
    }
  }, []);

  const persistBuddyMode = useCallback((key: string | null, mode: BuddyMode) => {
    if (!key) return;
    try {
      if (mode === "off") window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, mode);
    } catch { /* localStorage may be unavailable */ }
  }, []);

  const persistBuddyReviewer = useCallback((model: ModelRef | null) => {
    try {
      if (model) window.localStorage.setItem(buddyReviewerStorageKey, JSON.stringify(model));
      else window.localStorage.removeItem(buddyReviewerStorageKey);
    } catch { /* localStorage may be unavailable */ }
  }, [buddyReviewerStorageKey]);

  const handlePlanModeChange = useCallback(async (mode: PlanMode, executionMode: PlanExecutionMode = "main"): Promise<boolean> => {
    if (agentRunningRef.current) return false;
    const previousMode = planMode;
    const previousExecutionMode = planExecutionMode;
    setPlanMode(mode);
    setPlanExecutionMode(mode === "plan" ? executionMode : "main");
    setBuddyMode("off");
    persistPlanMode(planModeStorageKey, mode);
    persistPlanExecutionMode(planExecutionModeStorageKey, mode === "plan" ? executionMode : "main");
    persistBuddyMode(buddyModeStorageKey, "off");
    const sid = sessionIdRef.current;
    if (!sid || isNew) return true;
    try {
      const result = await sendAgentCommand<{ planMode?: boolean; planExecutionMode?: PlanExecutionMode; planModeStatus?: PlanModeStatus }>(sid, {
        type: "set_plan_mode",
        enabled: mode === "plan",
        executionMode,
        buddyMode: "off",
      });
      if (result?.planExecutionMode) setPlanExecutionMode(result.planExecutionMode);
      if (result?.planModeStatus) setPlanModeStatus(result.planModeStatus);
      return true;
    } catch (e) {
      console.error("Failed to set plan mode:", e);
      setPlanMode(previousMode);
      setPlanExecutionMode(previousExecutionMode);
      setBuddyMode(buddyMode);
      persistPlanMode(planModeStorageKey, previousMode);
      persistPlanExecutionMode(planExecutionModeStorageKey, previousExecutionMode);
      persistBuddyMode(buddyModeStorageKey, buddyMode);
      return false;
    }
  }, [buddyMode, buddyModeStorageKey, isNew, persistBuddyMode, persistPlanExecutionMode, persistPlanMode, planExecutionMode, planExecutionModeStorageKey, planMode, planModeStorageKey]);

  const handleBuddyModeChange = useCallback(async (nextBuddyMode: BuddyMode): Promise<boolean> => {
    if (agentRunningRef.current) return false;
    if (nextBuddyMode !== "off") {
      if (!buddyReviewerModel || !displayModel) return false;
      if (buddyReviewerModel.provider === displayModel.provider && buddyReviewerModel.modelId === displayModel.modelId) return false;
      if (planModeStatus && !planModeStatus.subagentsAvailable) return false;
    }
    const previous = { buddyMode, planMode, planExecutionMode };
    const nextPlanMode: PlanMode = nextBuddyMode === "plan" ? "plan" : nextBuddyMode === "code" ? "normal" : planMode;
    const nextExecutionMode: PlanExecutionMode = nextBuddyMode === "plan" ? "main" : planExecutionMode;
    setBuddyMode(nextBuddyMode);
    setPlanMode(nextPlanMode);
    setPlanExecutionMode(nextExecutionMode);
    persistBuddyMode(buddyModeStorageKey, nextBuddyMode);
    persistPlanMode(planModeStorageKey, nextPlanMode);
    persistPlanExecutionMode(planExecutionModeStorageKey, nextExecutionMode);
    const sid = sessionIdRef.current;
    if (!sid || isNew) return true;
    try {
      const result = await sendAgentCommand<LiveAgentState>(sid, {
        type: "set_plan_mode",
        enabled: nextPlanMode === "plan",
        executionMode: nextExecutionMode,
        buddyMode: nextBuddyMode,
        buddyReviewerModel,
      });
      if (result.buddyMode) setBuddyMode(result.buddyMode);
      return true;
    } catch (e) {
      console.error("Failed to set buddy mode:", e);
      setBuddyMode(previous.buddyMode);
      setPlanMode(previous.planMode);
      setPlanExecutionMode(previous.planExecutionMode);
      persistBuddyMode(buddyModeStorageKey, previous.buddyMode);
      persistPlanMode(planModeStorageKey, previous.planMode);
      persistPlanExecutionMode(planExecutionModeStorageKey, previous.planExecutionMode);
      return false;
    }
  }, [buddyMode, buddyModeStorageKey, buddyReviewerModel, displayModel, isNew, persistBuddyMode, persistPlanExecutionMode, persistPlanMode, planExecutionMode, planExecutionModeStorageKey, planMode, planModeStatus, planModeStorageKey]);

  const handleBuddyReviewerChange = useCallback(async (provider: string, modelId: string): Promise<boolean> => {
    const next = { provider, modelId };
    if (displayModel?.provider === provider && displayModel.modelId === modelId) return false;
    const previous = buddyReviewerModel;
    setBuddyReviewerModel(next);
    persistBuddyReviewer(next);
    const sid = sessionIdRef.current;
    if (!sid || isNew) return true;
    try {
      await sendAgentCommand(sid, { type: "set_buddy_reviewer", buddyReviewerModel: next });
      return true;
    } catch (e) {
      console.error("Failed to set buddy reviewer:", e);
      setBuddyReviewerModel(previous);
      persistBuddyReviewer(previous);
      return false;
    }
  }, [buddyReviewerModel, displayModel, isNew, persistBuddyReviewer]);

  const loadSession = useCallback(async (sid: string, showLoading = false, includeState = false) => {
    try {
      if (showLoading) setLoading(true);
      const url = includeState
        ? apiPath(`sessions/${encodeURIComponent(sid)}?includeState`)
        : apiPath(`sessions/${encodeURIComponent(sid)}`);
      const res = await fetch(url);
      if (res.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setError(null);
        }
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as SessionData & { agentState?: AgentStateResponse };
      setData(d);
      setActiveLeafId(d.leafId);
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
      setCurrentModelOverride(null);
      setError(null);
      if (includeState) applyAgentState(d.agentState);
      // If no live agent state, fall back to thinking level from session file
      if (!d.agentState?.state?.thinkingLevel && d.context.thinkingLevel && d.context.thinkingLevel !== "off") {
        setThinkingLevel(d.context.thinkingLevel as ThinkingLevelOption);
      }
      return d.agentState ?? null;
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [applyAgentState]);

  const loadContext = useCallback(async (sid: string, leafId: string | null) => {
    try {
      const url = leafId
        ? apiPath(`sessions/${encodeURIComponent(sid)}/context?leafId=${encodeURIComponent(leafId)}`)
        : apiPath(`sessions/${encodeURIComponent(sid)}/context`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json() as { context: { messages: AgentMessage[]; entryIds: string[] } };
      setMessages(d.context.messages);
      setEntryIds(d.context.entryIds ?? []);
    } catch (e) {
      console.error("Failed to load context:", e);
    }
  }, []);

  const syncLiveSession = useCallback(async (sid: string) => {
    await loadSession(sid, false, true);
  }, [loadSession]);

  const connectEvents = useCallback((sid: string, options: { syncOnConnect?: boolean } = {}) => {
    const { syncOnConnect = true } = options;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    const es = new EventSource(apiPath(`agent/${encodeURIComponent(sid)}/events`));
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AgentEvent;
        handleAgentEventRef.current?.(event);
        if (event.type === "connected" && syncOnConnect) {
          syncLiveSession(sid).catch((error) => console.error("Failed to sync live session:", error));
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      if (eventSourceRef.current === es && agentRunningRef.current) {
        es.close();
        eventSourceRef.current = null;
        setTimeout(() => {
          if (agentRunningRef.current) connectEvents(sid, { syncOnConnect: true });
        }, 1000);
      }
    };
  }, [syncLiveSession]);

  useEffect(() => {
    agentRunningRef.current = agentRunning;
  }, [agentRunning]);

  const addNotice = useCallback((notice: { id?: string; message: string; type?: NoticeType }) => {
    const message = notice.message.trim();
    if (!message) return;
    const id = notice.id ?? `notice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dispatchNotice({ type: "add", notice: { id, message, type: notice.type ?? "info" } });
    window.setTimeout(() => dispatchNotice({ type: "dismiss", id }), 6000);
  }, []);

  const respondToExtensionUi = useCallback(async (request: ExtensionUiDialogRequest, response: Omit<ExtensionUiResponse, "type" | "id">) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setExtensionDialog((current) => current?.id === request.id ? null : current);
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_response",
        id: request.id,
        ...response,
      });
    } catch (e) {
      console.error("Failed to send extension UI response:", e);
    }
  }, []);

  const sendExtensionCustomInput = useCallback(async (request: ExtensionUiCustomRequest, data: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, {
        type: "extension_ui_input",
        id: request.id,
        data,
      });
    } catch (e) {
      console.error("Failed to send extension custom UI input:", e);
    }
  }, []);

  const handleExtensionUiRequest = useCallback((request: ExtensionUiRequest) => {
    switch (request.method) {
      case "select":
      case "confirm":
      case "input":
      case "editor":
        setExtensionDialog(request);
        break;
      case "notify":
        addNotice({ id: request.id, type: request.notifyType ?? "info", message: request.message });
        break;
      case "setStatus":
        setExtensionStatuses((current) => {
          const rest = current.filter((item) => item.key !== request.statusKey);
          return request.statusText ? [...rest, { key: request.statusKey, text: request.statusText }] : rest;
        });
        break;
      case "setWidget":
        setExtensionWidgets((current) => {
          const rest = current.filter((item) => item.key !== request.widgetKey);
          return request.widgetLines?.length
            ? [...rest, { key: request.widgetKey, lines: request.widgetLines, placement: request.placement }]
            : rest;
        });
        break;
      case "setTitle":
        if (request.title) document.title = request.title;
        break;
      case "set_editor_text":
        opts.chatInputRef?.current?.insertText(request.text);
        break;
      case "custom":
        setExtensionCustomUi((current) => {
          if (request.closed) return current?.id === request.id ? null : current;
          return request;
        });
        break;
    }
  }, [addNotice, opts.chatInputRef]);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "extension_ui_request":
        handleExtensionUiRequest(event as ExtensionUiRequest);
        break;
      case "extension_error":
        addNotice({
          type: "error",
          message: (event.error as string | undefined) ?? "Extension command failed",
        });
        break;
      case "agent_start":
        setTaskError(null);
        setAgentRunning(true);
        setAgentPhase({ kind: "waiting_model" });
        setToolExecutionStatuses(new Map());
        dispatch({ type: "start" });
        break;
      case "agent_end":
        setAgentRunning(false);
        setAgentPhase(null);
        setToolExecutionStatuses(new Map());
        setRetryInfo(null);
        dispatch({ type: "end" });
        if (sessionIdRef.current) {
          loadSession(sessionIdRef.current);
          fetch(apiPath(`agent/${encodeURIComponent(sessionIdRef.current)}`))
            .then((r) => r.json())
            .then((d: { state?: { contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null; systemPrompt?: string } }) => {
              if (d.state?.contextUsage !== undefined) setContextUsage(d.state.contextUsage ?? null);
              if (d.state?.systemPrompt !== undefined) setSystemPrompt(d.state.systemPrompt ?? null);
            })
            .catch(() => {});
        }
        onAgentEnd?.();
        break;
      case "message_start":
      case "message_update": {
        const msg = event.message as Partial<AgentMessage> | undefined;
        if (msg) {
          const normalized = normalizeToolCalls(msg as AgentMessage);
          const last = messagesRef.current[messagesRef.current.length - 1];
          if (!(normalized.role === "user" && last && userMessagesMatch(last, normalized))) {
            dispatch({ type: "update", message: normalized });
          }
        }
        setAgentPhase(null);
        break;
      }
      case "message_end": {
        const completed = event.message as AgentMessage | undefined;
        if (completed) {
          if (completed.role === "assistant" && completed.stopReason === "error") {
            setTaskError(completed.errorMessage ?? "Agent task failed");
          }
          setMessages((prev) => appendCompletedMessage(prev, normalizeToolCalls(completed)));
        }
        dispatch({ type: "reset" });
        setAgentPhase({ kind: "waiting_model" });
        break;
      }
      case "tool_execution_start": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        const now = Date.now();
        setToolExecutionStatuses((prev) => {
          const existing = prev.get(id);
          const next = new Map(prev);
          next.set(id, {
            id,
            name,
            startedAt: existing?.startedAt ?? now,
            updatedAt: now,
            outputText: existing?.outputText ?? "",
          });
          return next;
        });
        setAgentPhase((prev) => {
          const tools = prev?.kind === "running_tools" ? [...prev.tools] : [];
          if (!tools.some((t) => t.id === id)) tools.push({ id, name });
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "tool_execution_update": {
        const id = event.toolCallId as string;
        const name = event.toolName as string;
        const outputText = textFromToolPartial(event.partialResult);
        const now = Date.now();
        setToolExecutionStatuses((prev) => {
          const existing = prev.get(id);
          const next = new Map(prev);
          next.set(id, {
            id,
            name: name || existing?.name || "tool",
            startedAt: existing?.startedAt ?? now,
            updatedAt: now,
            outputText: outputText || existing?.outputText || "",
          });
          return next;
        });
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        setToolExecutionStatuses((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        setAgentPhase((prev) => {
          if (prev?.kind !== "running_tools") return prev;
          const tools = prev.tools.filter((t) => t.id !== id);
          if (tools.length === 0) return { kind: "waiting_model" };
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "auto_retry_start":
        setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined });
        break;
      case "auto_retry_end":
        setRetryInfo(null);
        break;
      case "auto_compaction_start":
      case "compaction_start":
        setIsCompacting(true);
        setCompactError(null);
        break;
      case "auto_compaction_end":
      case "compaction_end":
        setIsCompacting(false);
        if (event.errorMessage) {
          setCompactError(event.errorMessage as string);
        } else if (!event.aborted) {
          if (sessionIdRef.current) loadSession(sessionIdRef.current);
        }
        break;
    }
  }, [addNotice, handleExtensionUiRequest, loadSession, onAgentEnd]);
  handleAgentEventRef.current = handleAgentEvent;

  const handleSend = useCallback(async (message: string, images?: AttachedImage[]): Promise<boolean> => {
    if (!message.trim() && !images?.length) return false;
    if (agentRunning) return false;

    const imageBlocks = images?.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mimeType, data: img.data } }));
    const userMsg: AgentMessage = {
      role: "user",
      content: imageBlocks?.length
        ? [...(message.trim() ? [{ type: "text" as const, text: message }] : []), ...imageBlocks]
        : message,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setAgentRunning(true);
    setAgentPhase({ kind: "waiting_model" });
    dispatch({ type: "start" });
    pendingScrollToUserRef.current = true;

    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));

    try {
      if (isNew && newSessionCwd) {
        const selectedModel = newSessionModel;
        if (selectedModel) setPendingModel(selectedModel);
        const res = await fetch(apiPath("agent/new"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cwd: newSessionCwd,
            type: "prompt",
            message,
            planMode: planMode === "plan",
            planExecutionMode,
            buddyMode,
            buddyReviewerModel,
            ...(piImages?.length ? { images: piImages } : {}),
            ...(selectedModel ? { provider: selectedModel.provider, modelId: selectedModel.modelId } : {}),
            ...(thinkingLevel !== "auto" ? { thinkingLevel } : {}),
          }),
        });
        const result = await res.json() as { sessionId?: string; error?: string };
        if (!res.ok || result.error || !result.sessionId) throw new Error(result.error ?? `HTTP ${res.status}`);
        const realId = result.sessionId;
        sessionIdRef.current = realId;
        if (planMode === "plan" && newSessionCwd) {
          persistPlanMode(`${PLAN_MODE_STORAGE_PREFIX}:session:${realId}`, "plan");
          persistPlanExecutionMode(`${PLAN_EXECUTION_MODE_STORAGE_PREFIX}:session:${realId}`, planExecutionMode);
          persistPlanMode(`${PLAN_MODE_STORAGE_PREFIX}:cwd:${newSessionCwd}`, "normal");
          persistPlanExecutionMode(`${PLAN_EXECUTION_MODE_STORAGE_PREFIX}:cwd:${newSessionCwd}`, "main");
        }
        if (buddyMode !== "off" && newSessionCwd) {
          persistBuddyMode(`${BUDDY_MODE_STORAGE_PREFIX}:session:${realId}`, buddyMode);
          persistBuddyMode(`${BUDDY_MODE_STORAGE_PREFIX}:cwd:${newSessionCwd}`, "off");
        }
        connectEvents(realId, { syncOnConnect: false });
        onSessionCreated?.({
          id: realId,
          path: "",
          cwd: newSessionCwd,
          name: undefined,
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          messageCount: 1,
          firstMessage: message,
        });
      } else if (session) {
        connectEvents(session.id, { syncOnConnect: false });
        await sendAgentCommand(session.id, {
          type: "prompt",
          message,
          planMode: planMode === "plan",
          planExecutionMode,
          buddyMode,
          buddyReviewerModel,
          ...(piImages?.length ? { images: piImages } : {}),
        });
      } else {
        throw new Error("No active session");
      }
      return true;
    } catch (e) {
      console.error("Failed to send message:", e);
        setMessages((prev) => prev[prev.length - 1] === userMsg ? prev.slice(0, -1) : prev);
        setAgentRunning(false);
        setAgentPhase(null);
        setTaskError(e instanceof Error ? e.message : String(e));
        dispatch({ type: "end" });
        return false;
      }
  }, [buddyMode, buddyReviewerModel, isNew, newSessionCwd, newSessionModel, thinkingLevel, session, agentRunning, connectEvents, onSessionCreated, persistBuddyMode, persistPlanExecutionMode, persistPlanMode, planExecutionMode, planMode]);

  const handleAbort = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort" });
    } catch (e) {
      console.error("Failed to abort:", e);
    }
  }, []);

  const handleFork = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setForkingEntryId(entryId);
    try {
      const result = await sendAgentCommand<{ cancelled?: boolean; newSessionId?: string }>(sid, {
        type: "fork",
        entryId,
      });
      const { cancelled, newSessionId } = result ?? {};
      if (!cancelled && newSessionId) {
        onSessionForked?.(newSessionId);
      }
    } catch (e) {
      console.error("Fork failed:", e);
    } finally {
      setForkingEntryId(null);
    }
  }, [onSessionForked]);

  const handleNavigate = useCallback(async (entryId: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    sendAgentCommand(sid, { type: "navigate_tree", targetId: entryId }).catch(() => {});
    setActiveLeafId(entryId);
    await loadContext(sid, entryId);
  }, [loadContext]);

  const handleLeafChange = useCallback(async (leafId: string | null) => {
    setActiveLeafId(leafId);
    const sid = sessionIdRef.current;
    if (!sid) return;
    await loadContext(sid, leafId);
    if (leafId) {
      sendAgentCommand(sid, { type: "navigate_tree", targetId: leafId }).catch(() => {});
    }
  }, [loadContext]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (buddyMode !== "off" && buddyReviewerModel?.provider === provider && buddyReviewerModel.modelId === modelId) {
      setTaskError("Buddy writer and reviewer models must be different");
      return;
    }
    if (isNew) {
      setNewSessionModel({ provider, modelId });
      return;
    }
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      setCurrentModelOverride({ provider, modelId });
    } catch (e) {
      console.error("Failed to set model:", e);
    }
  }, [buddyMode, buddyReviewerModel, isNew, setNewSessionModel]);

  const handleCompact = useCallback(async () => {
    const sid = sessionIdRef.current;
      if (!sid || isCompacting) return;
      setIsCompacting(true);
      setCompactError(null);
      setTaskError(null);
      try {
        await sendAgentCommand(sid, { type: "compact" });
        await loadSession(sid, true);
      } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setCompactError(message);
      setTaskError(message);
      } finally {
        setIsCompacting(false);
      }
  }, [isCompacting, loadSession]);

  const handleSteer = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setMessages((prev) => [...prev, { role: "user", content: message, timestamp: Date.now() } as AgentMessage]);
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "steer",
        message,
        interrupt: true,
        planMode: planMode === "plan",
        planExecutionMode,
        buddyMode,
        buddyReviewerModel,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to steer:", e);
    }
  }, [buddyMode, buddyReviewerModel, planExecutionMode, planMode]);

  const handleFollowUp = useCallback(async (message: string, images?: AttachedImage[]) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setMessages((prev) => [...prev, { role: "user", content: message, timestamp: Date.now() } as AgentMessage]);
    const piImages = images?.map((img) => ({ type: "image" as const, data: img.data, mimeType: img.mimeType }));
    try {
      await sendAgentCommand(sid, {
        type: "follow_up",
        message,
        planMode: planMode === "plan",
        planExecutionMode,
        buddyMode,
        buddyReviewerModel,
        ...(piImages?.length ? { images: piImages } : {}),
      });
    } catch (e) {
      console.error("Failed to follow up:", e);
    }
  }, [buddyMode, buddyReviewerModel, planExecutionMode, planMode]);

  const handleAbortCompaction = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "abort_compaction" });
    } catch (e) {
      console.error("Failed to abort compaction:", e);
    }
  }, []);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level);
    if (level === "auto") return; // "auto" leaves pi's current setting untouched
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (e) {
      console.error("Failed to set thinking level:", e);
    }
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
    });
  }, []);

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return true;
    const anchor = messagesEndRef.current;
    if (anchor) {
      const anchorRect = anchor.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      return anchorRect.bottom - containerRect.bottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
    }
    return container.scrollHeight - container.scrollTop - container.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollUserMsgToTop = useCallback(() => {
    const container = scrollContainerRef.current;
    const el = lastUserMsgRef.current;
    if (!container || !el) return;
    const elAbsTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    container.scrollTo({ top: elAbsTop - 16, behavior: "smooth" });
  }, []);

  // Load session on mount
  useEffect(() => {
    if (session) {
      sessionIdRef.current = session.id;
      loadSession(session.id, true, true).then((agentState) => {
        if (agentState?.running) {
          if (agentState.state?.isStreaming) {
            connectEvents(session.id);
          }
        }
      });
    }
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    onSystemPromptChange?.(systemPrompt);
  }, [systemPrompt, onSystemPromptChange]);

  useEffect(() => {
    if (!onBranchDataChange) return;
    onBranchDataChange(data?.tree ?? [], activeLeafId, handleLeafChange);
  }, [data?.tree, activeLeafId, handleLeafChange, onBranchDataChange]);

  useEffect(() => {
    if (messages.length > 0) {
      if (pendingScrollToUserRef.current) {
        pendingScrollToUserRef.current = false;
        initialScrollDoneRef.current = true;
        shouldFollowOutputRef.current = true;
        scrollUserMsgToTop();
      } else if (!initialScrollDoneRef.current) {
        initialScrollDoneRef.current = true;
        shouldFollowOutputRef.current = true;
        scrollToBottom("instant");
      } else if (!agentRunningRef.current) {
        shouldFollowOutputRef.current = true;
        scrollToBottom("smooth");
      }
    }
  }, [messages.length, agentRunning, scrollToBottom, scrollUserMsgToTop]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const updateShouldFollow = () => {
      shouldFollowOutputRef.current = isNearBottom();
    };
    updateShouldFollow();
    container.addEventListener("scroll", updateShouldFollow, { passive: true });
    return () => container.removeEventListener("scroll", updateShouldFollow);
  }, [isNearBottom]);

  useEffect(() => {
    if (!streamState.isStreaming || !streamState.streamingMessage) return;
    if (!shouldFollowOutputRef.current) return;
    scrollToBottom("auto");
  }, [streamState.isStreaming, streamState.streamingMessage, scrollToBottom]);

  // Load model list
  useEffect(() => {
    fetch(apiPath("models")).then((r) => r.json()).then((d: { models: Record<string, string>; modelList?: { id: string; name: string; provider: string }[]; defaultModel?: { provider: string; modelId: string } | null; thinkingLevels?: Record<string, string[]>; thinkingLevelMaps?: Record<string, Record<string, string | null>> }) => {
      setModelNames(d.models);
      if (d.thinkingLevels) setModelThinkingLevels(d.thinkingLevels);
      if (d.thinkingLevelMaps) setModelThinkingLevelMaps(d.thinkingLevelMaps);
      if (d.modelList) {
        setModelList(d.modelList);
        setBuddyReviewerModel((current) => {
          if (current && d.modelList?.some((m) => m.provider === current.provider && m.id === current.modelId)) return current;
          const preferred = d.modelList?.find((m) => /deepseek.*v4.*pro/i.test(`${m.name} ${m.id}`));
          if (!preferred) return null;
          const next = { provider: preferred.provider, modelId: preferred.id };
          persistBuddyReviewer(next);
          return next;
        });
        if (isNew && d.modelList.length > 0) {
          const def = d.defaultModel;
          const match = def && d.modelList.find((m) => m.id === def.modelId && m.provider === def.provider);
          const selected = match
            ? { provider: match.provider, modelId: match.id }
            : { provider: d.modelList[0].provider, modelId: d.modelList[0].id };
          setNewSessionModel(selected);
        }
      }
    }).catch(() => {});
  }, [isNew, modelsRefreshKey, persistBuddyReviewer, setNewSessionModel]);

  // Compact error auto-dismiss
  useEffect(() => {
    if (!compactError) return;
    const t = setTimeout(() => setCompactError(null), 3000);
    return () => clearTimeout(t);
  }, [compactError]);

  return {
    // State
    data, loading, error, activeLeafId, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel, thinkingLevel,
    retryInfo, contextUsage, systemPrompt, forkingEntryId,
    isCompacting, compactError, currentModel, displayModel, sessionStats,
    taskError, agentPhase, toolExecutionStatuses, planMode, planExecutionMode, planModeStatus,
    buddyMode, buddyReviewerModel,
    notices: noticeState.visible, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets,
    isNew,
    // Refs
    sessionIdRef, eventSourceRef, messagesEndRef, scrollContainerRef,
    lastUserMsgRef, pendingScrollToUserRef, initialScrollDoneRef,
    // Actions
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handleAbortCompaction,
    handleThinkingLevelChange, handlePlanModeChange, handleBuddyModeChange, handleBuddyReviewerChange, setActiveLeafId, setData, setMessages,
    respondToExtensionUi, sendExtensionCustomInput,
    dispatch, setAgentRunning, setForkingEntryId,
    // Subscriptions
    handleAgentEventRef,
  };
}
