import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  SESSION_SCAN_INDEX_VERSION,
  applySessionLine,
  emptyFileState,
  stateIsCurrent,
  toSessionInfo,
  type FileScanState,
  type SessionScanIndex,
} from "./session-scan";
import type { SessionInfo } from "./types";

// Scanning a session for its header, message count and first message used to read
// the whole file — painful when a few sessions are hundreds of megabytes. The index
// records how far each file has been consumed, so unchanged files are scanned zero
// times and appended files only read their new bytes. It is persisted so a server
// restart does not pay for a full rebuild.
const INDEX_FILENAME = "pi-web-session-index.json";
const MAX_READ_CHUNK = 1024 * 1024;

interface SessionIndex {
  sessions: SessionInfo[];
  idToPath: Map<string, string>;
  pathToId: Map<string, string>;
  parentById: Map<string, string>;
  cwdRoots: Set<string>;
  expiresAt: number;
}

function indexFilePath(): string {
  return join(getAgentDir(), INDEX_FILENAME);
}

function sessionsRoot(): string {
  return join(getAgentDir(), "sessions");
}

/** Every session file currently on disk, keyed by absolute path. */
function discoverSessionFiles(): Map<string, { size: number; mtimeMs: number }> {
  const found = new Map<string, { size: number; mtimeMs: number }>();
  const root = sessionsRoot();
  if (!existsSync(root)) return found;

  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => join(root, entry.name));
  } catch {
    return found;
  }

  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(dir, name);
      try {
        const stat = statSync(path);
        found.set(path, { size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // Unreadable entries are ignored, matching pi's discovery behavior.
      }
    }
  }
  return found;
}

function loadPersistedStates(): Record<string, FileScanState> {
  try {
    const parsed = JSON.parse(readFileSync(indexFilePath(), "utf8")) as SessionScanIndex;
    if (parsed?.version !== SESSION_SCAN_INDEX_VERSION || !parsed.files) return {};
    return parsed.files;
  } catch {
    return {};
  }
}

function persistStates(states: Record<string, FileScanState>): void {
  const path = indexFilePath();
  const temp = `${path}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temp, `${JSON.stringify({ version: SESSION_SCAN_INDEX_VERSION, files: states } satisfies SessionScanIndex)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, path);
  } catch {
    // The index is an optimization; a failed write must never break listing.
  }
}

/** Applies the bytes in [from, to) of a file to its scan state. */
function scanRange(state: FileScanState, path: string, from: number, to: number, fallbackCreated: string): void {
  if (to <= from) return;
  const fd = openSync(path, "r");
  try {
    let position = from;
    let carry = state.pendingLine;
    const buffer = Buffer.allocUnsafe(Math.min(MAX_READ_CHUNK, Math.max(1, to - from)));
    while (position < to) {
      const want = Math.min(buffer.length, to - position);
      const read = readSync(fd, buffer, 0, want, position);
      if (read <= 0) break;
      position += read;
      const text = carry + buffer.subarray(0, read).toString("utf8");
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) applySessionLine(state, line, fallbackCreated);
    }
    state.pendingLine = carry;
    state.offset = position;
  } finally {
    closeSync(fd);
  }
}

function scanFile(state: FileScanState, path: string, size: number, mtimeMs: number): void {
  const fallbackCreated = new Date(mtimeMs).toISOString();
  if (size < state.offset) {
    // Truncated or rewritten: start over rather than mixing old and new content.
    Object.assign(state, emptyFileState(path));
  }
  scanRange(state, path, state.offset, size, fallbackCreated);
  state.size = size;
  state.mtimeMs = mtimeMs;
}

let building: Promise<SessionIndex> | null = null;

function buildIndex(force: boolean): SessionIndex {
  const previous = force ? {} : loadPersistedStates();
  const files = discoverSessionFiles();
  const states: Record<string, FileScanState> = {};
  const sessions: SessionInfo[] = [];

  for (const [path, { size, mtimeMs }] of files) {
    const existing = previous[path];
    const state = existing && existing.path === path ? existing : emptyFileState(path);
    if (!stateIsCurrent(state, size, mtimeMs)) {
      try {
        scanFile(state, path, size, mtimeMs);
      } catch {
        continue;
      }
    }
    states[path] = state;
    const info = toSessionInfo(state, mtimeMs);
    if (info) sessions.push(info);
  }

  persistStates(states);

  const pathToId = new Map<string, string>();
  const idToPath = new Map<string, string>();
  const cwdRoots = new Set<string>();
  for (const session of sessions) {
    pathToId.set(session.path, session.id);
    idToPath.set(session.id, session.path);
    if (session.cwd) cwdRoots.add(session.cwd);
  }

  const parentById = new Map<string, string>();
  for (const state of Object.values(states)) {
    if (!state.parentSessionPath) continue;
    const parentId = pathToId.get(state.parentSessionPath);
    if (parentId) parentById.set(state.id, parentId);
  }

  sessions.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());

  return { sessions, idToPath, pathToId, parentById, cwdRoots, expiresAt: Date.now() + 5_000 };
}

export async function buildSessionIndex(force = false): Promise<SessionIndex> {
  if (building) return building;
  building = Promise.resolve().then(() => buildIndex(force));
  try {
    return await building;
  } finally {
    building = null;
  }
}