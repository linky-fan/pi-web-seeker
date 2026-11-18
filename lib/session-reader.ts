import { SessionManager, buildSessionContext as piBuildSessionContext, buildSessionProjection as piBuildSessionProjection, getAgentDir } from "@earendil-works/pi-coding-agent";
import { statSync } from "fs";
import type { SessionEntry, SessionInfo, SessionContext, SessionTreeNode, AssistantMessage, SessionHeader } from "./types";
import type { SessionEntry as PiSessionEntry } from "@earendil-works/pi-coding-agent";
import { normalizeToolCalls } from "./normalize";
import { normalizeSubagentRecordsForContext } from "./subagents";
import { buildSessionIndex } from "./session-index";

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

// Session metadata comes from an incremental on-disk index rather than reading
// every file: pi's own listAll streams whole files, which is slow when a session
// grows large.
async function buildSessionListIndex(force = false): Promise<CachedSessionListIndex> {
  const index = await buildSessionIndex(force);
  const cache = getPathCache();
  for (const [id, path] of index.idToPath) cache.set(id, path);
  return { ...index, expiresAt: Date.now() + SESSION_LIST_CACHE_TTL_MS };
}

export async function getSessionListIndex(options: { force?: boolean } = {}): Promise<CachedSessionListIndex> {
  const now = Date.now();
  const cached = globalThis.__piSessionListCache;
  if (!options.force && cached && cached.expiresAt > now) return cached;
  if (!options.force && globalThis.__piSessionListCachePromise) return globalThis.__piSessionListCachePromise;

  const promise = buildSessionListIndex(options.force === true);
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

export interface SessionUsageStats {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: number;
}

interface UsageLike {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
}

/**
 * Aggregate token usage across the whole session, matching pi's getSessionStats:
 * includes compacted-away history and usage entries, not just visible messages.
 */
export function calculateSessionUsage(entries: SessionEntry[]): SessionUsageStats | null {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let cost = 0;
  const add = (usage: UsageLike | undefined) => {
    if (!usage) return;
    tokens.input += usage.input ?? 0;
    tokens.output += usage.output ?? 0;
    tokens.cacheRead += usage.cacheRead ?? 0;
    tokens.cacheWrite += usage.cacheWrite ?? 0;
    cost += usage.cost?.total ?? 0;
  };
  for (const entry of entries) {
    const record = entry as unknown as { type: string; usage?: UsageLike; message?: { usage?: UsageLike } };
    if (record.type === "usage") add(record.usage);
    else if (record.type === "message") add(record.message?.usage);
    else if (record.type === "compaction" || record.type === "branch_summary") add(record.usage);
  }
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0 ? { tokens, cost } : null;
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

  if (leafId === null) {
    return { messages: [], entryIds: [], thinkingLevel: piCtx.thinkingLevel, model: piCtx.model };
  }

  // Map each model-visible message to the entry that produced it, for fork and
  // navigate_tree. The projection already applies compaction ranges and
  // context_edit omissions/replacements, so counts line up with piCtx.messages.
  const projection = piBuildSessionProjection(piEntries, leafId, byId as unknown as Map<string, PiSessionEntry>);
  const entryIds: string[] = [];
  for (const projected of projection.entries) {
    if (projected.messages.length === 0) continue;
    for (let i = 0; i < projected.messages.length; i += 1) entryIds.push(projected.sourceEntry.id);
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
