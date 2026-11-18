import assert from "node:assert/strict";
import test from "node:test";

const { applyHeaderEdit, isCustomApiProtocol, KNOWN_API_PROTOCOLS } = await import("../lib/provider-config.ts");

test("adding a header appends an empty editable row", () => {
  const next = applyHeaderEdit(undefined, {});
  // An empty key is dropped, so the map stays empty until the user types a name.
  assert.equal(next, undefined);
});

test("editing a key and value keeps other entries intact", () => {
  const start = { "X-A": "1" };
  const added = applyHeaderEdit(start, { index: 1, key: "", value: "" });
  assert.deepEqual(added, start, "a pending blank row is not persisted");

  const named = applyHeaderEdit(start, { index: 1, key: "X-B", value: "2" });
  assert.deepEqual(named, { "X-A": "1", "X-B": "2" });
});

test("renaming a header replaces its key", () => {
  const next = applyHeaderEdit({ "X-A": "1", "X-B": "2" }, { index: 0, key: "X-C", value: "1" });
  assert.deepEqual(next, { "X-C": "1", "X-B": "2" });
});

test("removing the last header clears the field", () => {
  assert.equal(applyHeaderEdit({ "X-A": "1" }, { remove: 0 }), undefined);
  assert.deepEqual(applyHeaderEdit({ "X-A": "1", "X-B": "2" }, { remove: 0 }), { "X-B": "2" });
});

test("keys are trimmed and blank keys discarded", () => {
  assert.deepEqual(applyHeaderEdit({ "  X-A  ": "1" }, {}), { "X-A": "1" });
});

test("known protocols are recognised and unknown ones treated as custom", () => {
  for (const api of KNOWN_API_PROTOCOLS) assert.equal(isCustomApiProtocol(api), false, api);
  assert.equal(isCustomApiProtocol("my-custom-protocol"), true);
  assert.equal(isCustomApiProtocol(undefined), false);
  assert.equal(isCustomApiProtocol(""), false);
});