import { createHash, randomUUID } from "node:crypto";
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { assertPathAllowed } from "./allowed-roots";
import { stripTerminalControls } from "./remote-security";
import type { RemoteCaptureSummary, RemoteCommandResult } from "./remote-types";

const MAX_CAPTURE_BYTES = Number(process.env.PI_WEB_REMOTE_CAPTURE_MAX_BYTES) || 16 * 1024 * 1024;
const MAX_LIBRARY_BYTES = Number(process.env.PI_WEB_REMOTE_CAPTURE_LIBRARY_BYTES) || 256 * 1024 * 1024;
const RETENTION_MS = (Number(process.env.PI_WEB_REMOTE_CAPTURE_RETENTION_DAYS) || 30) * 24 * 60 * 60 * 1000;
const PREVIEW_BYTES = 64 * 1024;

interface StoredCapture { summary: RemoteCaptureSummary; text: string }
export interface RemoteCaptureExportInspection { target: string; exists: boolean; summary: RemoteCaptureSummary }

function rootDir(): string {
  return join(process.env.PI_CODING_AGENT_DIR || getAgentDir() || join(homedir(), ".pi", "agent"), "remote-captures");
}

function sessionDir(agentSessionId: string): string {
  const hash = createHash("sha256").update(agentSessionId).digest("hex").slice(0, 24);
  return join(rootDir(), hash);
}

function capturePath(agentSessionId: string, captureId: string): string {
  if (!/^[a-f0-9-]{20,64}$/i.test(captureId)) throw new Error("Invalid capture id");
  return join(sessionDir(agentSessionId), `${captureId}.json`);
}

function readStored(agentSessionId: string, captureId: string): { path: string; stored: StoredCapture } {
  const path = capturePath(agentSessionId, captureId);
  try { return { path, stored: JSON.parse(readFileSync(path, "utf8")) as StoredCapture }; } catch { throw new Error("Remote capture not found"); }
}

function touchCapture(path: string): void {
  const now = new Date();
  try { utimesSync(path, now, now); } catch { /* The capture may have been removed concurrently. */ }
}

function allCaptureFiles(): Array<{ path: string; size: number; mtimeMs: number }> {
  const root = rootDir();
  if (!existsSync(root)) return [];
  const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of readdirSync(join(root, dir.name), { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const path = join(root, dir.name, file.name);
      const stat = statSync(path);
      files.push({ path, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return files;
}

function pruneCaptureLibrary(): void {
  const now = Date.now();
  const files = allCaptureFiles().sort((a, b) => a.mtimeMs - b.mtimeMs);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files) {
    if (now - file.mtimeMs <= RETENTION_MS && total <= MAX_LIBRARY_BYTES) continue;
    try { unlinkSync(file.path); total -= file.size; } catch { /* Best-effort retention cleanup. */ }
  }
}

export function saveRemoteCapture(input: {
  agentSessionId: string;
  profileId: string;
  command: string;
  output: string;
  exitCode?: number;
  durationMs: number;
  byteCount?: number;
  truncated?: boolean;
}): RemoteCommandResult {
  const clean = stripTerminalControls(input.output);
  const raw = Buffer.from(clean, "utf8");
  const truncated = input.truncated === true || raw.length > MAX_CAPTURE_BYTES;
  const text = (truncated ? raw.subarray(0, MAX_CAPTURE_BYTES) : raw).toString("utf8");
  const id = randomUUID();
  const summary: RemoteCaptureSummary = {
    id,
    agentSessionId: input.agentSessionId,
    profileId: input.profileId,
    command: input.command,
    createdAt: Date.now(),
    byteCount: input.byteCount ?? raw.length,
    truncated,
    exitCode: input.exitCode,
    durationMs: input.durationMs,
  };
  const path = capturePath(input.agentSessionId, id);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify({ summary, text })}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
  pruneCaptureLibrary();
  return { ...summary, preview: Buffer.from(text, "utf8").subarray(0, PREVIEW_BYTES).toString("utf8") };
}

export function listRemoteCaptures(agentSessionId: string): RemoteCaptureSummary[] {
  const dir = sessionDir(agentSessionId);
  if (!existsSync(dir)) return [];
  const captures: RemoteCaptureSummary[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try { captures.push((JSON.parse(readFileSync(join(dir, file), "utf8")) as StoredCapture).summary); } catch { /* Skip corrupt captures. */ }
  }
  return captures.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}

export function readRemoteCapture(agentSessionId: string, captureId: string, offset = 0, limit = PREVIEW_BYTES): { text: string; offset: number; nextOffset: number | null; total: number; summary: RemoteCaptureSummary } {
  const { path, stored } = readStored(agentSessionId, captureId);
  const start = Math.max(0, Math.min(stored.text.length, Math.floor(offset)));
  const size = Math.max(1, Math.min(PREVIEW_BYTES, Math.floor(limit)));
  const text = stored.text.slice(start, start + size);
  const nextOffset = start + text.length < stored.text.length ? start + text.length : null;
  touchCapture(path);
  return { text, offset: start, nextOffset, total: stored.text.length, summary: stored.summary };
}

export function searchRemoteCapture(agentSessionId: string, captureId: string, query: string): { matches: Array<{ line: number; text: string }>; truncated: boolean } {
  const normalized = query.trim().toLowerCase();
  if (!normalized || normalized.length > 256) throw new Error("Search query is required");
  const { path, stored } = readStored(agentSessionId, captureId);
  const lines = stored.text.split("\n");
  const matches: Array<{ line: number; text: string }> = [];
  for (let index = 0; index < lines.length && matches.length < 100; index += 1) {
    if (lines[index].toLowerCase().includes(normalized)) matches.push({ line: index + 1, text: lines[index].slice(0, 2_000) });
  }
  touchCapture(path);
  return { matches, truncated: matches.length === 100 };
}

export async function inspectRemoteCaptureExport(agentSessionId: string, captureId: string, cwd: string, destination: string): Promise<RemoteCaptureExportInspection> {
  const { stored } = readStored(agentSessionId, captureId);
  const target = isAbsolute(destination) ? resolve(destination) : resolve(cwd, destination);
  if (!basename(target) || target === resolve(cwd)) throw new Error("A destination file is required");
  const parent = dirname(target);
  let existingAncestor = parent;
  while (!existsSync(existingAncestor) && dirname(existingAncestor) !== existingAncestor) existingAncestor = dirname(existingAncestor);
  await assertPathAllowed(existingAncestor);
  if (existsSync(target)) {
    await assertPathAllowed(target);
    const stat = statSync(target);
    if (!stat.isFile()) throw new Error("Destination is not a regular file");
  }
  return { target, exists: existsSync(target), summary: stored.summary };
}

export async function exportRemoteCapture(agentSessionId: string, captureId: string, cwd: string, destination: string, overwrite = false): Promise<string> {
  const { path: sourcePath, stored } = readStored(agentSessionId, captureId);
  const inspection = await inspectRemoteCaptureExport(agentSessionId, captureId, cwd, destination);
  const target = inspection.target;
  if (inspection.exists && !overwrite) throw new Error("Destination already exists");
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true });
  await assertPathAllowed(parent);
  const rechecked = await inspectRemoteCaptureExport(agentSessionId, captureId, cwd, destination);
  if (rechecked.target !== target) throw new Error("Destination changed during export");
  if (rechecked.exists && !overwrite) throw new Error("Destination already exists");
  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, stored.text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    if (overwrite) renameSync(temp, target);
    else {
      copyFileSync(temp, target, constants.COPYFILE_EXCL);
      unlinkSync(temp);
    }
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
  touchCapture(sourcePath);
  return target;
}
