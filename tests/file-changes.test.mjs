import assert from "node:assert/strict";
import test from "node:test";

const {
  collectFileChanges,
  parseUnifiedDiff,
  diffStats,
  relativeChangePath,
} = await import("../lib/file-changes.ts");

function editCall(callId, path) {
  return {
    role: "assistant",
    content: [{ type: "toolCall", toolCallId: callId, toolName: "edit", input: { path, edits: [] } }],
  };
}

function editResult(callId, diff, isError = false) {
  return {
    role: "toolResult",
    toolCallId: callId,
    toolName: "edit",
    content: [{ type: "text", text: "ok" }],
    details: { diff },
    isError,
  };
}

test("collects a single edited file with its diff", () => {
  const changes = collectFileChanges([
    editCall("c1", "/work/a.ts"),
    editResult("c1", "-old\n+new"),
  ]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, "/work/a.ts");
  assert.equal(changes[0].diff, "-old\n+new");
  assert.equal(changes[0].entries.length, 1);
});

test("merges repeated edits to the same file and keeps the latest diff", () => {
  const changes = collectFileChanges([
    editCall("c1", "/work/a.ts"),
    editResult("c1", "-one\n+two"),
    editCall("c2", "/work/a.ts"),
    editResult("c2", "-two\n+three"),
  ]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].entries.length, 2);
  assert.equal(changes[0].diff, "-two\n+three");
});

test("separates distinct files and sorts them", () => {
  const changes = collectFileChanges([
    editCall("c1", "/work/z.ts"),
    editResult("c1", "-a\n+b"),
    editCall("c2", "/work/a.ts"),
    editResult("c2", "-c\n+d"),
  ]);
  assert.deepEqual(changes.map((c) => c.path), ["/work/a.ts", "/work/z.ts"]);
});

test("ignores non-editing tools", () => {
  const changes = collectFileChanges([
    { role: "assistant", content: [{ type: "toolCall", toolCallId: "c1", toolName: "bash", input: { command: "ls" } }] },
    { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [], details: { diff: "-x\n+y" } },
  ]);
  assert.equal(changes.length, 0);
});

test("records a failed edit without a diff", () => {
  const changes = collectFileChanges([
    editCall("c1", "/work/a.ts"),
    { role: "toolResult", toolCallId: "c1", toolName: "edit", content: [], isError: true },
  ]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].isError, true);
  assert.equal(changes[0].diff, "");
});

test("a result without a matching call is ignored", () => {
  const changes = collectFileChanges([editResult("missing", "-a\n+b")]);
  assert.equal(changes.length, 0);
});

test("parses unified diff into typed lines and drops file headers", () => {
  const lines = parseUnifiedDiff([
    "--- a/file.ts",
    "+++ b/file.ts",
    "@@ -1,2 +1,2 @@",
    " context",
    "-removed",
    "+added",
  ].join("\n"));
  assert.deepEqual(lines.map((l) => l.type), ["context", "context", "remove", "add"]);
  assert.equal(lines[0].text, "@@ -1,2 +1,2 @@");
  assert.equal(lines[1].text, "context");
  assert.equal(lines[2].text, "removed");
  assert.equal(lines[3].text, "added");
});

test("diff stats ignore file headers", () => {
  assert.deepEqual(diffStats("--- a/x\n+++ b/x\n-gone\n+kept\n+also"), { added: 2, removed: 1 });
  assert.deepEqual(diffStats(""), { added: 0, removed: 0 });
});

test("relative paths are shortened against the workspace root", () => {
  assert.equal(relativeChangePath("/work/src/a.ts", "/work"), "src/a.ts");
  assert.equal(relativeChangePath("C:\\work\\src\\a.ts", "C:\\work"), "src/a.ts");
  assert.equal(relativeChangePath("/other/a.ts", "/work"), "/other/a.ts");
  assert.equal(relativeChangePath("/work/a.ts", null), "/work/a.ts");
});