import type {
  AssistantContentBlock,
  AssistantMessage,
  TextContent,
  ThinkingContent,
  ToolCallContent,
  ToolResultMessage,
  UserMessage,
} from "@/lib/types";
import { messageContentToText } from "@/lib/subagents";
import type { ComsNetEvent, MessageViewProps } from "./types";

export function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return `${date} ${time}`;
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve();
  } catch {
    return Promise.reject();
  }
}

export function estimateToolInputLength(input: unknown): number {
  if (input === null || input === undefined) return 0;
  if (typeof input === "string") return input.length;
  try {
    return JSON.stringify(input).length;
  } catch {
    return 0;
  }
}

export function estimateBlockChars(block: AssistantContentBlock): number {
  if (block.type === "text") return (block as TextContent).text?.length ?? 0;
  if (block.type === "thinking") return (block as ThinkingContent).thinking?.length ?? 0;
  if (block.type === "toolCall") return estimateToolInputLength((block as ToolCallContent).input);
  return 0;
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString();
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function formatDurationBrief(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const minuteRest = minutes % 60;
  return minuteRest > 0 ? `${hours}h ${minuteRest}m` : `${hours}h`;
}

export function getSubagentStatusStyle(status: string): {
  label: string;
  kind: "done" | "active" | "error";
  color: string;
  bg: string;
  border: string;
} {
  const normalized = status.toLowerCase();
  if (["error", "stopped", "aborted"].includes(normalized)) {
    return { label: normalized, kind: "error", color: "#f87171", bg: "rgba(248,113,113,0.06)", border: "rgba(248,113,113,0.35)" };
  }
  if (["running", "queued"].includes(normalized)) {
    return { label: normalized, kind: "active", color: "var(--accent)", bg: "rgba(96,165,250,0.06)", border: "rgba(96,165,250,0.32)" };
  }
  return {
    label: normalized === "steered" ? "completed (steered)" : "completed",
    kind: "done",
    color: "#16a34a",
    bg: "rgba(34,197,94,0.05)",
    border: "rgba(34,197,94,0.28)",
  };
}

export function formatAgentName(id?: string): string {
  if (!id) return "agent";
  return id.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function stringifyDetail(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function assistantMessageText(message: AssistantMessage): string {
  return message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function parseComsNetMessage(customType: string, content: string, details: unknown): ComsNetEvent | null {
  if (!customType.startsWith("coms-net-")) return null;
  const data = isRecord(details) ? details : {};
  const sender = isRecord(data.sender) ? data.sender : {};
  const target = isRecord(data.target) ? data.target : {};
  const peer = stringValue(sender.name) ?? stringValue(target.name) ?? stringValue(data.target) ?? "peer";
  const msgId = stringValue(data.msg_id);
  const status = stringValue(data.status);
  const prompt = stringValue(data.prompt)
    ?? content.replace(/^Sent coms-net request to [\s\S]*?:\s*/, "").replace(/^coms-net request from [\s\S]*?:\s*/, "");
  const response = stringifyDetail(data.response);
  const error = stringValue(data.error) ?? null;

  if (customType === "coms-net-inbound") return { direction: "inbound", title: "Received coms-net request", peer, prompt, msgId, error };
  if (customType === "coms-net-outbound") return { direction: "outbound", title: "Sent coms-net request", peer, prompt, msgId, status, error };
  if (customType === "coms-net-response-received") {
    return { direction: "response-in", title: error ? "coms-net response failed" : "Received coms-net response", peer, prompt, response, msgId, error };
  }
  if (customType === "coms-net-response-sent") {
    return { direction: "response-out", title: error ? "Failed to answer coms-net request" : "Answered coms-net request", peer, response, msgId, error };
  }
  return null;
}

export function parseLegacyComsNetUserMessage(message: UserMessage): ComsNetEvent | null {
  const content = messageContentToText(message.content);
  const match = content.match(/^A coms-net peer named "([^"]+)" asked for help\.\n\nRequest:\n([\s\S]*?)\n\nAnswer the peer directly\./);
  if (!match) return null;
  return { direction: "inbound", title: "Received coms-net request", peer: match[1], prompt: match[2].trim() };
}

export function parseToolResultJson(result?: ToolResultMessage): Record<string, unknown> {
  const withDetails = result as (ToolResultMessage & { details?: unknown }) | undefined;
  if (isRecord(withDetails?.details)) return withDetails.details;
  const text = toolResultText(result)?.trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseComsNetToolCall(block: ToolCallContent, result?: ToolResultMessage): ComsNetEvent | null {
  const input = isRecord(block.input) ? block.input : {};
  const resultDetails = parseToolResultJson(result);
  const resultText = toolResultText(result)?.trim() ?? "";
  if (block.toolName === "coms_net_send") {
    return {
      direction: "outbound",
      title: "Sent coms-net request",
      peer: stringValue(input.target) ?? stringValue(input.target_session) ?? "peer",
      prompt: stringValue(input.prompt) ?? "",
      msgId: stringValue(resultDetails.msg_id),
      status: stringValue(resultDetails.status),
      error: result?.isError ? (resultText || "send_failed") : null,
    };
  }
  if (block.toolName === "coms_net_await") {
    return {
      direction: "response-in",
      title: result?.isError ? "coms-net response failed" : "Received coms-net response",
      peer: "peer",
      response: resultText,
      msgId: stringValue(input.msg_id),
      error: result?.isError ? (resultText || "response_failed") : null,
    };
  }
  return null;
}

export function toolTimeoutSeconds(input: Record<string, unknown>): number | null {
  const value = input.timeout ?? input.timeoutSeconds ?? input.timeout_ms ?? input.timeoutMs;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed > 10_000 ? Math.round(parsed / 1000) : Math.round(parsed);
}

export function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  for (const key of ["command", "path", "file_path", "pattern", "query"]) {
    if (key in input) return String(input[key]).slice(0, 120);
  }
  return String(input[keys[0]]).slice(0, 120);
}

export function formatToolInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function toolResultText(result?: ToolResultMessage): string | null {
  if (!result) return null;
  return result.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function formatUsage(usage: NonNullable<AssistantMessage["usage"]>): string {
  const parts: string[] = [];
  if (usage.input) parts.push(`${usage.input.toLocaleString()} in`);
  if (usage.output) parts.push(`${usage.output.toLocaleString()} out`);
  if (usage.cacheRead) parts.push(`${usage.cacheRead.toLocaleString()} cache`);
  if (usage.cost?.total) parts.push(`$${usage.cost.total.toFixed(4)}`);
  return parts.join(" · ");
}

export function messageToolCallIds(message: MessageViewProps["message"]): string[] {
  if (message.role !== "assistant") return [];
  return message.content
    .filter((block): block is ToolCallContent => block.type === "toolCall")
    .map((block) => block.toolCallId)
    .filter(Boolean);
}

function relatedMapEqual<T>(ids: string[], left?: Map<string, T>, right?: Map<string, T>): boolean {
  if (left === right) return true;
  return ids.every((id) => left?.get(id) === right?.get(id));
}

function relatedSetEqual(ids: string[], left?: Set<string>, right?: Set<string>): boolean {
  if (left === right) return true;
  return ids.every((id) => Boolean(left?.has(id)) === Boolean(right?.has(id)));
}

export function areMessageViewPropsEqual(previous: MessageViewProps, next: MessageViewProps): boolean {
  if (previous.message !== next.message) return false;
  if (previous.isStreaming !== next.isStreaming
    || previous.modelNames !== next.modelNames
    || previous.entryId !== next.entryId
    || previous.onFork !== next.onFork
    || previous.forking !== next.forking
    || previous.onNavigate !== next.onNavigate
    || previous.prevAssistantEntryId !== next.prevAssistantEntryId
    || previous.onEditContent !== next.onEditContent
    || previous.showTimestamp !== next.showTimestamp
    || previous.prevTimestamp !== next.prevTimestamp
    || previous.nextTimestamp !== next.nextTimestamp) return false;
  if (previous.comsNetResponse?.peer !== next.comsNetResponse?.peer
    || previous.comsNetResponse?.msgId !== next.comsNetResponse?.msgId) return false;
  const ids = messageToolCallIds(previous.message);
  return relatedMapEqual(ids, previous.toolResults, next.toolResults)
    && relatedSetEqual(ids, previous.runningToolIds, next.runningToolIds)
    && relatedMapEqual(ids, previous.toolExecutionStatuses, next.toolExecutionStatuses);
}
