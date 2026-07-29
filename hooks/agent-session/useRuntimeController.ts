import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { AgentMessage, ExtensionUiRequest, ExtensionUiResponse, ToolExecutionStatus } from "@/lib/types";
import { normalizeToolCalls } from "@/lib/normalize";
import { sendAgentCommand } from "@/lib/agent-client";
import { apiPath } from "@/lib/api-path";
import {
  appendCompletedMessage,
  extensionCustomUiReducer,
  isAbortError,
  noticeReducer,
  streamReducer,
  textFromToolPartial,
  updateToolStatus,
  userMessagesMatch,
} from "./helpers";
import type {
  AgentEvent,
  AgentPhase,
  AgentStateResponse,
  ExtensionUiCustomRequest,
  ExtensionUiDialogRequest,
  LiveAgentState,
  NoticeType,
} from "./types";

interface RuntimeOptions {
  identity: string;
  sessionIdRef: React.MutableRefObject<string | null>;
  messagesRef: React.MutableRefObject<AgentMessage[]>;
  setMessages: React.Dispatch<React.SetStateAction<AgentMessage[]>>;
  gate: {
    capture: () => { generation: number; identity: string };
    isCurrent: (token: { generation: number; identity: string }) => boolean;
  };
  loadSession: (sid: string, options?: { showLoading?: boolean; includeState?: boolean }) => Promise<AgentStateResponse | null | undefined>;
  applyPreferenceState: (state: LiveAgentState | undefined) => void;
  onAgentEnd?: () => void;
  chatInputRef?: React.RefObject<{ insertText: (text: string) => void } | null>;
}

export function useRuntimeController(options: RuntimeOptions) {
  const {
    identity, sessionIdRef, messagesRef, setMessages, gate, loadSession,
    applyPreferenceState, onAgentEnd, chatInputRef,
  } = options;
  const [streamState, dispatch] = useReducer(streamReducer, { isStreaming: false, streamingMessage: null });
  const [agentRunning, setAgentRunning] = useState(false);
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; maxAttempts: number; errorMessage?: string } | null>(null);
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [compactError, setCompactError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [agentPhase, setAgentPhase] = useState<AgentPhase>(null);
  const [toolExecutionStatuses, setToolExecutionStatuses] = useState<Map<string, ToolExecutionStatus>>(new Map());
  const [noticeState, dispatchNotice] = useReducer(noticeReducer, { visible: [] });
  const [extensionDialog, setExtensionDialog] = useState<ExtensionUiDialogRequest | null>(null);
  const [extensionCustomUis, dispatchExtensionCustomUi] = useReducer(extensionCustomUiReducer, []);
  const extensionCustomUi = extensionCustomUis.at(-1) ?? null;
  const [extensionStatuses, setExtensionStatuses] = useState<Array<{ key: string; text: string }>>([]);
  const [extensionWidgets, setExtensionWidgets] = useState<Array<{ key: string; lines: string[]; placement?: "aboveEditor" | "belowEditor" }>>([]);
  const agentRunningRef = useRef(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const connectionGenerationRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const stateRequestRef = useRef<AbortController | null>(null);
  const noticeTimersRef = useRef<Map<string, number>>(new Map());
  const baseAgentEventHandlerRef = useRef<((event: AgentEvent) => void) | null>(null);
  const handleAgentEventRef = useRef<((event: AgentEvent) => void) | null>(null);

  const updateRunning = useCallback((running: boolean) => {
    agentRunningRef.current = running;
    setAgentRunning(running);
  }, []);

  const clearConnection = useCallback(() => {
    connectionGenerationRef.current += 1;
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    stateRequestRef.current?.abort();
    stateRequestRef.current = null;
  }, []);

  const applyAgentState = useCallback((agentState: AgentStateResponse | null | undefined) => {
    if (!agentState) return;
    const active = Boolean(agentState.running && agentState.state?.isStreaming);
    updateRunning(active);
    if (active) {
      setAgentPhase((current) => current ?? { kind: "waiting_model" });
      dispatch({ type: "start" });
    } else {
      setAgentPhase(null);
      dispatch({ type: "reset" });
    }
    const state = agentState.state;
    if (!state) return;
    if (state.isCompacting !== undefined) setIsCompacting(state.isCompacting);
    if (state.contextUsage !== undefined) setContextUsage(state.contextUsage ?? null);
    if (state.systemPrompt !== undefined) setSystemPrompt(state.systemPrompt ?? null);
    applyPreferenceState(state);
  }, [applyPreferenceState, updateRunning]);

  const addNotice = useCallback((notice: { id?: string; message: string; type?: NoticeType }) => {
    const message = notice.message.trim();
    if (!message) return;
    const id = notice.id ?? `notice-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    dispatchNotice({ type: "add", notice: { id, message, type: notice.type ?? "info" } });
    const existing = noticeTimersRef.current.get(id);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      noticeTimersRef.current.delete(id);
      dispatchNotice({ type: "dismiss", id });
    }, 6000);
    noticeTimersRef.current.set(id, timer);
  }, []);

  const handleExtensionUiRequest = useCallback((request: ExtensionUiRequest) => {
    switch (request.method) {
      case "select": case "confirm": case "input": case "editor": setExtensionDialog(request); break;
      case "notify": addNotice({ id: request.id, type: request.notifyType ?? "info", message: request.message }); break;
      case "setStatus":
        setExtensionStatuses((current) => {
          const rest = current.filter((item) => item.key !== request.statusKey);
          return request.statusText ? [...rest, { key: request.statusKey, text: request.statusText }] : rest;
        });
        break;
      case "setWidget":
        setExtensionWidgets((current) => {
          const rest = current.filter((item) => item.key !== request.widgetKey);
          return request.widgetLines?.length ? [...rest, { key: request.widgetKey, lines: request.widgetLines, placement: request.placement }] : rest;
        });
        break;
      case "setTitle": if (request.title) document.title = request.title; break;
      case "set_editor_text": chatInputRef?.current?.insertText(request.text); break;
      case "custom":
        dispatchExtensionCustomUi({ type: "request", request });
        break;
    }
  }, [addNotice, chatInputRef]);

  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "extension_ui_request": handleExtensionUiRequest(event as ExtensionUiRequest); break;
      case "extension_error": addNotice({ type: "error", message: event.error as string ?? "Extension command failed" }); break;
      case "agent_start":
        setTaskError(null); updateRunning(true); setAgentPhase({ kind: "waiting_model" });
        setToolExecutionStatuses(new Map()); dispatch({ type: "start" }); break;
      case "agent_end": {
        updateRunning(false); setAgentPhase(null); setToolExecutionStatuses(new Map()); setRetryInfo(null); dispatch({ type: "end" });
        const sid = sessionIdRef.current;
        if (sid) {
          const token = gate.capture();
          void loadSession(sid).then(() => {
            if (!gate.isCurrent(token) || sid !== sessionIdRef.current) return;
            stateRequestRef.current?.abort();
            const controller = new AbortController();
            stateRequestRef.current = controller;
            fetch(apiPath(`agent/${encodeURIComponent(sid)}`), { signal: controller.signal })
              .then((response) => response.json())
              .then((result: AgentStateResponse) => {
                if (gate.isCurrent(token) && sid === sessionIdRef.current && stateRequestRef.current === controller) applyAgentState(result);
              })
              .catch((caught) => { if (!isAbortError(caught)) console.error("Failed to refresh Agent state:", caught); });
          });
        }
        onAgentEnd?.();
        break;
      }
      case "message_start": case "message_update": {
        const message = event.message as Partial<AgentMessage> | undefined;
        if (message) {
          const normalized = normalizeToolCalls(message as AgentMessage);
          const last = messagesRef.current[messagesRef.current.length - 1];
          if (!(normalized.role === "user" && last && userMessagesMatch(last, normalized))) dispatch({ type: "update", message: normalized });
        }
        setAgentPhase(null);
        break;
      }
      case "message_end": {
        const completed = event.message as AgentMessage | undefined;
        if (completed) {
          if (completed.role === "assistant" && completed.stopReason === "error") setTaskError(completed.errorMessage ?? "Agent task failed");
          setMessages((current) => appendCompletedMessage(current, normalizeToolCalls(completed)));
        }
        dispatch({ type: "reset" }); setAgentPhase({ kind: "waiting_model" }); break;
      }
      case "tool_execution_start": {
        const id = event.toolCallId as string; const name = event.toolName as string;
        setToolExecutionStatuses((current) => updateToolStatus(current, id, name));
        setAgentPhase((current) => {
          const tools = current?.kind === "running_tools" ? [...current.tools] : [];
          if (!tools.some((tool) => tool.id === id)) tools.push({ id, name });
          return { kind: "running_tools", tools };
        });
        break;
      }
      case "tool_execution_update": {
        const id = event.toolCallId as string; const name = event.toolName as string;
        setToolExecutionStatuses((current) => updateToolStatus(current, id, name, textFromToolPartial(event.partialResult)));
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId as string;
        setToolExecutionStatuses((current) => { if (!current.has(id)) return current; const next = new Map(current); next.delete(id); return next; });
        setAgentPhase((current) => {
          if (current?.kind !== "running_tools") return current;
          const tools = current.tools.filter((tool) => tool.id !== id);
          return tools.length ? { kind: "running_tools", tools } : { kind: "waiting_model" };
        });
        break;
      }
      case "auto_retry_start": setRetryInfo({ attempt: event.attempt as number, maxAttempts: event.maxAttempts as number, errorMessage: event.errorMessage as string | undefined }); break;
      case "auto_retry_end": setRetryInfo(null); break;
      case "auto_compaction_start": case "compaction_start": setIsCompacting(true); setCompactError(null); break;
      case "auto_compaction_end": case "compaction_end":
        setIsCompacting(false);
        if (event.errorMessage) setCompactError(event.errorMessage as string);
        else if (!event.aborted && sessionIdRef.current) void loadSession(sessionIdRef.current);
        break;
    }
  }, [addNotice, applyAgentState, gate, handleExtensionUiRequest, loadSession, messagesRef, onAgentEnd, sessionIdRef, setMessages, updateRunning]);
  baseAgentEventHandlerRef.current = handleAgentEvent;

  const connectEvents = useCallback((sid: string, options: { syncOnConnect?: boolean } = {}) => {
    const syncOnConnect = options.syncOnConnect ?? true;
    clearConnection();
    const lifecycleToken = gate.capture();
    const connectionGeneration = connectionGenerationRef.current;
    const source = new EventSource(apiPath(`agent/${encodeURIComponent(sid)}/events`));
    eventSourceRef.current = source;
    const isCurrent = () => gate.isCurrent(lifecycleToken)
      && connectionGenerationRef.current === connectionGeneration
      && eventSourceRef.current === source
      && sessionIdRef.current === sid;
    source.onmessage = (messageEvent) => {
      if (!isCurrent()) return;
      try {
        const event = JSON.parse(messageEvent.data) as AgentEvent;
        baseAgentEventHandlerRef.current?.(event);
        handleAgentEventRef.current?.(event);
        if (event.type === "connected" && syncOnConnect) {
          void loadSession(sid, { includeState: true }).then((state) => { if (isCurrent()) applyAgentState(state); });
        }
      } catch { /* ignore malformed events */ }
    };
    source.onerror = () => {
      if (!isCurrent() || !agentRunningRef.current) return;
      source.close();
      eventSourceRef.current = null;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        if (gate.isCurrent(lifecycleToken) && connectionGenerationRef.current === connectionGeneration && agentRunningRef.current && sessionIdRef.current === sid) {
          connectEvents(sid, { syncOnConnect: true });
        }
      }, 1000);
    };
  }, [applyAgentState, clearConnection, gate, loadSession, sessionIdRef]);

  const respondToExtensionUi = useCallback(async (request: ExtensionUiDialogRequest, response: Omit<ExtensionUiResponse, "type" | "id">) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setExtensionDialog((current) => current?.id === request.id ? null : current);
    try { await sendAgentCommand(sid, { type: "extension_ui_response", id: request.id, ...response }); }
    catch (caught) { if (sid === sessionIdRef.current) console.error("Failed to send extension UI response:", caught); }
  }, [sessionIdRef]);

  const sendExtensionCustomInput = useCallback(async (request: ExtensionUiCustomRequest, data: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try { await sendAgentCommand(sid, { type: "extension_ui_input", id: request.id, data }); }
    catch (caught) { if (sid === sessionIdRef.current) console.error("Failed to send extension custom UI input:", caught); }
  }, [sessionIdRef]);

  useEffect(() => {
    clearConnection();
    updateRunning(false);
    dispatch({ type: "reset" });
    setAgentPhase(null); setToolExecutionStatuses(new Map()); setRetryInfo(null);
    setContextUsage(null); setSystemPrompt(null); setTaskError(null); setCompactError(null); setIsCompacting(false);
    setExtensionDialog(null); dispatchExtensionCustomUi({ type: "reset" }); setExtensionStatuses([]); setExtensionWidgets([]);
    dispatchNotice({ type: "reset" });
    for (const timer of noticeTimersRef.current.values()) window.clearTimeout(timer);
    noticeTimersRef.current.clear();
    return clearConnection;
  }, [clearConnection, identity, updateRunning]);

  useEffect(() => {
    if (!compactError) return;
    const timer = window.setTimeout(() => setCompactError(null), 3000);
    return () => window.clearTimeout(timer);
  }, [compactError]);

  return {
    streamState, dispatch, agentRunning, setAgentRunning: updateRunning, agentRunningRef,
    retryInfo, contextUsage, systemPrompt, isCompacting, setIsCompacting,
    compactError, setCompactError, taskError, setTaskError, agentPhase, setAgentPhase,
    toolExecutionStatuses, notices: noticeState.visible, extensionDialog, extensionCustomUi,
    extensionStatuses, extensionWidgets, eventSourceRef, handleAgentEventRef,
    applyAgentState, connectEvents, clearConnection, respondToExtensionUi, sendExtensionCustomInput,
  };
}
