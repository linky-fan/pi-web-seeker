import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const agentSessionId = "remote-capture-benchmark";
const captureCount = Number(process.env.REMOTE_CAPTURE_BENCH_COUNT ?? 24);
const captureBytes = Number(process.env.REMOTE_CAPTURE_BENCH_BYTES ?? 512 * 1024);
const agentDir = mkdtempSync(path.join(os.tmpdir(), "pi-web-capture-bench-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

try {
  const sessionKey = createHash("sha256").update(agentSessionId).digest("hex").slice(0, 24);
  const captureDir = path.join(agentDir, "remote-captures", sessionKey);
  mkdirSync(captureDir, { recursive: true });
  const text = "x".repeat(captureBytes);
  for (let index = 0; index < captureCount; index += 1) {
    const id = index.toString(16).padStart(24, "0");
    const stored = {
      summary: {
        id,
        agentSessionId,
        profileId: "benchmark-profile",
        command: "benchmark",
        createdAt: index,
        byteCount: captureBytes,
        truncated: false,
        durationMs: 1,
      },
      text,
    };
    writeFileSync(path.join(captureDir, `${id}.json`), JSON.stringify(stored));
  }

  const { listRemoteCaptures } = await import("../../lib/remote-captures.ts");
  const durations = [];
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const startedAt = performance.now();
    const summaries = listRemoteCaptures(agentSessionId);
    durations.push(performance.now() - startedAt);
    if (summaries.length !== Math.min(captureCount, 100)) throw new Error("Capture summaries were incomplete");
  }
  durations.sort((left, right) => left - right);
  console.log(JSON.stringify({
    captureCount,
    captureBytes,
    payloadBytes: captureCount * captureBytes,
    iterations: durations.length,
    medianMs: Number(durations[Math.floor(durations.length / 2)].toFixed(2)),
  }));
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
