import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const patchScript = fileURLToPath(new URL("../scripts/patch-pi-ai-stepfun-cache.mjs", import.meta.url));
const oldUsage = "rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? 0";
const newUsage = "rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? rawUsage.cached_tokens ?? rawUsage.cached_token ?? 0";

function runPatch(root) {
  return spawnSync(process.execPath, [patchScript], { cwd: root, encoding: "utf8" });
}

function createPackageLayout(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-web-stepfun-patch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packageDirectory = path.join(root, "node_modules", "@earendil-works", "pi-ai", "dist", "api");
  mkdirSync(packageDirectory, { recursive: true });
  return { root, target: path.join(packageDirectory, "openai-completions.js") };
}

test("StepFun cached token patch supports the 0.84 and 1.x source shapes", (t) => {
  for (const source of [
    `const cacheReadTokens = ${oldUsage};`,
    `const cacheReadTokens = rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? rawUsage.cached_tokens ?? 0;`,
  ]) {
    const { root, target } = createPackageLayout(t);
    writeFileSync(target, source);

    const firstRun = runPatch(root);
    assert.equal(firstRun.status, 0, firstRun.stderr);
    const patched = readFileSync(target, "utf8");
    assert.equal(patched, `const cacheReadTokens = ${newUsage};`);

    const secondRun = runPatch(root);
    assert.equal(secondRun.status, 0, secondRun.stderr);
    assert.equal(readFileSync(target, "utf8"), patched);
  }
});
