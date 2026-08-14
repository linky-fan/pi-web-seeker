import type { AgentMessage, AssistantMessage, TextContent, ToolExecutionStatus } from "@/lib/types";
import { getSubagentMessageKey } from "@/lib/subagents";
import type {
  ExtensionUiCustomRequest,
  NoticeAction,
  NoticeState,
  SessionStats,
  StreamAction,
  StreamingState,
} from "./types";

export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 140;
export const PLAN_MODE_STORAGE_PREFIX = "pi-web.planMode";
export const PLAN_EXECUTION_MODE_STORAGE_PREFIX = "pi-web.planExecutionMode";
export const BUDDY_MODE_STORAGE_PREFIX = "pi-web.buddyMode";
export const BUDDY_REVIEWER_STORAGE_PREFIX = "pi-web.buddyReviewer";

export function streamReducer(state: StreamingState, action: StreamAction): StreamingState {
  switch (action.type) {
    case "start": return { isStreaming: true, streamingMessage: null };
    case "update": return { isStreaming: true, streamingMessage: action.message };
    case "runtime_error":
    case "end":
    case "reset": return { isStreaming: false, streamingMessage: null };
    default: return state;
  }
}

export function runtimeErrorMessage(event: unknown): string {
  const message = (event as { message?: unknown } | null)?.message;
  return typeof message === "string" && message.trim()
    ? message.trim()
    : "Agent runtime failed";
}

export function noticeReducer(state: NoticeState, action: NoticeAction): NoticeState {
  switch (action.type) {
    case "add":
      return { visible: [...state.visible.filter((item) => item.id !== action.notice.id), action.notice].slice(-4) };
    case "dismiss": return { visible: state.visible.filter((item) => item.id !== action.id) };
    case "reset": return { visible: [] };
    default: return state;
  }
}

export type ExtensionCustomUiAction =
  | { type: "request"; request: ExtensionUiCustomRequest }
  | { type: "reset" };

export function extensionCustomUiReducer(
  state: ExtensionUiCustomRequest[],
  action: ExtensionCustomUiAction,
): ExtensionUiCustomRequest[] {
  if (action.type === "reset") return state.length === 0 ? state : [];
  const { request } = action;
  const index = state.findIndex((item) => item.id === request.id);
  if (request.closed) {
    return index === -1 ? state : state.filter((_, itemIndex) => itemIndex !== index);
  }
  if (index === -1) return [...state, request];
  const next = [...state];
  next[index] = request;
  return next;
}

export function userMessageKey(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") return `text:${message.content.trim()}`;
  return message.content.map((block) => {
    if (block.type === "text") return `text:${block.text.trim()}`;
    const data = block.source.data ?? "";
    const url = block.source.url ?? "";
    return `image:${block.source.media_type ?? ""}:${data.length}:${data.slice(0, 64)}:${url}`;
  }).join("\n");
}

export function userMessagesMatch(a: AgentMessage, b: AgentMessage): boolean {
  return a.role === "user" && b.role === "user" && userMessageKey(a) === userMessageKey(b);
}

export function appendCompletedMessage(messages: AgentMessage[], message: AgentMessage): AgentMessage[] {
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

export function textFromToolPartial(partial: unknown): string {
  const content = (partial as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is TextContent => Boolean(block) && (block as { type?: unknown }).type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function updateToolStatus(
  statuses: Map<string, ToolExecutionStatus>,
  id: string,
  name: string,
  outputText = "",
  now = Date.now(),
): Map<string, ToolExecutionStatus> {
  const existing = statuses.get(id);
  const next = new Map(statuses);
  next.set(id, {
    id,
    name: name || existing?.name || "tool",
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
    outputText: outputText || existing?.outputText || "",
  });
  return next;
}

export function calculateSessionStats(messages: AgentMessage[]): SessionStats | null {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const usage = (message as AssistantMessage).usage;
    if (!usage) continue;
    tokens.input += usage.input ?? 0;
    tokens.output += usage.output ?? 0;
    tokens.cacheRead += usage.cacheRead ?? 0;
    tokens.cacheWrite += usage.cacheWrite ?? 0;
    cost += usage.cost?.total ?? 0;
  }
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0 ? { tokens, cost } : null;
}

export function sessionStorageKey(prefix: string, sessionId: string | null, cwd: string | null): string | null {
  if (sessionId) return `${prefix}:session:${sessionId}`;
  return cwd ? `${prefix}:cwd:${cwd}` : null;
}

export interface LifecycleToken { generation: number; identity: string; }

export function isLifecycleTokenCurrent(
  token: LifecycleToken,
  current: LifecycleToken,
  sessionId?: string | null,
  expectedSessionId?: string | null,
): boolean {
  return token.generation === current.generation
    && token.identity === current.identity
    && (expectedSessionId === undefined || sessionId === expectedSessionId);
}

export function isOperationCurrent(
  operation: number,
  currentOperation: number,
  sessionId: string | null,
  currentSessionId: string | null,
): boolean {
  return operation === currentOperation && sessionId === currentSessionId;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && error.name === "AbortError";
}

export function shouldFollowScroll(distanceFromBottom: number): boolean {
  return distanceFromBottom <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
}
