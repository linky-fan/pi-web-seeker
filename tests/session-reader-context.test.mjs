import assert from "node:assert/strict";
import test from "node:test";

const { buildSessionContext, calculateSessionUsage } = await import("../lib/session-reader.ts");

const stamp = () => new Date().toISOString();
const user = (id, parentId, content) => ({
  type: "message", id, parentId, timestamp: stamp(),
  message: { role: "user", content, timestamp: 1 },
});
const assistant = (id, parentId, text) => ({
  type: "message", id, parentId, timestamp: stamp(),
  message: { role: "assistant", content: [{ type: "text", text }], provider: "p", model: "m", timestamp: 2 },
});

test("context edits keep messages aligned with their source entry ids", () => {
  const entries = [
    user("u1", null, "first"),
    assistant("a1", "u1", "reply one"),
    user("u2", "a1", "second"),
    { type: "context_edit", id: "e1", parentId: "u2", timestamp: stamp(), targetId: "a1", replacement: null },
    assistant("a2", "e1", "reply two"),
  ];
  const context = buildSessionContext(entries, "a2");
  assert.equal(context.messages.length, context.entryIds.length);
  assert.deepEqual(context.entryIds, ["u1", "u2", "a2"]);
  assert.equal(context.messages.some((message) => JSON.stringify(message).includes("reply one")), false);
});

test("context edits replace content but keep the target entry id", () => {
  const entries = [
    user("u1", null, "first"),
    assistant("a1", "u1", "original reply"),
    { type: "context_edit", id: "e1", parentId: "a1", timestamp: stamp(), targetId: "a1", replacement: { content: "redacted" } },
    user("u2", "e1", "follow-up"),
  ];
  const context = buildSessionContext(entries, "u2");
  assert.equal(context.messages.length, context.entryIds.length);
  assert.deepEqual(context.entryIds, ["u1", "a1", "u2"]);
  assert.equal(JSON.stringify(context.messages[1]).includes("redacted"), true);
  assert.equal(JSON.stringify(context.messages[1]).includes("original reply"), false);
});

test("compaction summaries keep messages aligned with their source entry ids", () => {
  const entries = [
    user("u1", null, "one"),
    assistant("a1", "u1", "r1"),
    user("u2", "a1", "two"),
    assistant("a2", "u2", "r2"),
    {
      type: "compaction", id: "c1", parentId: "a2", timestamp: stamp(),
      summary: "summary text", tokensBefore: 100, firstKeptEntryId: "u2",
    },
    user("u3", "c1", "three"),
    assistant("a3", "u3", "r3"),
  ];
  const context = buildSessionContext(entries, "a3");
  assert.equal(context.messages.length, context.entryIds.length);
  assert.deepEqual(context.entryIds, ["c1", "u2", "a2", "u3", "a3"]);
});

test("session usage aggregates compacted history, summaries, and standalone usage entries", () => {
  const usage = (input, output) => ({
    input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: input / 1000 },
  });
  const entries = [
    user("u1", null, "one"),
    { ...assistant("a1", "u1", "r1"), message: { ...assistant("a1", "u1", "r1").message, usage: usage(100, 20) } },
    {
      type: "compaction", id: "c1", parentId: "a1", timestamp: stamp(),
      summary: "summary", tokensBefore: 50, firstKeptEntryId: null, usage: usage(30, 10),
    },
    { type: "usage", id: "x1", parentId: "c1", timestamp: stamp(), usage: usage(5, 5) },
  ];
  assert.deepEqual(calculateSessionUsage(entries), {
    tokens: { input: 135, output: 35, cacheRead: 0, cacheWrite: 0 },
    cost: 0.135,
  });
  assert.equal(calculateSessionUsage([]), null);
});
