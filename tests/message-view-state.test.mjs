import assert from "node:assert/strict";
import test from "node:test";

const {
  areMessageViewPropsEqual,
  estimateBlockChars,
  formatDurationBrief,
  formatDurationMs,
  formatToolInput,
  getToolPreview,
  messageToolCallIds,
  parseComsNetMessage,
  parseComsNetToolCall,
  parseLegacyComsNetUserMessage,
  toolResultText,
  toolTimeoutSeconds,
} = await import("../components/message-view/helpers.ts");

function assistantMessage(content) {
  return { role: "assistant", content, provider: "test", model: "model", timestamp: 2_000 };
}

function toolResult(toolCallId, text, isError = false) {
  return {
    role: "toolResult",
    toolCallId,
    content: [{ type: "text", text }],
    isError,
    timestamp: 3_000,
  };
}

test("message formatting and tool helpers preserve display semantics", () => {
  assert.equal(formatDurationMs(999), "999ms");
  assert.equal(formatDurationMs(61_000), "1m 1s");
  assert.equal(formatDurationBrief(3_661), "1h 1m");
  assert.equal(toolTimeoutSeconds({ timeout_ms: 30_000 }), 30);
  assert.equal(toolTimeoutSeconds({ timeout: "45" }), 45);
  assert.equal(toolTimeoutSeconds({ timeout: -1 }), null);
  assert.equal(getToolPreview({ type: "toolCall", toolCallId: "a", toolName: "bash", input: { command: "uname -a" } }), "uname -a");

  const circular = {};
  circular.self = circular;
  assert.equal(formatToolInput(circular), "[object Object]");
  assert.equal(estimateBlockChars({ type: "thinking", thinking: "1234" }), 4);
});

test("tool results and coms-net payloads are paired without trusting malformed details", () => {
  const result = toolResult("call-1", "hello");
  assert.equal(toolResultText(result), "hello");
  assert.equal(toolResultText(undefined), null);

  const send = parseComsNetToolCall({
    type: "toolCall",
    toolCallId: "call-1",
    toolName: "coms_net_send",
    input: { target: "peer-a", prompt: "review" },
  }, toolResult("call-1", JSON.stringify({ msg_id: "msg-1", status: "sent" })));
  assert.deepEqual(send, {
    direction: "outbound",
    title: "Sent coms-net request",
    peer: "peer-a",
    prompt: "review",
    msgId: "msg-1",
    status: "sent",
    error: null,
  });

  assert.equal(parseComsNetMessage("unrelated", "text", {}), null);
  assert.equal(parseComsNetMessage("coms-net-inbound", "fallback", { sender: { name: "peer-b" }, prompt: "task" })?.peer, "peer-b");
  assert.equal(parseComsNetMessage("coms-net-response-received", "", { error: "failed" })?.title, "coms-net response failed");
});

test("legacy coms-net user messages remain compatible", () => {
  const event = parseLegacyComsNetUserMessage({
    role: "user",
    content: "A coms-net peer named \"reviewer\" asked for help.\n\nRequest:\nCheck this diff\n\nAnswer the peer directly.",
  });
  assert.equal(event?.peer, "reviewer");
  assert.equal(event?.prompt, "Check this diff");
});

test("message memoization observes only tool state referenced by the current message", () => {
  const call = { type: "toolCall", toolCallId: "call-1", toolName: "bash", input: { command: "pwd" } };
  const message = assistantMessage([{ type: "text", text: "before" }, call]);
  assert.deepEqual(messageToolCallIds(message), ["call-1"]);

  const relatedResult = toolResult("call-1", "/tmp");
  const base = {
    message,
    toolResults: new Map([["call-1", relatedResult]]),
    runningToolIds: new Set(),
    toolExecutionStatuses: new Map(),
    showTimestamp: true,
  };
  const unrelatedChanges = {
    ...base,
    toolResults: new Map([["call-1", relatedResult], ["other", toolResult("other", "changed")]]),
    runningToolIds: new Set(["other"]),
    toolExecutionStatuses: new Map([["other", { outputText: "changed", startedAt: 1, updatedAt: 2 }]]),
  };
  assert.equal(areMessageViewPropsEqual(base, unrelatedChanges), true);

  assert.equal(areMessageViewPropsEqual(base, {
    ...base,
    toolResults: new Map([["call-1", toolResult("call-1", "new value")]]),
  }), false);
  assert.equal(areMessageViewPropsEqual(base, { ...base, runningToolIds: new Set(["call-1"]) }), false);
  assert.equal(areMessageViewPropsEqual(base, {
    ...base,
    toolExecutionStatuses: new Map([["call-1", { outputText: "live", startedAt: 1, updatedAt: 2 }]]),
  }), false);
  assert.equal(areMessageViewPropsEqual(base, { ...base, showTimestamp: false }), false);
  assert.equal(areMessageViewPropsEqual(base, { ...base, message: assistantMessage([{ type: "text", text: "after" }, call]) }), false);
});
