import type {
  AgentMessage,
  AssistantContentBlock,
  SessionContext,
  SessionEntry,
  SessionHeader,
  SessionInfo,
} from "./types";

type SessionExportInfo = Omit<SessionInfo, "path">;

interface SessionExportData {
  sessionId: string;
  info: SessionExportInfo | null;
  header: SessionHeader | null;
  leafId: string | null;
  context: SessionContext;
  entries: SessionEntry[];
  exportedAt: string;
}

function sanitizeFilePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "session";
}

function timestampForFile(value: string): string {
  return value.replace(/[:.]/g, "-");
}

export function sessionExportFilename(data: SessionExportData, extension: "md" | "json"): string {
  const title = data.info?.name || data.info?.firstMessage || data.sessionId;
  const created = data.info?.created || data.header?.timestamp || data.exportedAt;
  return `pi-session-${sanitizeFilePart(title)}-${timestampForFile(created)}.${extension}`;
}

function textFromContent(content: AgentMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "image") return block.source.url ? `[image: ${block.source.url}]` : "[image]";
    return "";
  }).filter(Boolean).join("\n\n");
}

function assistantBlockToMarkdown(block: AssistantContentBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "thinking") return `> Thinking\n>\n${block.thinking.split("\n").map((line) => `> ${line}`).join("\n")}`;
  if (block.type === "toolCall") {
    const input = JSON.stringify(block.input, null, 2);
    return [
      `Tool call: \`${block.toolName}\``,
      "",
      "```json",
      input,
      "```",
    ].join("\n");
  }
  if (block.type === "image") return block.source.url ? `![image](${block.source.url})` : "[image]";
  return "";
}

function messageToMarkdown(message: AgentMessage, index: number): string {
  const title = `## ${index + 1}. ${message.role}`;
  const timestamp = message.timestamp ? `\n\n_${new Date(message.timestamp).toISOString()}_` : "";

  if (message.role === "assistant") {
    const body = message.content.map(assistantBlockToMarkdown).filter(Boolean).join("\n\n");
    const model = message.provider && message.model ? `\n\n_Model: ${message.provider}/${message.model}_` : "";
    return `${title}${timestamp}${model}\n\n${body || "_No visible content._"}`;
  }

  if (message.role === "toolResult") {
    const content = textFromContent(message.content);
    return `${title}${timestamp}\n\nTool result: \`${message.toolName ?? message.toolCallId}\`${message.isError ? " (error)" : ""}\n\n${content || "_No visible content._"}`;
  }

  if (message.role === "custom") {
    const content = textFromContent(message.content);
    return `${title}${timestamp}\n\nType: \`${message.customType}\`\n\n${content || "_No visible content._"}`;
  }

  return `${title}${timestamp}\n\n${textFromContent(message.content) || "_No visible content._"}`;
}

export function buildMarkdownSessionExport(data: SessionExportData): string {
  const title = data.info?.name || data.info?.firstMessage || data.sessionId;
  const lines = [
    `# ${title}`,
    "",
    `- Session: \`${data.sessionId}\``,
    data.info?.cwd ? `- Workspace: \`${data.info.cwd}\`` : null,
    data.info?.created ? `- Created: ${data.info.created}` : null,
    data.info?.modified ? `- Modified: ${data.info.modified}` : null,
    `- Exported: ${data.exportedAt}`,
    data.leafId ? `- Leaf: \`${data.leafId}\`` : null,
    "",
    "---",
    "",
    ...data.context.messages.map(messageToMarkdown),
    "",
  ];

  return lines.filter((line): line is string => line !== null).join("\n");
}

export function buildJsonSessionExport(data: SessionExportData): string {
  return JSON.stringify({
    sessionId: data.sessionId,
    info: data.info,
    header: data.header,
    leafId: data.leafId,
    exportedAt: data.exportedAt,
    context: data.context,
    entries: data.entries,
  }, null, 2);
}
