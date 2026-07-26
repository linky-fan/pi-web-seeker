import assert from "node:assert/strict";
import test from "node:test";

const {
  BUDDY_MODE_STORAGE_PREFIX,
  PLAN_MODE_STORAGE_PREFIX,
  appendCompletedMessage,
  calculateSessionStats,
  isLifecycleTokenCurrent,
  isOperationCurrent,
  noticeReducer,
  sessionStorageKey,
  shouldFollowScroll,
  streamReducer,
  textFromToolPartial,
  updateToolStatus,
  userMessagesMatch,
} = await import("../hooks/agent-session/helpers.ts");

function user(content) {
  return { role: "user", content, timestamp: 1_000 };
}

function assistant(text, usage) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "test",
    model: "model",
    usage,
    timestamp: 2_000,
  };
}

test("completed messages deduplicate optimistic users and repeated subagent events", () => {
  const optimistic = user("  hello  ");
  assert.equal(userMessagesMatch(optimistic, user("hello")), true);
  assert.deepEqual(appendCompletedMessage([optimistic], user("hello")), [optimistic]);

  const subagent = {
    role: "custom",
    customType: "subagent-notification",
    content: "done",
    details: { taskId: "task-1", status: "completed" },
    timestamp: 3_000,
  };
  const once = appendCompletedMessage([], subagent);
  assert.equal(appendCompletedMessage(once, { ...subagent }).length, 1);
});

test("statistics and tool partial helpers preserve accumulated runtime state", () => {
  const stats = calculateSessionStats([
    user("question"),
    assistant("answer", {
      input: 10,
      output: 20,
      cacheRead: 3,
      cacheWrite: 2,
      cost: { total: 0.125 },
    }),
  ]);
  assert.deepEqual(stats, {
    tokens: { input: 10, output: 20, cacheRead: 3, cacheWrite: 2 },
    cost: 0.125,
  });
  assert.equal(textFromToolPartial({ content: [{ type: "text", text: "one" }, { type: "text", text: "two" }] }), "one\ntwo");
  const started = updateToolStatus(new Map(), "call-1", "bash", "", 100);
  const updated = updateToolStatus(started, "call-1", "", "output", 200);
  assert.deepEqual(updated.get("call-1"), {
    id: "call-1", name: "bash", startedAt: 100, updatedAt: 200, outputText: "output",
  });
});

test("stream and notice transitions retain existing public semantics", () => {
  const started = streamReducer({ isStreaming: false, streamingMessage: null }, { type: "start" });
  const updated = streamReducer(started, { type: "update", message: assistant("token") });
  assert.equal(updated.isStreaming, true);
  assert.equal(updated.streamingMessage.content[0].text, "token");
  assert.deepEqual(streamReducer(updated, { type: "end" }), { isStreaming: false, streamingMessage: null });

  let notices = { visible: [] };
  for (let index = 0; index < 6; index += 1) {
    notices = noticeReducer(notices, { type: "add", notice: { id: `n${index}`, message: `${index}`, type: "info" } });
  }
  assert.deepEqual(notices.visible.map((notice) => notice.id), ["n2", "n3", "n4", "n5"]);
  assert.equal(noticeReducer(notices, { type: "dismiss", id: "n4" }).visible.some((notice) => notice.id === "n4"), false);
});

test("preference keys preserve session and cwd ownership", () => {
  assert.equal(sessionStorageKey(PLAN_MODE_STORAGE_PREFIX, "session-1", "/tmp/work"), "pi-web.planMode:session:session-1");
  assert.equal(sessionStorageKey(BUDDY_MODE_STORAGE_PREFIX, null, "/tmp/work"), "pi-web.buddyMode:cwd:/tmp/work");
  assert.equal(sessionStorageKey(PLAN_MODE_STORAGE_PREFIX, null, null), null);
});

test("stale lifecycle, session, and operation responses are rejected", () => {
  const current = { generation: 4, identity: "session:new" };
  assert.equal(isLifecycleTokenCurrent({ generation: 3, identity: "session:old" }, current), false);
  assert.equal(isLifecycleTokenCurrent(current, current, "new", "new"), true);
  assert.equal(isLifecycleTokenCurrent(current, current, "old", "new"), false);
  assert.equal(isOperationCurrent(2, 3, "session-1", "session-1"), false);
  assert.equal(isOperationCurrent(3, 3, "session-1", "session-2"), false);
  assert.equal(isOperationCurrent(3, 3, "session-2", "session-2"), true);
});

test("scroll following stops outside the threshold and resumes near the bottom", () => {
  assert.equal(shouldFollowScroll(0), true);
  assert.equal(shouldFollowScroll(140), true);
  assert.equal(shouldFollowScroll(141), false);
  assert.equal(shouldFollowScroll(-20), true);
});
