export type QuickChatRole = "user" | "assistant";

export interface QuickChatMessage {
  role: QuickChatRole;
  text: string;
  timestamp: number;
}

export interface QuickChatModel {
  provider: string;
  modelId: string;
}

export const QUICK_CHAT_MAX_MESSAGES = 80;
export const QUICK_CHAT_MAX_MESSAGE_CHARS = 100_000;
export const QUICK_CHAT_MAX_TOTAL_CHARS = 400_000;

export class QuickChatValidationError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "QuickChatValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
    totalChars += item.text.length;
    return { role: item.role as QuickChatRole, text: item.text, timestamp };
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
