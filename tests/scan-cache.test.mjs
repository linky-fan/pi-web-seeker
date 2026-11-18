import assert from "node:assert/strict";
import test from "node:test";

const { createScanCache } = await import("../lib/scan-cache.ts");

test("returns a cached scan until its TTL expires", () => {
  let clock = 1_000;
  const cache = createScanCache(5_000, () => clock);
  const key = cache.key(["agent", "/work", true]);
  cache.set(key, { cwd: "/work", value: 1 });

  clock = 5_999;
  assert.deepEqual(cache.get(key), { cwd: "/work", value: 1 });

  clock = 6_000;
  assert.equal(cache.get(key), null);
  assert.equal(cache.size(), 0);
});

test("a scan key distinguishes trust state and distinct workspace inputs", () => {
  const cache = createScanCache(5_000, () => 0);
  const trusted = cache.key(["agent", "/work", true]);
  const gated = cache.key(["agent", "/work", false]);
  assert.notEqual(trusted, gated);
  assert.notEqual(cache.key(["agent", "/work", true]), cache.key(["/agent", "/work", true]));

  cache.set(trusted, { cwd: "/work", value: "trusted" });
  cache.set(gated, { cwd: "/work", value: "gated" });
  assert.equal(cache.get(gated).value, "gated");
});

test("forgetting a workspace leaves other workspaces cached", () => {
  const cache = createScanCache(5_000, () => 0);
  const a = cache.key(["agent", "/a", true]);
  const b = cache.key(["agent", "/b", true]);
  cache.set(a, { cwd: "/a" });
  cache.set(cache.key(["agent", "/a", false]), { cwd: "/a" });
  cache.set(b, { cwd: "/b" });

  cache.forget("/a");
  assert.equal(cache.get(a), null);
  assert.deepEqual(cache.get(b), { cwd: "/b" });
  assert.equal(cache.size(), 1);

  cache.forget();
  assert.equal(cache.size(), 0);
});