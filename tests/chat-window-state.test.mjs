import assert from "node:assert/strict";
import test from "node:test";

const {
  buildMessageProjection,
  buildPromptHistory,
  estimateMessageHeight,
  phaseLabel,
  shouldRenderMessageEagerly,
} = await import("../components/chat-window/messageProjection.ts");
const {
  normalizeCustomPanelLines,
  parseAnsiLine,
  stripAnsi,
  toTerminalKeyData,
} = await import("../components/chat-window/ansi.ts");
const {
  areComposerSurfacePropsEqual,
  areExtensionLayerPropsEqual,
  areHistoricalTimelinePropsEqual,
} = await import("../components/chat-window/memoComparators.ts");

function user(content, timestamp = 1_000) {
  return { role: "user", content, timestamp };
}

function assistant(text, timestamp = 2_000) {
  return { role: "assistant", content: [{ type: "text", text }], provider: "test", model: "model", timestamp };
}

function custom(customType, details, content = "") {
  return { role: "custom", customType, details, content, timestamp: 2_500 };
}

function toolResult(toolCallId, text) {
  return { role: "toolResult", toolCallId, content: [{ type: "text", text }], isError: false, timestamp: 3_000 };
}

test("message projection pairs tools, timestamps, history, and visible references", () => {
  const messages = [
    user("first"),
    assistant("one", 2_000),
    assistant("two", 3_000),
    user("second", 4_000),
    assistant("three", 5_000),
    toolResult("call-1", "done"),
    user(" first ", 6_000),
  ];
  const projection = buildMessageProjection(messages, false);
  assert.equal(projection.toolResultsMap.get("call-1")?.content[0].text, "done");
  assert.equal(projection.lastUserIdx, 6);
  assert.deepEqual(projection.showTimestamp, [false, false, true, false, true, false, false]);
  assert.equal(projection.visibleMessageCount, 6);
  assert.deepEqual(buildPromptHistory(messages), ["first", "second"]);
});

test("coms-net projection hides duplicate and explicit-response history without losing inferred replies", () => {
  const legacy = user('A coms-net peer named "reviewer" asked for help.\n\nRequest:\nCheck this diff\n\nAnswer the peer directly.');
  const inbound = custom("coms-net-inbound", { sender: { name: "reviewer" }, prompt: "Check this diff" });
  const inferredReply = assistant("Looks good");
  const projection = buildMessageProjection([legacy, inbound, inferredReply], false);
  assert.equal(projection.hiddenMessageIndexes.has(0), true);
  assert.deepEqual(projection.comsNetResponses.get(2), { peer: "reviewer", msgId: undefined });

  const explicitMessages = [
    custom("coms-net-inbound", { sender: { name: "peer" }, prompt: "Review", msg_id: "msg-1" }),
    assistant("Internal response"),
    custom("coms-net-response-sent", { target: { name: "peer" }, response: "Internal response", msg_id: "msg-1" }),
  ];
  const explicit = buildMessageProjection(explicitMessages, false);
  assert.equal(explicit.hiddenMessageIndexes.has(1), true);
  assert.equal(explicit.comsNetResponses.size, 0);

  const loopback = buildMessageProjection([
    custom("coms-net-response-sent", { msg_id: "loop" }),
    custom("coms-net-response-received", { msg_id: "loop" }),
  ], false);
  assert.deepEqual([...loopback.hiddenMessageIndexes], [0, 1]);
});

test("lazy rendering and height estimates preserve thresholds and bounds", () => {
  assert.equal(shouldRenderMessageEagerly(0, 59, 40, false), true);
  assert.equal(shouldRenderMessageEagerly(0, 60, 40, false), false);
  assert.equal(shouldRenderMessageEagerly(36, 60, 40, false), true);
  assert.equal(shouldRenderMessageEagerly(5, 60, 5, false), true);
  assert.equal(shouldRenderMessageEagerly(5, 60, 40, true), true);
  assert.equal(estimateMessageHeight(user("x")), 64);
  assert.equal(estimateMessageHeight(user("x".repeat(10_000))), 360);
  assert.equal(estimateMessageHeight({ role: "toolResult", toolCallId: "x", content: [], isError: false }), 1);
  assert.equal(phaseLabel({ kind: "running_tools", tools: [{ id: "1", name: "bash" }] }), "Running bash...");
  assert.equal(phaseLabel({ kind: "waiting_model" }), "Waiting for model...");
});

test("ANSI and terminal helpers preserve colors, Unicode, frames, and control keys", () => {
  const segments = parseAnsiLine("plain \x1b[31mred\x1b[0m \x1b[38;5;46mgreen\x1b[38;2;1;2;3mtrue");
  assert.deepEqual(segments.map((segment) => [segment.text, segment.style.color]), [
    ["plain ", undefined],
    ["red", "#dc2626"],
    [" ", undefined],
    ["green", "rgb(0, 255, 0)"],
    ["true", "rgb(1, 2, 3)"],
  ]);
  const backgrounds = parseAnsiLine("\x1b[44mstandard\x1b[48;5;196mindexed\x1b[48;2;4;5;6mtruecolor");
  assert.deepEqual(backgrounds.map((segment) => [segment.text, segment.style.backgroundColor]), [
    ["standard", "#2563eb"],
    ["indexed", "rgb(255, 0, 0)"],
    ["truecolor", "rgb(4, 5, 6)"],
  ]);
  assert.equal(stripAnsi("中\x1b[1m文\x1b[0m"), "中文");
  assert.deepEqual(normalizeCustomPanelLines(["┌──┐", "│ hello │", "└──┘"]), ["hello"]);
  assert.deepEqual(
    normalizeCustomPanelLines(["\x1b[36m┌────┐\x1b[0m", "\x1b[36m│ 你好 │\x1b[0m", "\x1b[36m└────┘\x1b[0m"]),
    ["\x1b[36m你好\x1b[0m"],
  );
  assert.equal(toTerminalKeyData({ key: "c", ctrlKey: true, metaKey: false, altKey: false }), "\x03");
  assert.equal(toTerminalKeyData({ key: "ArrowUp", ctrlKey: false, metaKey: false, altKey: false }), "\x1b[A");
  assert.equal(toTerminalKeyData({ key: "ArrowLeft", ctrlKey: false, metaKey: false, altKey: false }), "\x1b[D");
  assert.equal(toTerminalKeyData({ key: "x", ctrlKey: false, metaKey: false, altKey: false }), "x");
});

test("memo boundaries ignore live output while observing their owned state", () => {
  const stable = {};
  const callback = () => {};
  const timeline = {
    messages: stable, entryIds: stable, projection: stable, scrollRoot: stable, messageRefs: stable,
    lastUserMsgRef: stable, runningToolIds: stable, toolExecutionStatuses: stable, modelNames: stable,
    agentRunning: true, isNew: false, forkingEntryId: null, onFork: callback, onNavigate: callback, onEditContent: callback,
  };
  assert.equal(areHistoricalTimelinePropsEqual(timeline, { ...timeline, streamingMessage: { content: "token" } }), true);
  assert.equal(areHistoricalTimelinePropsEqual(timeline, { ...timeline, toolExecutionStatuses: new Map() }), false);

  const composer = { empty: false, isFluid: true, activeCwd: "/tmp", inputRef: stable, inputProps: stable, aboveWidgets: stable, belowWidgets: stable };
  assert.equal(areComposerSurfacePropsEqual(composer, { ...composer, streamingMessage: "token" }), true);
  assert.equal(areComposerSurfacePropsEqual(composer, { ...composer, inputProps: {} }), false);

  const extension = { statuses: stable, notices: stable, dialog: null, customUi: null, onRespond: callback, onCustomInput: callback };
  assert.equal(areExtensionLayerPropsEqual(extension, { ...extension, streamingMessage: "token" }), true);
  assert.equal(areExtensionLayerPropsEqual(extension, { ...extension, notices: [] }), false);
});
