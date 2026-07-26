import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage, SessionInfo } from "@/lib/types";
import { apiPath } from "@/lib/api-path";
import { calculateSessionStats, isAbortError } from "./helpers";
import type { AgentStateResponse, SessionData, ThinkingLevelOption } from "./types";

interface LifecycleGate {
  capture: () => { generation: number; identity: string };
  isCurrent: (token: { generation: number; identity: string }) => boolean;
}

export function useSessionDataController({
  session,
  isNew,
  gate,
}: {
  session: SessionInfo | null;
  isNew: boolean;
  gate: LifecycleGate;
}) {
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [activeLeafId, setActiveLeafId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [entryIds, setEntryIds] = useState<string[]>([]);
  const [currentModelOverride, setCurrentModelOverride] = useState<{ provider: string; modelId: string } | null>(null);
  const [pendingModel, setPendingModel] = useState<{ provider: string; modelId: string } | null>(null);
  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const messagesRef = useRef<AgentMessage[]>([]);
  const sessionRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const contextRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const requestSequenceRef = useRef(0);
  messagesRef.current = messages;

  useEffect(() => {
    sessionRequestRef.current?.controller.abort();
    contextRequestRef.current?.controller.abort();
    sessionRequestRef.current = null;
    contextRequestRef.current = null;
    sessionIdRef.current = session?.id ?? null;
    setData(null);
    setActiveLeafId(null);
    setMessages([]);
    setEntryIds([]);
    setCurrentModelOverride(null);
    setPendingModel(null);
    setError(null);
    setLoading(Boolean(session?.id));
  }, [session?.id, isNew]);

  useEffect(() => () => {
    sessionRequestRef.current?.controller.abort();
    contextRequestRef.current?.controller.abort();
  }, []);

  const loadSession = useCallback(async (
    sid: string,
    options: { showLoading?: boolean; includeState?: boolean } = {},
  ): Promise<AgentStateResponse | null | undefined> => {
    const { showLoading = false, includeState = false } = options;
    const token = gate.capture();
    const requestId = ++requestSequenceRef.current;
    sessionRequestRef.current?.controller.abort();
    const controller = new AbortController();
    sessionRequestRef.current = { id: requestId, controller };
    const requestIsCurrent = () => gate.isCurrent(token)
      && sessionRequestRef.current?.id === requestId
      && sessionIdRef.current === sid;
    try {
      if (showLoading && requestIsCurrent()) setLoading(true);
      const suffix = includeState ? "?includeState" : "";
      const response = await fetch(apiPath(`sessions/${encodeURIComponent(sid)}${suffix}`), { signal: controller.signal });
      if (!requestIsCurrent()) return undefined;
      if (response.status === 404) {
        if (showLoading) {
          setData(null);
          setActiveLeafId(null);
          setMessages([]);
          setEntryIds([]);
          setError(null);
        }
        return null;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json() as SessionData & { agentState?: AgentStateResponse };
      if (!requestIsCurrent()) return undefined;
      setData(next);
      setActiveLeafId(next.leafId);
      setMessages(next.context.messages);
      setEntryIds(next.context.entryIds ?? []);
      setCurrentModelOverride(null);
      setError(null);
      return includeState ? next.agentState ?? null : undefined;
    } catch (caught) {
      if (!isAbortError(caught) && requestIsCurrent()) setError(String(caught));
      return undefined;
    } finally {
      if (requestIsCurrent()) {
        if (showLoading) setLoading(false);
        sessionRequestRef.current = null;
      }
    }
  }, [gate]);

  const loadContext = useCallback(async (sid: string, leafId: string | null): Promise<boolean> => {
    const token = gate.capture();
    const requestId = ++requestSequenceRef.current;
    contextRequestRef.current?.controller.abort();
    const controller = new AbortController();
    contextRequestRef.current = { id: requestId, controller };
    const requestIsCurrent = () => gate.isCurrent(token)
      && contextRequestRef.current?.id === requestId
      && sessionIdRef.current === sid;
    try {
      const suffix = leafId ? `?leafId=${encodeURIComponent(leafId)}` : "";
      const response = await fetch(apiPath(`sessions/${encodeURIComponent(sid)}/context${suffix}`), { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = await response.json() as { context: { messages: AgentMessage[]; entryIds: string[] } };
      if (!requestIsCurrent()) return false;
      setMessages(next.context.messages);
      setEntryIds(next.context.entryIds ?? []);
      return true;
    } catch (caught) {
      if (!isAbortError(caught) && requestIsCurrent()) console.error("Failed to load context:", caught);
      return false;
    } finally {
      if (contextRequestRef.current?.id === requestId) contextRequestRef.current = null;
    }
  }, [gate]);

  const sessionStats = useMemo(() => calculateSessionStats(messages), [messages]);
  const sessionThinkingLevel = data?.context.thinkingLevel as ThinkingLevelOption | undefined;

  return {
    data, setData, loading, error, setError, activeLeafId, setActiveLeafId,
    messages, setMessages, messagesRef, entryIds, setEntryIds,
    currentModelOverride, setCurrentModelOverride, pendingModel, setPendingModel,
    sessionIdRef, sessionStats, sessionThinkingLevel, loadSession, loadContext,
  };
}
