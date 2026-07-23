import assert from "node:assert/strict";
import test from "node:test";

const { appendUniqueTab, closeInspectorTab } = await import("../components/app-shell/inspector-state.ts");
const {
  buildFluidMetrics,
  normalizeExplorerMentionPath,
  normalizeHeaderText,
  truncateFluidTitle,
  workspaceLabelFromCwd,
} = await import("../components/app-shell/helpers.ts");
const { reconcileWorkspaceSelection, sessionUrl } = await import("../components/app-shell/session-state.ts");

function session(id, cwd) {
  return { path: `/sessions/${id}.jsonl`, id, cwd, created: "2026-01-01", modified: "2026-01-01", messageCount: 1, firstMessage: id };
}

test("workspace changes preserve matching sessions and reset mismatched selections", () => {
  const current = session("current", "/workspace/a");
  assert.deepEqual(reconcileWorkspaceSelection(current, null, "/workspace/a"), {
    selectedSession: current,
    newSessionCwd: null,
    shouldReset: false,
  });
  assert.deepEqual(reconcileWorkspaceSelection(current, "/workspace/a", "/workspace/b"), {
    selectedSession: null,
    newSessionCwd: null,
    shouldReset: true,
  });
  assert.deepEqual(reconcileWorkspaceSelection(null, "/workspace/b", "/workspace/b"), {
    selectedSession: null,
    newSessionCwd: "/workspace/b",
    shouldReset: true,
  });
  assert.equal(reconcileWorkspaceSelection(current, null, "/workspace/b", true).shouldReset, false);
});

test("session URLs encode restored and selected identifiers", () => {
  assert.equal(sessionUrl(null), "/");
  assert.equal(sessionUrl("id with/slash"), "?session=id%20with%2Fslash");
});

test("inspector tabs de-duplicate and select the last remaining tab on close", () => {
  const first = { id: "file:/a", label: "a", kind: "file", filePath: "/a" };
  const second = { id: "browser:s1", label: "Browser", kind: "browser", agentSessionId: "s1", cwd: "/workspace" };
  const tabs = appendUniqueTab(appendUniqueTab([], first), second);
  assert.equal(appendUniqueTab(tabs, first), tabs);
  assert.deepEqual(closeInspectorTab(tabs, second.id, second.id), {
    tabs: [first],
    activeTabId: first.id,
    panelOpen: true,
  });
  assert.deepEqual(closeInspectorTab([first], first.id, first.id), {
    tabs: [],
    activeTabId: null,
    panelOpen: false,
  });
});

test("header and explorer helpers normalize cross-platform values", () => {
  assert.equal(normalizeHeaderText("  hello\n world  "), "hello world");
  assert.equal(truncateFluidTitle("x".repeat(60)).length, 42);
  assert.equal(workspaceLabelFromCwd("C:\\work\\project\\"), "project");
  assert.deepEqual(normalizeExplorerMentionPath("src/file.ts"), { path: "./src/file.ts", projectRelative: true });
  assert.deepEqual(normalizeExplorerMentionPath("C:\\work\\file.ts"), { path: "C:/work/file.ts", projectRelative: false });
});

test("fluid metrics preserve thresholds and compact values", () => {
  const result = buildFluidMetrics({ tokens: { input: 1_200, output: 20, cacheRead: 3_400, cacheWrite: 0 }, cost: 0.005 }, { percent: 91, contextWindow: 200_000, tokens: 182_000 }, {
    input: "Input", output: "Output", cacheRead: "Cache read", cacheWrite: "Cache write", cost: "Cost", context: "Context", unknown: "Unknown",
  });
  assert.deepEqual(result.metrics.map(({ key, value, tone }) => ({ key, value, tone })), [
    { key: "input", value: "1k", tone: undefined },
    { key: "output", value: "20", tone: undefined },
    { key: "cache", value: "3k", tone: "accent" },
    { key: "cost", value: "<$0.01", tone: undefined },
    { key: "context", value: "91% / 200k", tone: "danger" },
  ]);
});
