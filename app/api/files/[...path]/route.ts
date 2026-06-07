import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { Readable } from "stream";
import { getAllowedRoots, isPathAllowed, isWindowsAbsolutePath } from "@/lib/allowed-roots";

export const dynamic = "force-dynamic";

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store", ".git", ".pi-web-data",
]);

const IGNORED_SUFFIXES = [".pyc"];

const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
const DIRECTORY_CACHE_TTL_MS = 10_000;
const GIT_TRACKED_CACHE_TTL_MS = 15_000;
const FILE_SEARCH_LIMIT = 100;

const IMAGE_EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

const AUDIO_EXT_TO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  weba: "audio/webm",
  webm: "audio/webm",
};

function getExt(filePath: string): string {
  const ext = path.basename(filePath).toLowerCase().split(".").pop() ?? "";
  return ext;
}

function getImageMime(filePath: string): string | null {
  return IMAGE_EXT_TO_MIME[getExt(filePath)] ?? null;
}

function getAudioMime(filePath: string): string | null {
  return AUDIO_EXT_TO_MIME[getExt(filePath)] ?? null;
}

const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  mjs: "javascript", cjs: "javascript", py: "python", rb: "ruby",
  go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp",
  html: "html", htm: "html", css: "css", scss: "css", less: "css",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", xml: "xml", md: "markdown", mdx: "markdown",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  sql: "sql", graphql: "graphql", gql: "graphql",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl",
  env: "bash", gitignore: "bash", txt: "text",
};

function getLanguage(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  // Special full-name matches
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

// Short-TTL cache for the allowed-roots set. Without this, every file list/read
// request re-scans every pi session on disk just to check access. 5s is short
// enough that newly-created cwds appear promptly; stored on globalThis so it
// survives Next.js hot-reload.
declare global {
  var __piDirectoryListCache: Map<string, CachedDirectoryList> | undefined;
  var __piGitTrackedCache: Map<string, CachedGitTrackedIndex> | undefined;
}

interface FileListEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
}

interface CachedDirectoryList {
  entries: FileListEntry[];
  mtimeMs: number;
  expiresAt: number;
}

interface GitTrackedIndex {
  root: string;
  files: Set<string>;
  dirs: Set<string>;
}

interface CachedGitTrackedIndex extends GitTrackedIndex {
  expiresAt: number;
}

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function shouldIgnoreName(name: string): boolean {
  return IGNORED_NAMES.has(name) || IGNORED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function getDirectoryListCache(): Map<string, CachedDirectoryList> {
  if (!globalThis.__piDirectoryListCache) globalThis.__piDirectoryListCache = new Map();
  return globalThis.__piDirectoryListCache;
}

function getGitTrackedCache(): Map<string, CachedGitTrackedIndex> {
  if (!globalThis.__piGitTrackedCache) globalThis.__piGitTrackedCache = new Map();
  return globalThis.__piGitTrackedCache;
}

function getGitRoot(dirPath: string): string | null {
  try {
    return execFileSync("git", ["-C", dirPath, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_500,
    }).trim();
  } catch {
    return null;
  }
}

function getGitTrackedIndex(dirPath: string): GitTrackedIndex | null {
  const root = getGitRoot(dirPath);
  if (!root) return null;

  const now = Date.now();
  const cache = getGitTrackedCache();
  const cached = cache.get(root);
  if (cached && cached.expiresAt > now) return cached;

  try {
    const output = execFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const files = new Set<string>();
    const dirs = new Set<string>();
    for (const raw of output.split("\0")) {
      const rel = normalizeSlashes(raw).replace(/^\/+/, "");
      if (!rel) continue;
      files.add(rel);
      const parts = rel.split("/");
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join("/"));
      }
    }
    const index = { root, files, dirs, expiresAt: now + GIT_TRACKED_CACHE_TTL_MS };
    cache.set(root, index);
    if (cache.size > 40) {
      const oldestKey = cache.keys().next().value as string | undefined;
      if (oldestKey) cache.delete(oldestKey);
    }
    return index;
  } catch {
    return null;
  }
}

function isGitTrackedEntry(fullPath: string, isDir: boolean, index: GitTrackedIndex): boolean {
  const rel = normalizeSlashes(path.relative(index.root, fullPath));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  return isDir ? index.dirs.has(rel) : index.files.has(rel);
}

function listDirectoryEntries(
  dirPath: string,
  stat: fs.Stats,
  options?: { force?: boolean; trackedIndex?: GitTrackedIndex | null }
): FileListEntry[] {
  const trackedRoot = options?.trackedIndex?.root ?? "all";
  const cacheKey = `${dirPath}::${trackedRoot}`;
  const now = Date.now();
  const cache = getDirectoryListCache();
  const cached = cache.get(cacheKey);
  if (!options?.force && cached && cached.mtimeMs === stat.mtimeMs && cached.expiresAt > now) {
    return cached.entries;
  }

  const entries = fs.readdirSync(dirPath)
    .filter((name) => !shouldIgnoreName(name))
    .map((name) => {
      const full = path.join(dirPath, name);
      try {
        const s = fs.statSync(full);
        const isDir = s.isDirectory();
        if (options?.trackedIndex && !isGitTrackedEntry(full, isDir, options.trackedIndex)) return null;
        return {
          name,
          isDir,
          size: s.isFile() ? s.size : 0,
          modified: s.mtime.toISOString(),
        };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is FileListEntry => entry !== null)
    .sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  cache.set(cacheKey, { entries, mtimeMs: stat.mtimeMs, expiresAt: now + DIRECTORY_CACHE_TTL_MS });
  if (cache.size > 400) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey) cache.delete(oldestKey);
  }
  return entries;
}

function searchFileNames(
  rootPath: string,
  query: string,
  trackedIndex: GitTrackedIndex | null
): Array<FileListEntry & { path: string }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  if (trackedIndex) {
    const rootRel = normalizeSlashes(path.relative(trackedIndex.root, rootPath));
    const prefix = rootRel && !rootRel.startsWith("..") && !path.isAbsolute(rootRel) ? `${rootRel}/` : "";
    const matches: Array<FileListEntry & { path: string }> = [];
    for (const rel of trackedIndex.files) {
      if (prefix && !rel.startsWith(prefix)) continue;
      const displayPath = prefix ? rel.slice(prefix.length) : rel;
      const name = path.basename(rel);
      if (!name.toLowerCase().includes(needle) && !displayPath.toLowerCase().includes(needle)) continue;
      const full = path.join(trackedIndex.root, rel);
      try {
        const s = fs.statSync(full);
        matches.push({ name, path: displayPath, isDir: false, size: s.size, modified: s.mtime.toISOString() });
      } catch {
        matches.push({ name, path: displayPath, isDir: false, size: 0, modified: new Date(0).toISOString() });
      }
      if (matches.length >= FILE_SEARCH_LIMIT) break;
    }
    return matches.sort((a, b) => a.path.localeCompare(b.path));
  }

  const matches: Array<FileListEntry & { path: string }> = [];
  const walk = (dirPath: string, relDir: string) => {
    if (matches.length >= FILE_SEARCH_LIMIT) return;
    let names: string[];
    try {
      names = fs.readdirSync(dirPath);
    } catch {
      return;
    }
    for (const name of names) {
      if (matches.length >= FILE_SEARCH_LIMIT || shouldIgnoreName(name)) continue;
      const full = path.join(dirPath, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      try {
        const s = fs.lstatSync(full);
        if (s.isSymbolicLink()) continue;
        if (s.isDirectory()) {
          walk(full, rel);
        } else if (name.toLowerCase().includes(needle) || rel.toLowerCase().includes(needle)) {
          matches.push({ name, path: rel, isDir: false, size: s.size, modified: s.mtime.toISOString() });
        }
      } catch {
        // ignore unreadable entries
      }
    }
  };
  walk(rootPath, "");
  return matches.sort((a, b) => a.path.localeCompare(b.path));
}

function filePathFromSegments(segments: string[]): string {
  if (segments[0] === "__unc__") {
    return "//" + segments.slice(1).join("/");
  }

  const joined = segments.join("/");
  if (/^[a-zA-Z]:$/.test(joined)) return `${joined}/`;
  const slashJoined = normalizeSlashes(joined);
  if (isWindowsAbsolutePath(slashJoined)) return slashJoined;
  return "/" + joined.replace(/^\/+/, "");
}

function createFileBodyStream(filePath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  return Readable.toWeb(fs.createReadStream(filePath, range)) as ReadableStream<Uint8Array>;
}

function contentDispositionForDownload(filePath: string): string {
  const name = path.basename(filePath);
  const fallback = name.replace(/[^\x20-\x7e]|[\\/\r\n"]/g, "_") || "download";
  const encoded = encodeURIComponent(name);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function streamFile(
  filePath: string,
  stat: fs.Stats,
  contentType: string,
  rangeHeader: string | null,
  extraHeaders: Record<string, string> = {}
): Response {
  const headers = {
    "Content-Type": contentType,
    "Cache-Control": "no-cache",
    "Accept-Ranges": "bytes",
    ...extraHeaders,
  };

  if (!rangeHeader) {
    return new Response(createFileBodyStream(filePath), {
      headers: {
        ...headers,
        "Content-Length": String(stat.size),
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(stat.size - suffixLength, 0);
    end = stat.size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= stat.size) {
    return new Response(null, {
      status: 416,
      headers: {
        ...headers,
        "Content-Range": `bytes */${stat.size}`,
      },
    });
  }

  end = Math.min(end, stat.size - 1);
  const chunkSize = end - start + 1;
  return new Response(createFileBodyStream(filePath, { start, end }), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: segments } = await params;
    const filePath = filePathFromSegments(segments);
    const type = request.nextUrl.searchParams.get("type") ?? "list";
    const trackedOnly = request.nextUrl.searchParams.get("tracked") === "1";
    const force = request.nextUrl.searchParams.has("refresh");

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (type === "read") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file" }, { status: 400 });
      }
      const imageMime = getImageMime(filePath);
      if (imageMime) {
        if (stat.size > IMAGE_PREVIEW_MAX_BYTES) {
          return NextResponse.json({ error: "Image too large (>10MB)" }, { status: 413 });
        }
        return streamFile(filePath, stat, imageMime, request.headers.get("range"));
      }
      const audioMime = getAudioMime(filePath);
      if (audioMime) {
        return streamFile(filePath, stat, audioMime, request.headers.get("range"));
      }
      if (stat.size > TEXT_PREVIEW_MAX_BYTES) {
        return NextResponse.json({ error: "File too large for preview (>2MB)" }, { status: 413 });
      }
      const content = fs.readFileSync(filePath, "utf-8");
      const language = getLanguage(filePath);
      return NextResponse.json({ content, language, size: stat.size });
    }

    if (type === "download") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file" }, { status: 400 });
      }
      return streamFile(filePath, stat, "application/octet-stream", request.headers.get("range"), {
        "Content-Disposition": contentDispositionForDownload(filePath),
        "X-Content-Type-Options": "nosniff",
      });
    }

    if (type === "watch") {
      if (!stat.isFile()) {
        return NextResponse.json({ error: "Not a file" }, { status: 400 });
      }
      let watcher: fs.FSWatcher | null = null;
      const stream = new ReadableStream({
        start(controller) {
          const send = (eventName: string, data: Record<string, unknown>) => {
            const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
            try {
              controller.enqueue(new TextEncoder().encode(payload));
            } catch {
              // client disconnected
            }
          };
          // Send initial ping so client knows connection is live
          send("connected", { filePath });
          try {
            watcher = fs.watch(filePath, () => {
              try {
                const s = fs.statSync(filePath);
                send("change", { mtime: s.mtime.toISOString(), size: s.size });
              } catch {
                send("change", { mtime: new Date().toISOString(), size: 0 });
              }
            });
            watcher.on("error", () => {
              try { controller.close(); } catch { /* ignore */ }
            });
          } catch {
            send("error", { message: "Failed to watch file" });
            controller.close();
          }
        },
        cancel() {
          try { watcher?.close(); } catch { /* ignore */ }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }

    const trackedIndex = trackedOnly ? getGitTrackedIndex(filePath) : null;
    if (trackedOnly && !trackedIndex) {
      return NextResponse.json({
        entries: [],
        path: filePath,
        trackedOnly: true,
        gitTrackedAvailable: false,
      });
    }

    if (type === "search") {
      const query = request.nextUrl.searchParams.get("q") ?? "";
      const entries = searchFileNames(filePath, query, trackedIndex);
      return NextResponse.json({
        entries,
        path: filePath,
        trackedOnly,
        gitTrackedAvailable: trackedOnly ? Boolean(trackedIndex) : undefined,
      });
    }

    // type === "list"
    const entries = listDirectoryEntries(filePath, stat, { force, trackedIndex });
    return NextResponse.json({
      entries,
      path: filePath,
      trackedOnly,
      gitTrackedAvailable: trackedOnly ? Boolean(trackedIndex) : undefined,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
