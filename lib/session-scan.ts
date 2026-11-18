import type { SessionInfo } from "./types";

export interface FileScanState {
  path: string;
  /** Bytes already consumed; scanning resumes here for appended content. */
  offset: number;
  size: number;
  mtimeMs: number;
  /** Header fields, captured once when the first scan sees the session header. */
  id: string;
  cwd: string;
  created: string;
  parentSessionPath?: string;
  messageCount: number;
  firstMessage: string;
  name?: string;
  /** Latest user/assistant activity timestamp, used as the sort key. */
  lastActivity?: number;
  /** Bytes of the last line when it had no trailing newline yet. */
  pendingLine: string;
}

export interface SessionScanIndex {
  version: number;
  files: Record<string, FileScanState>;
}

export const SESSION_SCAN_INDEX_VERSION = 1;

interface ParsedLine {
  type?: unknown;
  message?: { role?: unknown; content?: unknown; timestamp?: unknown };
  name?: unknown;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text: string } =>
      Boolean(block) && typeof block === "object" && (block as { type?: unknown }).type === "text"
      && typeof (block as { text?: unknown }).text === "string")
    .map((block) => block.text)
    .join(" ");
}

/** Applies one JSONL line to the running file state. Returns false when unsupported. */
export function applySessionLine(state: FileScanState, line: string, nowIso: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  let entry: ParsedLine;
  try {
    entry = JSON.parse(trimmed) as ParsedLine;
  } catch {
    return true; // Malformed lines are skipped, matching pi's own reader.
  }
  if (!entry || typeof entry !== "object") return true;

  if (typeof entry.type !== "string") return true;

  if (entry.type === "session") {
    const raw = entry as unknown as Record<string, unknown>;
    if (typeof raw.id !== "string") return false;
    state.id = raw.id;
    state.cwd = typeof raw.cwd === "string" ? raw.cwd : "";
    state.created = typeof raw.timestamp === "string" ? raw.timestamp : nowIso;
    state.parentSessionPath = typeof raw.parentSession === "string" ? raw.parentSession : undefined;
    return true;
  }

  if (entry.type === "session_info") {
    state.name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined;
    return true;
  }

  if (entry.type !== "message") return true;

  state.messageCount += 1;
  const message = entry.message;
  if (!message || typeof message !== "object") return true;
  const role = message.role;
  if (role !== "user" && role !== "assistant") return true;

  const activity = typeof message.timestamp === "number"
    ? message.timestamp
    : new Date((entry as unknown as { timestamp?: string }).timestamp ?? "").getTime();
  if (Number.isFinite(activity)) state.lastActivity = Math.max(state.lastActivity ?? 0, activity);

  const text = textFromContent(message.content);
  if (text && !state.firstMessage && role === "user") state.firstMessage = text;
  return true;
}

export function emptyFileState(path: string): FileScanState {
  return {
    path,
    offset: 0,
    size: 0,
    mtimeMs: 0,
    id: "",
    cwd: "",
    created: "",
    messageCount: 0,
    firstMessage: "",
    pendingLine: "",
  };
}

/** True when the file on disk matches what the index last consumed. */
export function stateIsCurrent(state: FileScanState, size: number, mtimeMs: number): boolean {
  return state.size === size && state.mtimeMs === mtimeMs && state.offset === size;
}

export function toSessionInfo(state: FileScanState, fallbackModified: number): SessionInfo | null {
  if (!state.id) return null;
  const modified = state.lastActivity && state.lastActivity > 0
    ? new Date(state.lastActivity).toISOString()
    : state.created || new Date(fallbackModified).toISOString();
  return {
    path: state.path,
    id: state.id,
    cwd: state.cwd,
    name: state.name,
    created: state.created || modified,
    modified,
    messageCount: state.messageCount,
    firstMessage: state.firstMessage || "(no messages)",
  };
}