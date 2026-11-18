export interface FileChange {
  /** Absolute or workspace-relative path reported by the tool call. */
  path: string;
  toolName: string;
  /** Unified diff produced by the tool, when available. */
  diff: string;
  /** Multiple edits to the same path within one session, oldest first. */
  entries: Array<{ toolName: string; diff: string }>;
  isError: boolean;
}

const DIFF_TOOLS = new Set(["edit", "write", "multi_edit", "apply_patch"]);

interface ToolCallLike {
  type?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  input?: unknown;
}

interface ToolResultLike {
  role?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  content?: unknown;
  isError?: unknown;
  details?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathFromInput(input: unknown): string | null {
  if (!isRecord(input)) return null;
  for (const key of ["path", "file_path", "filePath", "file"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function diffFromDetails(details: unknown): string {
  if (!isRecord(details)) return "";
  for (const key of ["diff", "patch"]) {
    const value = details[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/**
 * Collects file changes from a conversation. Tool results carry the diff the tool
 * produced, so this works without git and distinguishes agent edits from anything
 * the user changed outside the session.
 */
export function collectFileChanges(messages: readonly unknown[]): FileChange[] {
  const pathByCallId = new Map<string, { path: string; toolName: string }>();
  const byPath = new Map<string, FileChange>();

  for (const message of messages) {
    if (!isRecord(message)) continue;
    const role = message.role;

    if (role === "assistant") {
      const content = message.content;
      if (!Array.isArray(content)) continue;
      for (const block of content as ToolCallLike[]) {
        if (!isRecord(block) || block.type !== "toolCall") continue;
        const toolName = typeof block.toolName === "string" ? block.toolName : "";
        if (!DIFF_TOOLS.has(toolName)) continue;
        const callId = typeof block.toolCallId === "string" ? block.toolCallId : "";
        const path = pathFromInput(block.input);
        if (callId && path) pathByCallId.set(callId, { path, toolName });
      }
      continue;
    }

    if (role !== "toolResult") continue;
    const result = message as ToolResultLike;
    const callId = typeof result.toolCallId === "string" ? result.toolCallId : "";
    const call = pathByCallId.get(callId);
    if (!call) continue;

    const diff = diffFromDetails(result.details);
    const isError = result.isError === true;
    if (!diff && !isError) continue;

    const existing = byPath.get(call.path);
    if (existing) {
      existing.entries.push({ toolName: call.toolName, diff });
      if (diff) existing.diff = diff;
      existing.isError = existing.isError || isError;
      continue;
    }
    byPath.set(call.path, {
      path: call.path,
      toolName: call.toolName,
      diff,
      entries: [{ toolName: call.toolName, diff }],
      isError,
    });
  }

  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  text: string;
}

/**
 * Parses a unified diff into renderable lines, dropping the file headers and hunk
 * markers but keeping the hunk boundaries as context separators.
 */
export function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++") || raw.startsWith("---") || raw.startsWith("diff --git") || raw.startsWith("index ")) continue;
    if (raw.startsWith("@@")) {
      lines.push({ type: "context", text: raw });
      continue;
    }
    if (raw.startsWith("+")) lines.push({ type: "add", text: raw.slice(1) });
    else if (raw.startsWith("-")) lines.push({ type: "remove", text: raw.slice(1) });
    else lines.push({ type: "context", text: raw.startsWith(" ") ? raw.slice(1) : raw });
  }
  while (lines.length && lines[lines.length - 1].type === "context" && !lines[lines.length - 1].text.trim()) lines.pop();
  return lines;
}

/** Counts added and removed lines for a summary badge. */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

/** Shortens an absolute path to a workspace-relative label when possible. */
export function relativeChangePath(path: string, cwd: string | null | undefined): string {
  if (!cwd) return path;
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/$/, "");
  if (normalizedPath.startsWith(`${normalizedCwd}/`)) return normalizedPath.slice(normalizedCwd.length + 1);
  return path;
}
/** Basename of a change path, tolerant of both separators. */
const BACKSLASH = String.fromCharCode(92);

export function displayFileName(path: string): string {
  // Both separators split a path.
  const lastSeparator = Math.max(path.lastIndexOf("/"), path.lastIndexOf(BACKSLASH));
  return lastSeparator >= 0 ? path.slice(lastSeparator + 1) : path;
}
