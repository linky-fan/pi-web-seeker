import { SessionManager, buildSessionContext as piBuildSessionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { statSync } from "fs";
import type { SessionEntry, SessionInfo, SessionContext, SessionTreeNode, AssistantMessage, SessionHeader } from "./types";
import type { SessionEntry as PiSessionEntry, SessionInfo as PiSessionInfo } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { normalizePathForComparison } from "./path-identity";
import { normalizeSubagentRecordsForContext } from "./subagents";

export { getAgentDir };

interface CachedSessionListIndex {
  sessions: SessionInfo[];
  idToPath: Map<string, string>;
  pathToId: Map<string, string>;
  parentById: Map<string, string>;
  cwdRoots: Set<string>;
  expiresAt: number;
}

const SESSION_LIST_CACHE_TTL_MS = 5_000;

async function buildSessionListIndex(): Promise<CachedSessionListIndex> {
  const piSessions: PiSessionInfo[] = await SessionManager.listAll();
  const pathToId = new Map<string, string>();
  for (const s of piSessions) pathToId.set(normalizePathForComparison(s.path), s.id);

  const cache = getPathCache();
  const idToPath = new Map<string, string>();
  const parentById = new Map<string, string>();
  const cwdRoots = new Set<string>();
  const sessions = piSessions.map((s) => {
    // Populate path cache so resolveSessionPath works without a full scan
    cache.set(s.id, s.path);
    idToPath.set(s.id, s.path);
    if (s.cwd) cwdRoots.add(s.cwd);
    const parentSessionId = s.parentSessionPath ? pathToId.get(normalizePathForComparison(s.parentSessionPath)) : undefined;
    if (parentSessionId) parentById.set(s.id, parentSessionId);
    return {
      path: s.path,
      id: s.id,
      cwd: s.cwd,
      name: s.name,
      created: s.created instanceof Date ? s.created.toISOString() : String(s.created),
      modified: s.modified instanceof Date ? s.modified.toISOString() : String(s.modified),
      messageCount: s.messageCount,
      firstMessage: s.firstMessage || "(no messages)",
      parentSessionId,
    };
  });
  return { sessions, idToPath, pathToId, parentById, cwdRoots, expiresAt: Date.now() + SESSION_LIST_CACHE_TTL_MS };
}

export async function getSessionListIndex(options: { force?: boolean } = {}): Promise<CachedSessionListIndex> {
  const now = Date.now();
  const cached = globalThis.__piSessionListCache;
  if (!options.force && cached && cached.expiresAt > now) return cached;
  if (!options.force && globalThis.__piSessionListCachePromise) return globalThis.__piSessionListCachePromise;

  const promise = buildSessionListIndex();
  globalThis.__piSessionListCachePromise = promise;
  try {
    const index = await promise;
    globalThis.__piSessionListCache = index;
    return index;
  } finally {
    if (globalThis.__piSessionListCachePromise === promise) {
      globalThis.__piSessionListCachePromise = undefined;
    }
  }
}

export async function listAllSessions(options: { force?: boolean } = {}): Promise<SessionInfo[]> {
  return (await getSessionListIndex(options)).sessions;
}

export async function getSessionParentId(sessionId: string): Promise<string | undefined> {
  return (await getSessionListIndex()).parentById.get(sessionId);
}

export async function getSessionCwdRoots(): Promise<Set<string>> {
  return new Set((await getSessionListIndex()).cwdRoots);
}

// ============================================================================
// Session path cache: sessionId → absolute file path
// Stored in globalThis for hot-reload safety
// ============================================================================
declare global {
  var __piSessionPathCache: Map<string, string> | undefined;
  var __piSessionFileCache: Map<string, CachedSessionFile> | undefined;
  var __piSessionListCache: CachedSessionListIndex | undefined;
  var __piSessionListCachePromise: Promise<CachedSessionListIndex> | undefined;
}

function getPathCache(): Map<string, string> {
  if (!globalThis.__piSessionPathCache) globalThis.__piSessionPathCache = new Map();
  return globalThis.__piSessionPathCache;
}

export async function resolveSessionPath(sessionId: string): Promise<string | null> {
  const cached = getPathCache().get(sessionId);
  if (cached) return cached;

  // Cache miss: scan all sessions to populate cache, then retry
  const index = await getSessionListIndex();
  return index.idToPath.get(sessionId) ?? getPathCache().get(sessionId) ?? null;
}

export function cacheSessionPath(sessionId: string, filePath: string): void {
  getPathCache().set(sessionId, filePath);
}

export function invalidateSessionPathCache(sessionId: string): void {
  getPathCache().delete(sessionId);
  invalidateSessionListCache();
}

export function invalidateSessionListCache(): void {
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListCachePromise = undefined;
}

export interface CachedSessionFile {
  filePath: string;
  size: number;
  mtimeMs: number;
  header: SessionHeader | null;
  entries: SessionEntry[];
  tree: SessionTreeNode[];
  leafId: string | null;
  sessionName?: string;
  contexts: Map<string, SessionContext>;
}

const SESSION_FILE_CACHE_MAX = 50;

function getFileCache(): Map<string, CachedSessionFile> {
  if (!globalThis.__piSessionFileCache) globalThis.__piSessionFileCache = new Map();
  return globalThis.__piSessionFileCache;
}

function rememberCachedSession(filePath: string, snapshot: CachedSessionFile): CachedSessionFile {
  const cache = getFileCache();
  cache.delete(filePath);
  cache.set(filePath, snapshot);
  while (cache.size > SESSION_FILE_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
  return snapshot;
}

export function invalidateSessionFileCache(filePath: string): void {
  getFileCache().delete(filePath);
}

export function getCachedSessionFile(filePath: string): CachedSessionFile {
  const stat = statSync(filePath);
  const cached = getFileCache().get(filePath);
  if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
    rememberCachedSession(filePath, cached);
    return cached;
  }

  const sm = SessionManager.open(filePath);
  return rememberCachedSession(filePath, {
    filePath,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    header: (sm.getHeader() as SessionHeader | undefined) ?? null,
    entries: sm.getEntries() as unknown as SessionEntry[],
    tree: sm.getTree() as unknown as SessionTreeNode[],
    leafId: sm.getLeafId(),
    sessionName: sm.getSessionName(),
    contexts: new Map(),
  });
}

function contextCacheKey(leafId?: string | null): string {
  if (leafId === undefined) return "mode:default";
  if (leafId === null) return "mode:empty";
  return `leaf:${leafId}`;
}

function isContextMessageEntry(entry: SessionEntry): boolean {
  return entry.type === "message" || entry.type === "custom_message" || entry.type === "branch_summary";
}

export function getCachedSessionContext(snapshot: CachedSessionFile, leafId?: string | null): SessionContext {
  const key = contextCacheKey(leafId);
  const cached = snapshot.contexts.get(key);
  if (cached) return cached;

  const context = buildSessionContext(snapshot.entries, leafId);
  snapshot.contexts.set(key, context);
  return context;
}

export function buildSessionContext(entries: SessionEntry[], leafId?: string | null): SessionContext {
  const contextEntries = normalizeSubagentRecordsForContext(entries);
  const byId = new Map<string, SessionEntry>();
  for (const e of contextEntries) byId.set(e.id, e);

  const piEntries = contextEntries as unknown as PiSessionEntry[];
  const piCtx = piBuildSessionContext(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);

  // Build entryIds: parallel array to messages[], mapping each message back to its entry id.
  // Needed for fork and navigate_tree calls from the UI.
  let targetLeaf: SessionEntry | undefined;
  if (leafId === null) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }
  if (leafId) targetLeaf = byId.get(leafId);
  if (!targetLeaf) targetLeaf = contextEntries[contextEntries.length - 1];
  if (!targetLeaf) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }

  // Walk path from target leaf to root
  const path: SessionEntry[] = [];
  let cur: SessionEntry | undefined = targetLeaf;
  while (cur) {
    path.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }

  // Find the last compaction on path (mirrors pi's buildSessionContext logic)
  let compactionId: string | undefined;
  let firstKeptEntryId: string | undefined;
  for (const e of path) {
    if (e.type === "compaction") {
      compactionId = e.id;
      firstKeptEntryId = (e as { firstKeptEntryId: string }).firstKeptEntryId;
    }
  }

  const entryIds: string[] = [];
  if (compactionId) {
    // The first message in piCtx.messages is the synthetic compaction summary — map to compaction entry id
    entryIds.push(compactionId);
    const compactionIdx = path.findIndex((e) => e.id === compactionId);
    const firstKeptIdx = firstKeptEntryId
      ? path.findIndex((e, i) => i < compactionIdx && e.id === firstKeptEntryId)
      : -1;
    const startIdx = firstKeptIdx >= 0 ? firstKeptIdx : compactionIdx;
    for (let i = startIdx; i < compactionIdx; i++) {
      if (isContextMessageEntry(path[i])) entryIds.push(path[i].id);
    }
    for (let i = compactionIdx + 1; i < path.length; i++) {
      if (isContextMessageEntry(path[i])) entryIds.push(path[i].id);
    }
  } else {
    for (const e of path) {
      if (isContextMessageEntry(e)) entryIds.push(e.id);
    }
  }

  // pi injects compaction summary as {role:"compactionSummary", summary, tokensBefore}.
  // Convert to {role:"user"} so MessageView can render it the same as before.
  const messages = (piCtx.messages as AssistantMessage[]).map((msg) => {
    const raw = msg as unknown as Record<string, unknown>;
    if (raw.role === "compactionSummary") {
      return {
        role: "user" as const,
        content: `*The conversation history before this point was compacted into the following summary:*\n\n${raw.summary ?? ""}`,
        timestamp: raw.timestamp as number | undefined,
      };
    }
    return normalizeToolCalls(msg);
  });

  return {
    messages,
    entryIds,
    thinkingLevel: piCtx.thinkingLevel,
    model: piCtx.model,
  };
}
