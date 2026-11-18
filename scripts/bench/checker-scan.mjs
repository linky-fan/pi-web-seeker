import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanWorkspace } from "../../lib/checkers/discovery.ts";

const directoryCount = Number(process.env.CHECKER_BENCH_DIRS ?? 150);
const filesPerDirectory = Number(process.env.CHECKER_BENCH_FILES_PER_DIR ?? 20);
const root = mkdtempSync(path.join(os.tmpdir(), "pi-web-checker-scan-bench-"));

try {
  for (let directoryIndex = 0; directoryIndex < directoryCount; directoryIndex += 1) {
    const directory = path.join(root, `directory-${directoryIndex}`);
    mkdirSync(directory);
    for (let fileIndex = 0; fileIndex < filesPerDirectory; fileIndex += 1) {
      writeFileSync(path.join(directory, `file-${fileIndex}.txt`), "fixture\n");
    }
  }

  const startedAt = performance.now();
  scanWorkspace(root);
  const firstScanMs = performance.now() - startedAt;
  const secondStartedAt = performance.now();
  scanWorkspace(root);
  const secondScanMs = performance.now() - secondStartedAt;
  console.log(JSON.stringify({
    directories: directoryCount,
    files: directoryCount * filesPerDirectory,
    firstScanMs: Number(firstScanMs.toFixed(2)),
    secondScanMs: Number(secondScanMs.toFixed(2)),
    duplicateScanMs: Number((firstScanMs + secondScanMs).toFixed(2)),
  }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
