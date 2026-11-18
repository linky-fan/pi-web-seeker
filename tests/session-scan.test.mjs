import assert from "node:assert/strict";
import { appendFileSync, closeSync, mkdtempSync, openSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const {
  applySessionLine,
  emptyFileState,
  stateIsCurrent,
  toSessionInfo,
} = await import("../lib/session-scan.ts");

function headerLine(id, cwd = "/work", ts = "2026-01-01T00:00:00.000Z") {
  return JSON.stringify({ type: "session", version: 3, id, timestamp: ts, cwd });
}
function userLine(id, text, ts = 1000) {
  return JSON.stringify({ type: "message", id, parentId: null, timestamp: new Date(ts).toISOString(), message: { role: "user", content: text, timestamp: ts } });
}
function assistantLine(id, text, ts = 2000) {
  return JSON.stringify({ type: "message", id, parentId: null, timestamp: new Date(ts).toISOString(), message: { role: "assistant", content: [{ type: "text", text }], timestamp: ts } });
}

test("captures header, counts messages, and keeps the first user message", () => {
  const state = emptyFileState("/a.jsonl");
  applySessionLine(state, headerLine("s1"), "2026-01-01T00:00:00.000Z");
  applySessionLine(state, userLine("u1", "first question"), "2026-01-01T00:00:00.000Z");
  applySessionLine(state, assistantLine("a1", "reply"), "2026-01-01T00:00:00.000Z");
  applySessionLine(state, userLine("u2", "second question"), "2026-01-01T00:00:00.000Z");

  assert.equal(state.id, "s1");
  assert.equal(state.cwd, "/work");
  assert.equal(state.messageCount, 3);
  assert.equal(state.firstMessage, "first question");
  assert.equal(state.lastActivity, 2000);
});

test("a later session_info line renames the session", () => {
  const state = emptyFileState("/a.jsonl");
  applySessionLine(state, headerLine("s1"), "2026-01-01T00:00:00.000Z");
  applySessionLine(state, JSON.stringify({ type: "session_info", id: "i1", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", name: "Renamed" }), "2026-01-01T00:00:00.000Z");
  assert.equal(state.name, "Renamed");

  applySessionLine(state, JSON.stringify({ type: "session_info", id: "i2", parentId: "i1", timestamp: "2026-01-01T00:00:02.000Z", name: "" }), "2026-01-01T00:00:00.000Z");
  assert.equal(state.name, undefined, "an explicit clear removes the name");
});

test("malformed lines and unknown entry types are tolerated", () => {
  const state = emptyFileState("/a.jsonl");
  applySessionLine(state, headerLine("s1"), "2026-01-01T00:00:00.000Z");
  assert.equal(applySessionLine(state, "{not json", "2026-01-01T00:00:00.000Z"), true);
  assert.equal(applySessionLine(state, JSON.stringify({ type: "model_change", id: "m1", parentId: null, timestamp: "x" }), "2026-01-01T00:00:00.000Z"), true);
  assert.equal(state.messageCount, 0);
});

test("a line without a session id is rejected as a header", () => {
  const state = emptyFileState("/a.jsonl");
  assert.equal(applySessionLine(state, JSON.stringify({ type: "session", timestamp: "x" }), "2026-01-01T00:00:00.000Z"), false);
});

test("freshness requires identical size, mtime, and a fully consumed file", () => {
  const state = emptyFileState("/a.jsonl");
  state.size = 100;
  state.offset = 100;
  state.mtimeMs = 5;
  assert.equal(stateIsCurrent(state, 100, 5), true);
  assert.equal(stateIsCurrent(state, 120, 5), false, "appended bytes invalidate");
  assert.equal(stateIsCurrent(state, 100, 6), false, "mtime change invalidates");

  state.offset = 90;
  assert.equal(stateIsCurrent(state, 100, 5), false, "a pending partial line invalidates");
});

test("session info sorts by last activity and falls back to header time", () => {
  const state = emptyFileState("/a.jsonl");
  applySessionLine(state, headerLine("s1"), "2026-01-01T00:00:00.000Z");
  applySessionLine(state, userLine("u1", "hi", 5000), "2026-01-01T00:00:00.000Z");
  const info = toSessionInfo(state, 0);
  assert.equal(info.id, "s1");
  assert.equal(new Date(info.modified).getTime(), 5000);
  assert.equal(info.firstMessage, "hi");

  const empty = emptyFileState("/b.jsonl");
  applySessionLine(empty, headerLine("s2", "/other", "2026-02-02T00:00:00.000Z"), "2026-02-02T00:00:00.000Z");
  const info2 = toSessionInfo(empty, 0);
  assert.equal(info2.firstMessage, "(no messages)");
  assert.equal(info2.cwd, "/other");
});

test("incremental scanning appends only new lines to an existing state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-scan-"));
  const file = join(dir, "s.jsonl");
  try {
    writeFileSync(file, `${headerLine("s1")}\n${userLine("u1", "one")}\n`, "utf8");
    const state = emptyFileState(file);
    scanInto(state, file, 0, statSync(file).size);
    assert.equal(state.messageCount, 1);

    appendFileSync(file, `${assistantLine("a1", "two")}\n`, "utf8");
    scanInto(state, file, state.offset, statSync(file).size);
    assert.equal(state.messageCount, 2);
    assert.equal(state.firstMessage, "one");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Mirrors lib/session-index.ts scanRange for byte-range resumption.
function scanInto(state, path, from, to) {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(Math.max(1, to - from));
    const read = readSync(fd, buffer, 0, to - from, from);
    const text = state.pendingLine + buffer.subarray(0, read).toString("utf8");
    const lines = text.split("\n");
    state.pendingLine = lines.pop() ?? "";
    for (const line of lines) applySessionLine(state, line, "2026-01-01T00:00:00.000Z");
    state.offset = from + read;
  } finally {
    closeSync(fd);
  }
}