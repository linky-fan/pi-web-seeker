import assert from "node:assert/strict";
import test from "node:test";

const { createTtlValueCache } = await import("../lib/ttl-cache.ts");

test("returns the cached value until the TTL expires", () => {
  let clock = 1_000;
  const cache = createTtlValueCache(5_000, () => clock);
  assert.equal(cache.get(), null);

  cache.set({ version: 1 });
  clock = 5_999;
  assert.deepEqual(cache.get(), { version: 1 });

  clock = 6_000;
  assert.equal(cache.get(), null);
});

test("clear drops the value so the next read rebuilds", () => {
  const cache = createTtlValueCache(5_000, () => 0);
  cache.set("value");
  cache.clear();
  assert.equal(cache.get(), null);
});

test("a newer value replaces the previous one", () => {
  const cache = createTtlValueCache(5_000, () => 0);
  cache.set(1);
  cache.set(2);
  assert.equal(cache.get(), 2);
});