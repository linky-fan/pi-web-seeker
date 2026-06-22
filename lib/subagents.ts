import type { CustomMessage, ImageContent, SessionEntry, TextContent } from "./types";

export interface SubagentNotification {
  id?: string;
  agentType?: string;
  toolCallId?: string;
  description: string;
  status: string;
  resultPreview: string;
  toolUses?: number;
  turnCount?: number;
  maxTurns?: number;
  totalTokens?: number;
  contextPercent?: number;
  compactionCount?: number;
  durationMs?: number;
  outputFile?: string;
  error?: string;
}

type TextLikeContent = string | (TextContent | ImageContent)[];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberField(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/,/g, "");
  if (!normalized) return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringField(record[key]);
    if (value) return value;
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = numberField(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function nestedNumber(record: Record<string, unknown>, key: string, nestedKeys: string[]): number | undefined {
  const nested = record[key];
  if (!isRecord(nested)) return undefined;
  return firstNumber(nested, nestedKeys);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function xmlTagText(xml: string, tag: string): string | undefined {
  const escaped = escapeRegExp(tag);
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1]?.trim();
}

function firstXmlText(xml: string, tags: string[]): string | undefined {
  for (const tag of tags) {
    const value = xmlTagText(xml, tag);
    if (value) return decodeXml(value);
  }
  return undefined;
}

function firstXmlNumber(xml: string, tags: string[]): number | undefined {
  for (const tag of tags) {
    const value = numberField(xmlTagText(xml, tag));
    if (value !== undefined) return value;
  }
  return undefined;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function messageContentToText(content: TextLikeContent): string {
  return typeof content === "string"
    ? content
    : content
        .filter((b): b is TextContent => b.type === "text")
        .map((b) => b.text)
        .join("\n");
}

const ID_KEYS = ["id", "agentId", "agentID", "agent_id", "taskId", "taskID", "task_id"];
const TOOL_CALL_KEYS = ["toolCallId", "toolCallID", "tool_call_id", "toolUseId", "toolUseID", "tool_use_id"];

function notificationIdentityFromRecord(record: Record<string, unknown>): string | undefined {
  return firstString(record, ID_KEYS) ?? firstString(record, TOOL_CALL_KEYS);
}

function getSubagentRecordId(entry: SessionEntry): string | undefined {
  if (entry.type !== "custom" || entry.customType !== "subagents:record") return undefined;
  return isRecord(entry.data) ? notificationIdentityFromRecord(entry.data) : undefined;
}

function getSubagentNotificationId(entry: SessionEntry): string | undefined {
  if (entry.type !== "custom_message") return undefined;
  if (!isSubagentCustomType(entry.customType, entry.content)) return undefined;
  if (isRecord(entry.details)) {
    const detailId = notificationIdentityFromRecord(entry.details);
    if (detailId) return detailId;
  }
  return notificationIdFromContent(messageContentToText(entry.content));
}

function notificationIdFromContent(content: string): string | undefined {
  return firstXmlText(content, ["task-id", "task_id", "agent-id", "agent_id", "id"])
    ?? firstXmlText(content, ["tool-use-id", "tool_use_id", "toolCallId", "tool_call_id"]);
}

export function isSubagentCustomType(customType: string, content: TextLikeContent): boolean {
  return customType === "subagent-notification" || messageContentToText(content).includes("<task-notification");
}

function parseSubagentXml(content: string): SubagentNotification[] {
  const blocks = [...content.matchAll(/<task-notification\b[^>]*>([\s\S]*?)<\/task-notification>/gi)].map((m) => m[1]);
  return blocks.map((xml) => {
    const metrics = xmlTagText(xml, "metrics") ?? xmlTagText(xml, "usage") ?? "";
    return {
      id: firstXmlText(xml, ["task-id", "task_id", "agent-id", "agent_id", "id"]),
      agentType: firstXmlText(xml, ["type", "agent-type", "agent_type", "subagent-type", "subagent_type"]),
      toolCallId: firstXmlText(xml, ["tool-use-id", "tool_use_id", "toolCallId", "tool_call_id"]),
      status: firstXmlText(xml, ["status", "state"]) ?? "completed",
      description: firstXmlText(xml, ["summary", "description", "name"]) ?? "Subagent",
      resultPreview: firstXmlText(xml, ["result", "output"]) ?? "No output.",
      totalTokens: firstXmlNumber(metrics, ["tokens", "total_tokens", "totalTokens", "token-count", "tokenCount"]),
      toolUses: firstXmlNumber(metrics, ["tool-use-count", "tool_uses", "toolUses", "tool-uses"]),
      contextPercent: firstXmlNumber(metrics, ["context-percent", "context_percent", "contextPercent"]),
      compactionCount: firstXmlNumber(metrics, ["compaction-count", "compaction_count", "compactionCount"]),
      durationMs: firstXmlNumber(metrics, ["duration-ms", "duration_ms", "durationMs"]),
      outputFile: firstXmlText(xml, ["transcript", "output-file", "output_file"]),
    };
  });
}

function notificationFromRecord(record: Record<string, unknown>): SubagentNotification {
  return {
    id: firstString(record, ID_KEYS),
    agentType: firstString(record, ["type", "agentType", "subagentType", "subagent_type"]),
    toolCallId: firstString(record, TOOL_CALL_KEYS),
    description: firstString(record, ["description", "summary", "name"]) ?? "Subagent",
    status: firstString(record, ["status", "state"]) ?? "completed",
    resultPreview: firstString(record, ["resultPreview", "result", "output"]) ?? "No output.",
    toolUses: firstNumber(record, ["toolUses", "toolUseCount", "tool_use_count", "tool_uses"]),
    turnCount: firstNumber(record, ["turnCount", "turns"]),
    maxTurns: firstNumber(record, ["maxTurns", "max_turns"]),
    totalTokens: firstNumber(record, ["totalTokens", "tokenCount", "total_tokens"]) ?? nestedNumber(record, "tokens", ["total", "totalTokens", "total_tokens"]),
    contextPercent: firstNumber(record, ["contextPercent", "context_percent"]),
    compactionCount: firstNumber(record, ["compactionCount", "compaction_count"]),
    durationMs: firstNumber(record, ["durationMs", "duration_ms", "duration"]),
    outputFile: firstString(record, ["outputFile", "output_file", "transcript", "transcriptPath"]),
    error: firstString(record, ["error", "errorMessage", "error_message"]),
  };
}

function mergeNotification(base: SubagentNotification | undefined, override: SubagentNotification): SubagentNotification {
  return {
    ...base,
    ...override,
    id: override.id ?? base?.id,
    agentType: override.agentType ?? base?.agentType,
    toolCallId: override.toolCallId ?? base?.toolCallId,
    toolUses: override.toolUses ?? base?.toolUses,
    turnCount: override.turnCount ?? base?.turnCount,
    maxTurns: override.maxTurns ?? base?.maxTurns,
    totalTokens: override.totalTokens ?? base?.totalTokens,
    contextPercent: override.contextPercent ?? base?.contextPercent,
    compactionCount: override.compactionCount ?? base?.compactionCount,
    durationMs: override.durationMs ?? base?.durationMs,
    outputFile: override.outputFile ?? base?.outputFile,
    error: override.error ?? base?.error,
  };
}

export function parseSubagentNotifications(content: string, details?: unknown): SubagentNotification[] {
  const xmlNotifications = parseSubagentXml(content);
  if (!isRecord(details)) return xmlNotifications;

  const extraRecords = ["others", "notifications", "agents", "records"]
    .flatMap((key) => Array.isArray(details[key]) ? details[key] : [])
    .filter(isRecord);
  const records = [details, ...extraRecords];
  const detailNotifications = records.map(notificationFromRecord);

  if (detailNotifications.length === 0) return xmlNotifications;
  return detailNotifications.map((detail, index) => {
    const match = detail.id
      ? xmlNotifications.find((n) => n.id === detail.id)
      : undefined;
    return mergeNotification(match ?? xmlNotifications[index], detail);
  });
}

export function getSubagentMessageKey(message: CustomMessage): string | undefined {
  if (!isSubagentCustomType(message.customType, message.content)) return undefined;
  if (isRecord(message.details)) {
    const id = notificationIdentityFromRecord(message.details);
    if (id) return id;
  }
  return notificationIdFromContent(messageContentToText(message.content));
}

function subagentRecordToCustomMessage(entry: SessionEntry): SessionEntry {
  if (entry.type !== "custom" || entry.customType !== "subagents:record" || !isRecord(entry.data)) return entry;

  const notification = notificationFromRecord(entry.data);
  const usageParts: string[] = [];
  if (notification.totalTokens !== undefined) usageParts.push(`<total_tokens>${notification.totalTokens}</total_tokens>`);
  if (notification.toolUses !== undefined) usageParts.push(`<tool_uses>${notification.toolUses}</tool_uses>`);
  if (notification.contextPercent !== undefined) usageParts.push(`<context_percent>${notification.contextPercent}</context_percent>`);
  if (notification.compactionCount !== undefined) usageParts.push(`<compaction_count>${notification.compactionCount}</compaction_count>`);
  if (notification.durationMs !== undefined) usageParts.push(`<duration_ms>${notification.durationMs}</duration_ms>`);
  const usage = usageParts.length ? `<usage>${usageParts.join("")}</usage>` : "";

  return {
    type: "custom_message",
    id: entry.id,
    parentId: entry.parentId,
    timestamp: entry.timestamp,
    customType: "subagent-notification",
    content: [
      `Subagent record: ${notification.description}`,
      "",
      [
        "<task-notification>",
        notification.id ? `<task-id>${escapeXml(notification.id)}</task-id>` : "",
        notification.toolCallId ? `<tool-use-id>${escapeXml(notification.toolCallId)}</tool-use-id>` : "",
        notification.outputFile ? `<output-file>${escapeXml(notification.outputFile)}</output-file>` : "",
        `<status>${escapeXml(notification.status)}</status>`,
        notification.agentType ? `<type>${escapeXml(notification.agentType)}</type>` : "",
        `<summary>${escapeXml(notification.description)}</summary>`,
        `<result>${escapeXml(notification.resultPreview)}</result>`,
        usage,
        "</task-notification>",
      ].filter(Boolean).join(""),
    ].join("\n"),
    details: entry.data,
    display: true,
  };
}

export function normalizeSubagentRecordsForContext(entries: SessionEntry[]): SessionEntry[] {
  const notifiedAgentIds = new Set<string>();
  for (const entry of entries) {
    const id = getSubagentNotificationId(entry);
    if (id) notifiedAgentIds.add(id);
  }

  return entries.map((entry) => {
    const recordId = getSubagentRecordId(entry);
    if (entry.type === "custom" && entry.customType === "subagents:record" && (!recordId || !notifiedAgentIds.has(recordId))) {
      return subagentRecordToCustomMessage(entry);
    }
    return entry;
  });
}
