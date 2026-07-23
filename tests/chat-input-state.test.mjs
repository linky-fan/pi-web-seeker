import assert from "node:assert/strict";
import test from "node:test";

const {
  buildModelGroups,
  getContextTone,
  getDraftStorageKey,
  getMentionQuery,
  isLikelyFilePath,
  mergeHistory,
  navigateHistory,
  visibleThinkingLevels,
} = await import("../components/chat-input/helpers.ts");

test("history merges newest entries, removes duplicates, and preserves the draft while browsing", () => {
  const history = mergeHistory([" latest ", "same", ""], ["same", ...Array.from({ length: 60 }, (_, index) => `item-${index}`)]);
  assert.deepEqual(history.slice(0, 3), ["latest", "same", "item-0"]);
  assert.equal(history.length, 50);

  const up = navigateHistory(["new", "old"], null, "", "working draft", "ArrowUp", true, false);
  assert.deepEqual(up, { index: 0, value: "new", draftBeforeHistory: "working draft" });
  const older = navigateHistory(["new", "old"], up.index, up.draftBeforeHistory, up.value, "ArrowUp", true, false);
  assert.deepEqual(older, { index: 1, value: "old", draftBeforeHistory: "working draft" });
  const newer = navigateHistory(["new", "old"], older.index, older.draftBeforeHistory, older.value, "ArrowDown", false, true);
  const restored = navigateHistory(["new", "old"], newer.index, newer.draftBeforeHistory, newer.value, "ArrowDown", false, true);
  assert.equal(restored.value, "working draft");
  assert.equal(restored.index, null);
  assert.equal(navigateHistory(["new"], null, "", "middle", "ArrowUp", false, false), null);
});

test("draft keys remain scoped to the formal session or new workspace", () => {
  assert.equal(getDraftStorageKey(), "pi-web.chat.draft");
  assert.equal(getDraftStorageKey("session:abc"), "pi-web.chat.draft:session:abc");
  assert.notEqual(getDraftStorageKey("session:a"), getDraftStorageKey("session:b"));
});

test("mention and pasted-path parsing keep their existing boundaries", () => {
  assert.deepEqual(getMentionQuery("open @src/com", 13), { start: 5, end: 13, query: "src/com" });
  assert.equal(getMentionQuery("mail@example", 12), null);
  assert.equal(getMentionQuery("@src file", 9), null);
  assert.equal(isLikelyFilePath("./src/file.ts"), true);
  assert.equal(isLikelyFilePath("C:\\work\\file.ts"), true);
  assert.equal(isLikelyFilePath("https://example.com/file.ts"), false);
  assert.equal(isLikelyFilePath("ordinary words"), false);
});

test("model grouping preserves provider order and fallback names", () => {
  const configured = buildModelGroups([
    { provider: "alpha", id: "a1", name: "A1" },
    { provider: "beta", id: "b1", name: "B1" },
    { provider: "alpha", id: "a2", name: "A2" },
  ], undefined, "fallback");
  assert.deepEqual(configured.groups.map((group) => [group.provider, group.options.map((option) => option.modelId)]), [
    ["alpha", ["a1", "a2"]],
    ["beta", ["b1"]],
  ]);
  assert.deepEqual(buildModelGroups(undefined, { one: "One" }, "provider").options[0], { provider: "provider", modelId: "one", name: "One" });
});

test("thinking max remains capability-gated and context tones preserve thresholds", () => {
  assert.equal(visibleThinkingLevels(undefined).includes("max"), false);
  assert.equal(visibleThinkingLevels(["off", "high", "max"]).includes("max"), true);
  assert.deepEqual(visibleThinkingLevels(["off", "high", "max"]), ["auto", "off", "high", "max"]);
  assert.equal(getContextTone({ percent: 95, contextWindow: 100, tokens: null }, null).color, "#ef4444");
  assert.equal(getContextTone({ percent: null, contextWindow: 1_000_000, tokens: 920_000 }, { modelId: "deepseek-v4" }).color, "rgba(234,179,8,0.98)");
  assert.equal(getContextTone({ percent: null, contextWindow: 512_000, tokens: 512_000 }, { modelId: "other" }).color, "#ef4444");
});
