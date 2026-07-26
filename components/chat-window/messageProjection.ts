import type {
  AgentMessage,
  AssistantMessage,
  CustomMessage,
  TextContent,
  ToolCallContent,
  ToolResultMessage,
} from "@/lib/types";
import type { AgentPhase } from "@/hooks/useAgentSession";
import type { ComsNetResponseHint } from "../MessageView";

export const LAZY_RECENT_MESSAGE_COUNT = 24;
export const LAZY_MESSAGE_THRESHOLD = 60;

interface ComsNetInboundHint {
  peer: string;
  prompt: string;
  msgId?: string;
}

interface ComsNetResponseSentHint {
  msgId: string;
  index: number;
}

export interface MessageProjection {
  toolResultsMap: Map<string, ToolResultMessage>;
  lastUserIdx: number;
  showTimestamp: boolean[];
  hiddenMessageIndexes: Set<number>;
  comsNetResponses: Map<number, ComsNetResponseHint>;
  visibleMessageCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function userMessageText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") return message.content.trim() || null;
  const text = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text || null;
}

export function buildPromptHistory(messages: AgentMessage[], limit = 50): string[] {
  const seen = new Set<string>();
  const history: string[] = [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const text = userMessageText(messages[index]);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    history.push(text);
    if (history.length >= limit) break;
  }
  return history;
}

function normalizeComsNetText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function comsNetInboundKey(hint: ComsNetInboundHint): string {
  return `${hint.peer}\n${normalizeComsNetText(hint.prompt)}`;
}

function extractComsNetInbound(message: AgentMessage): ComsNetInboundHint | null {
  if (message.role === "custom") {
    const custom = message as CustomMessage;
    if (custom.customType !== "coms-net-inbound") return null;
    const details = isRecord(custom.details) ? custom.details : {};
    const sender = isRecord(details.sender) ? details.sender : {};
    const content = typeof custom.content === "string"
      ? custom.content
      : custom.content.filter((part): part is TextContent => part.type === "text").map((part) => part.text).join("\n");
    return {
      peer: stringValue(sender.name) ?? "peer",
      prompt: stringValue(details.prompt) ?? content.replace(/^coms-net request from [\s\S]*?:\s*/, "").trim(),
      msgId: stringValue(details.msg_id),
    };
  }

  const content = userMessageText(message);
  if (!content) return null;
  const match = content.match(/^A coms-net peer named "([^"]+)" asked for help\.\n\nRequest:\n([\s\S]*?)\n\nAnswer the peer directly\./);
  return match ? { peer: match[1], prompt: match[2].trim() } : null;
}

function extractComsNetResponseSent(message: AgentMessage, index: number): ComsNetResponseSentHint | null {
  if (message.role !== "custom") return null;
  const custom = message as CustomMessage;
  if (custom.customType !== "coms-net-response-sent") return null;
  const details = isRecord(custom.details) ? custom.details : {};
  const msgId = stringValue(details.msg_id);
  return msgId ? { msgId, index } : null;
}

function comsNetCustomMsgId(message: AgentMessage, customType?: string): string | undefined {
  if (message.role !== "custom") return undefined;
  const custom = message as CustomMessage;
  if (!custom.customType.startsWith("coms-net-") || (customType && custom.customType !== customType)) return undefined;
  const details = isRecord(custom.details) ? custom.details : {};
  return stringValue(details.msg_id);
}

function isComsNetResponseSent(message: AgentMessage): boolean {
  return message.role === "custom" && (message as CustomMessage).customType === "coms-net-response-sent";
}

function assistantResponseText(message: AgentMessage): string {
  if (message.role !== "assistant") return "";
  return (message as AssistantMessage).content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function assistantOnlyCallsComsNetTool(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return (message as AssistantMessage).content.some(
    (part): part is ToolCallContent => part.type === "toolCall" && part.toolName.startsWith("coms_net_"),
  );
}

export function buildMessageProjection(messages: AgentMessage[], isStreaming: boolean): MessageProjection {
  const toolResultsMap = new Map<string, ToolResultMessage>();
  const showTimestamp = new Array<boolean>(messages.length).fill(false);
  const hiddenMessageIndexes = new Set<number>();
  const comsNetResponses = new Map<number, ComsNetResponseHint>();
  const customInboundKeys = new Set<string>();
  const inboundIndexByMsgId = new Map<string, number>();
  const responseSentByMsgId = new Map<string, ComsNetResponseSentHint>();
  const responseReceivedMsgIds = new Set<string>();

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const inbound = extractComsNetInbound(message);
    if (message.role === "custom" && inbound) {
      customInboundKeys.add(comsNetInboundKey(inbound));
      if (inbound.msgId) inboundIndexByMsgId.set(inbound.msgId, index);
    }
    const responseSent = extractComsNetResponseSent(message, index);
    if (responseSent) responseSentByMsgId.set(responseSent.msgId, responseSent);
    const receivedId = comsNetCustomMsgId(message, "coms-net-response-received");
    if (receivedId) responseReceivedMsgIds.add(receivedId);
  }

  const loopbackMsgIds = new Set([...responseSentByMsgId.keys()].filter((id) => responseReceivedMsgIds.has(id)));
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    const anyMsgId = comsNetCustomMsgId(message);
    if (anyMsgId && loopbackMsgIds.has(anyMsgId)) hiddenMessageIndexes.add(index);
    if (message.role === "user") {
      const inbound = extractComsNetInbound(message);
      if (inbound && customInboundKeys.has(comsNetInboundKey(inbound))) hiddenMessageIndexes.add(index);
    }
    const receivedId = comsNetCustomMsgId(message, "coms-net-response-received");
    if (receivedId && responseSentByMsgId.has(receivedId)) hiddenMessageIndexes.add(index);
  }

  for (const [msgId, responseSent] of responseSentByMsgId) {
    const inboundIndex = inboundIndexByMsgId.get(msgId);
    if (inboundIndex === undefined) continue;
    for (let index = inboundIndex + 1; index < responseSent.index; index++) {
      if (messages[index].role === "assistant" && assistantResponseText(messages[index])) hiddenMessageIndexes.add(index);
    }
  }

  let pendingInbound: ComsNetInboundHint | null = null;
  let inferredResponseIdx: number | null = null;
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (hiddenMessageIndexes.has(index)) continue;
    const inbound = extractComsNetInbound(message);
    if (inbound) {
      if (inbound.msgId && responseSentByMsgId.has(inbound.msgId)) {
        pendingInbound = null;
        inferredResponseIdx = null;
        continue;
      }
      pendingInbound = inbound;
      inferredResponseIdx = null;
      continue;
    }
    if (isComsNetResponseSent(message)) {
      if (inferredResponseIdx !== null) comsNetResponses.delete(inferredResponseIdx);
      pendingInbound = null;
      inferredResponseIdx = null;
      continue;
    }
    if (message.role === "user") {
      pendingInbound = null;
      inferredResponseIdx = null;
      continue;
    }
    if (pendingInbound && message.role === "assistant" && assistantResponseText(message)) {
      comsNetResponses.set(index, { peer: pendingInbound.peer, msgId: pendingInbound.msgId });
      inferredResponseIdx = index;
      pendingInbound = null;
      continue;
    }
    if (pendingInbound && message.role === "assistant" && !assistantOnlyCallsComsNetTool(message)) {
      pendingInbound = null;
      inferredResponseIdx = null;
    }
  }

  let lastUserIdx = -1;
  let seenAssistantSinceUser = false;
  let visibleMessageCount = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (hiddenMessageIndexes.has(index)) continue;
    const message = messages[index];
    if (message.role === "toolResult") toolResultsMap.set(message.toolCallId, message as ToolResultMessage);
    if (message.role === "user" || message.role === "assistant") visibleMessageCount++;
    if (lastUserIdx < 0 && message.role === "user") lastUserIdx = index;
    if (message.role === "user") seenAssistantSinceUser = false;
    else if (message.role === "assistant") {
      showTimestamp[index] = !seenAssistantSinceUser;
      seenAssistantSinceUser = true;
    }
  }
  if (isStreaming && messages.length > 0) showTimestamp[messages.length - 1] = false;

  return { toolResultsMap, lastUserIdx, showTimestamp, hiddenMessageIndexes, comsNetResponses, visibleMessageCount };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateTextHeight(text: string, base: number): number {
  return base + Math.max(text.split("\n").length, Math.ceil(text.length / 90)) * 20;
}

export function estimateMessageHeight(message: AgentMessage): number {
  if (message.role === "user") {
    if (typeof message.content === "string") return clampNumber(estimateTextHeight(message.content, 44), 54, 360);
    const text = message.content.filter((block): block is TextContent => block.type === "text").map((block) => block.text).join("\n");
    const imageCount = message.content.filter((block) => block.type === "image").length;
    return clampNumber(estimateTextHeight(text, 44) + imageCount * 132, 76, 520);
  }
  if (message.role === "assistant") {
    let textLength = 0;
    let textLines = 0;
    let extraBlocks = 0;
    for (const block of message.content ?? []) {
      if (block.type === "text") {
        textLength += block.text?.length ?? 0;
        textLines += (block.text ?? "").split("\n").length;
      } else extraBlocks++;
    }
    return clampNumber(54 + Math.max(textLines, Math.ceil(textLength / 90)) * 22 + extraBlocks * 76, 70, 640);
  }
  if (message.role === "custom") {
    return clampNumber(estimateTextHeight(typeof message.content === "string" ? message.content : "", 54), 70, 420);
  }
  return 1;
}

export function shouldRenderMessageEagerly(index: number, messageCount: number, lastUserIdx: number, isForking: boolean): boolean {
  return messageCount < LAZY_MESSAGE_THRESHOLD
    || index >= messageCount - LAZY_RECENT_MESSAGE_COUNT
    || index === lastUserIdx
    || isForking;
}

export function phaseLabel(phase: AgentPhase): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((tool) => tool.name);
    if (names.length === 0) return "Running tool...";
    if (names.length === 1) return `Running ${names[0]}...`;
    if (names.length <= 3) return `Running ${names.join(", ")}...`;
    return `Running ${names.slice(0, 2).join(", ")} (+${names.length - 2})...`;
  }
  return phase?.kind === "waiting_model" ? "Waiting for model..." : "Thinking...";
}
