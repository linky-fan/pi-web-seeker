export type QuickChatRole = "user" | "assistant";

export interface QuickChatSource {
  title: string;
  url: string;
  snippet: string;
}

export interface QuickChatMessage {
  role: QuickChatRole;
  text: string;
  timestamp: number;
  sources?: QuickChatSource[];
}

export interface QuickChatModel {
  provider: string;
  modelId: string;
}

export const QUICK_CHAT_MAX_MESSAGES = 80;
export const QUICK_CHAT_MAX_MESSAGE_CHARS = 100_000;
export const QUICK_CHAT_MAX_TOTAL_CHARS = 400_000;
export const QUICK_CHAT_MAX_SOURCES = 5;
export const QUICK_CHAT_MAX_SOURCE_TITLE_CHARS = 240;
export const QUICK_CHAT_MAX_SOURCE_URL_CHARS = 2_048;
export const QUICK_CHAT_MAX_SOURCE_SNIPPET_CHARS = 1_200;

export class QuickChatValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "QuickChatValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseQuickChatSources(value: unknown, messageIndex: number): QuickChatSource[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > QUICK_CHAT_MAX_SOURCES) {
    throw new QuickChatValidationError(`Invalid sources for message ${messageIndex}`);
  }

  const seen = new Set<string>();
  const sources: QuickChatSource[] = [];
  for (const item of value) {
    if (!isRecord(item)) throw new QuickChatValidationError(`Invalid source for message ${messageIndex}`);
    const title = typeof item.title === "string" ? compactWhitespace(item.title) : "";
    const url = typeof item.url === "string" ? item.url.trim() : "";
    const snippet = typeof item.snippet === "string" ? compactWhitespace(item.snippet) : "";
    if (!title || title.length > QUICK_CHAT_MAX_SOURCE_TITLE_CHARS ||
        !url || url.length > QUICK_CHAT_MAX_SOURCE_URL_CHARS ||
        snippet.length > QUICK_CHAT_MAX_SOURCE_SNIPPET_CHARS) {
      throw new QuickChatValidationError(`Invalid source fields for message ${messageIndex}`);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new QuickChatValidationError(`Invalid source URL for message ${messageIndex}`);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new QuickChatValidationError(`Unsupported source URL for message ${messageIndex}`);
    }
    parsedUrl.hash = "";
    const normalizedUrl = parsedUrl.toString();
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    sources.push({ title, url: normalizedUrl, snippet });
  }
  return sources.length > 0 ? sources : undefined;
}

export function parseQuickChatMessages(value: unknown): QuickChatMessage[] {
  if (!Array.isArray(value)) throw new QuickChatValidationError("messages must be an array");
  if (value.length === 0) throw new QuickChatValidationError("messages cannot be empty");
  if (value.length > QUICK_CHAT_MAX_MESSAGES) {
    throw new QuickChatValidationError(`Too many messages (maximum ${QUICK_CHAT_MAX_MESSAGES})`, 413);
  }

  let totalChars = 0;
  const messages = value.map((item, index) => {
    if (!isRecord(item) || (item.role !== "user" && item.role !== "assistant")) {
      throw new QuickChatValidationError(`Invalid message at index ${index}`);
    }
    if (typeof item.text !== "string" || !item.text.trim()) {
      throw new QuickChatValidationError(`Message ${index} must contain text`);
    }
    if (item.text.length > QUICK_CHAT_MAX_MESSAGE_CHARS) {
      throw new QuickChatValidationError(`Message ${index} is too long`, 413);
    }
    const timestamp = typeof item.timestamp === "number" && Number.isFinite(item.timestamp)
      ? item.timestamp
      : Date.now();
    const sources = item.role === "assistant" ? parseQuickChatSources(item.sources, index) : undefined;
    if (item.role === "user" && item.sources !== undefined) {
      throw new QuickChatValidationError(`User message ${index} cannot contain sources`);
    }
    totalChars += item.text.length + (sources?.reduce((sum, source) => (
      sum + source.title.length + source.url.length + source.snippet.length
    ), 0) ?? 0);
    return { role: item.role as QuickChatRole, text: item.text, timestamp, ...(sources ? { sources } : {}) };
  });

  if (totalChars > QUICK_CHAT_MAX_TOTAL_CHARS) {
    throw new QuickChatValidationError("Conversation is too large", 413);
  }
  return messages;
}

export function parseQuickChatModel(value: unknown): QuickChatModel {
  if (!isRecord(value)) throw new QuickChatValidationError("Invalid request body");
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
  if (!provider || !modelId) throw new QuickChatValidationError("provider and modelId are required");
  return { provider, modelId };
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/([\\[\]])/g, "\\$1");
}

export function quickChatMessageTextForPromotion(message: QuickChatMessage): string {
  if (message.role !== "assistant" || !message.sources?.length) return message.text;
  const sources = message.sources.map((source, index) => (
    `${index + 1}. [${escapeMarkdownLabel(source.title)}](<${source.url}>)`
  ));
  return `${message.text}\n\n### 参考来源\n\n${sources.join("\n")}`;
}
