import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileDatabase } from "../../lib/checkers/adapters/c-family.ts";

const entryCount = Number(process.env.CHECKER_BENCH_ENTRIES ?? 5_000);
const root = mkdtempSync(path.join(os.tmpdir(), "pi-web-c-family-bench-"));
const source = path.join(root, "src", "sample.cpp");
const database = path.join(root, "compile_commands.json");
mkdirSync(path.dirname(source), { recursive: true });
writeFileSync(source, "int main() { return 0; }\n");
writeFileSync(database, JSON.stringify(Array.from({ length: entryCount }, () => ({
  directory: root,
  file: "src/sample.cpp",
}))));

const originalRealpath = fs.realpathSync.native;
let realpathCalls = 0;
fs.realpathSync.native = function (...args) {
  realpathCalls += 1;
  return originalRealpath.apply(this, args);
};

try {
  const startedAt = performance.now();
  const result = compileDatabase({ root, workspaceRoot: root, relativeRoot: ".", entries: new Set(), sourceFiles: [] });
  console.log(JSON.stringify({
    entryCount,
    resolvedSources: result?.sources.length ?? 0,
    realpathCalls,
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
  }));
} finally {
  fs.realpathSync.native = originalRealpath;
  rmSync(root, { recursive: true, force: true });
}
