import { execFileSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import { homedir } from "os";
import path from "path";
import zlib from "zlib";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { FileEntry, SessionEntry, SessionHeader, SessionInfo } from "./types";
import { getPathRelativeToRoot, isWindowsStylePath, normalizeFilePathSlashes } from "./path-identity";
import { filterRemoteSessionEntries } from "./session-export";

export const DEBUG_BUNDLE_SCHEMA_VERSION = 1;
export const DEBUG_BUNDLE_MAX_BYTES = 250 * 1024 * 1024;

const WORKSPACE_FILE_MAX_BYTES = 10 * 1024 * 1024;
const WORKSPACE_TOTAL_MAX_BYTES = 150 * 1024 * 1024;

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  ".pytest_cache",
  ".mypy_cache",
  "__pycache__",
  "target",
  "vendor",
  ".pi-web-data",
  ".pi",
  ".pi-remote",
]);

const SECRET_NAME_RE = /(^|[._-])(?:env|secret|secrets|token|tokens|auth|credential|credentials|apikey|api-key|private-key|id_rsa|id_ed25519)(?:$|[._-])/i;

type JsonRecord = Record<string, unknown>;

export interface DebugBundleManifest {
  schemaVersion: number;
  kind: "pi-web-debug-bundle";
  exportedAt: string;
  source: {
    appVersion: string;
    piVersion: string;
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
    cwd: string;
    sessionId: string;
    sessionName?: string;
  };
  importPolicy: {
    defaultTarget: "sandbox";
    canResumeAgent: "if-target-env-ready";
  };
  session: {
    path: "session/session.jsonl";
    originalId: string;
    entryCount: number;
    mediaExternalized: number;
  };
  workspace: {
    originalCwd: string;
    path: "workspace/";
    files: DebugBundleWorkspaceFile[];
    excluded: DebugBundleExcludedFile[];
  };
  media: DebugBundleMediaFile[];
  diagnostics: {
    path: "diagnostics/environment.json";
  };
  warnings: string[];
}

export interface DebugBundleWorkspaceFile {
  path: string;
  size: number;
  sha256: string;
  mtime: string;
}

export interface DebugBundleExcludedFile {
  path: string;
  reason: string;
  size?: number;
}

export interface DebugBundleMediaFile {
  path: string;
  sha256: string;
  size: number;
  mimeType: string;
  extension: string;
}

export interface DebugBundleSummary {
  manifest: DebugBundleManifest;
  targetCwd: string;
  sessionId: string;
  fileCount: number;
  fileBytes: number;
  mediaCount: number;
  mediaBytes: number;
  warnings: string[];
}

export interface ImportedDebugBundle {
  session: SessionInfo;
  targetCwd: string;
  restoredFiles: number;
  restoredBytes: number;
  warnings: string[];
  sessionFilePath: string;
}

interface TarEntry {
  path: string;
  data: Buffer;
  mode?: number;
  mtime?: Date;
}

interface ParsedTarEntry {
  path: string;
  data: Buffer;
  mode: number;
  mtime: Date;
}

interface ExternalizedSession {
  entries: SessionEntry[];
  mediaEntries: TarEntry[];
  media: DebugBundleMediaFile[];
  mediaCount: number;
}

interface UploadedFileLike {
  size: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export function isUploadedBundleFile(value: unknown): value is UploadedFileLike {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as { size?: unknown }).size === "number" &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function";
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeFilePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "session";
}

function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function mimeExtension(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/svg+xml") return "svg";
  return "bin";
}

function safeArchivePath(value: string): string | null {
  const normalized = normalizeFilePathSlashes(value).replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.join("/");
}

function shouldExcludeRelativePath(relPath: string): string | null {
  const parts = normalizeFilePathSlashes(relPath).split("/");
  if (parts.some((part) => EXCLUDED_DIR_NAMES.has(part))) return "excluded directory";
  const base = parts[parts.length - 1] ?? "";
  if (base === ".env" || base.startsWith(".env.")) return "secret-like filename";
  if (SECRET_NAME_RE.test(base)) return "secret-like filename";
  return null;
}

function getGitRoot(cwd: string): string | null {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1_500,
    }).trim();
  } catch {
    return null;
  }
}

function gitWorkspaceFiles(cwd: string): string[] | null {
  const gitRoot = getGitRoot(cwd);
  if (!gitRoot) return null;
  let output: string;
  try {
    output = execFileSync("git", ["-C", cwd, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--full-name"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  const files: string[] = [];
  for (const raw of output.split("\0")) {
    const relToGit = normalizeFilePathSlashes(raw).replace(/^\/+/, "");
    if (!relToGit) continue;
    const full = path.join(gitRoot, relToGit);
    const relToCwd = getPathRelativeToRoot(full, cwd);
    if (relToCwd !== null && relToCwd) files.push(relToCwd);
  }
  return Array.from(new Set(files)).sort();
}

function recursiveWorkspaceFiles(cwd: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, relDir: string) => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const rel = relDir ? `${relDir}/${name}` : name;
      if (shouldExcludeRelativePath(rel)) continue;
      const full = path.join(cwd, rel);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(full, rel);
      } else if (stat.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(cwd, "");
  return out.sort();
}

function collectWorkspaceEntries(cwd: string): { entries: TarEntry[]; files: DebugBundleWorkspaceFile[]; excluded: DebugBundleExcludedFile[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!cwd || isWindowsStylePath(cwd) || !path.isAbsolute(cwd) || !fs.existsSync(cwd)) {
    return {
      entries: [],
      files: [],
      excluded: [],
      warnings: [`Workspace files were not bundled because cwd is not available on this machine: ${cwd || "(empty)"}`],
    };
  }
  const rootStat = fs.statSync(cwd);
  if (!rootStat.isDirectory()) {
    return { entries: [], files: [], excluded: [], warnings: [`Workspace cwd is not a directory: ${cwd}`] };
  }

  const relFiles = gitWorkspaceFiles(cwd) ?? recursiveWorkspaceFiles(cwd);
  if (relFiles.length === 0) warnings.push("No workspace files matched the debug bundle file scope.");

  const entries: TarEntry[] = [];
  const files: DebugBundleWorkspaceFile[] = [];
  const excluded: DebugBundleExcludedFile[] = [];
  let totalBytes = 0;

  for (const rel of relFiles) {
    const archiveRel = safeArchivePath(rel);
    if (!archiveRel) {
      excluded.push({ path: rel, reason: "unsafe archive path" });
      continue;
    }
    const excludedReason = shouldExcludeRelativePath(archiveRel);
    if (excludedReason) {
      excluded.push({ path: archiveRel, reason: excludedReason });
      continue;
    }
    const full = path.join(cwd, archiveRel);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(full);
    } catch {
      excluded.push({ path: archiveRel, reason: "missing or unreadable" });
      continue;
    }
    if (stat.isSymbolicLink()) {
      excluded.push({ path: archiveRel, reason: "symbolic links are not bundled" });
      continue;
    }
    if (!stat.isFile()) continue;
    if (stat.size > WORKSPACE_FILE_MAX_BYTES) {
      excluded.push({ path: archiveRel, reason: "file exceeds per-file limit", size: stat.size });
      continue;
    }
    if (totalBytes + stat.size > WORKSPACE_TOTAL_MAX_BYTES) {
      excluded.push({ path: archiveRel, reason: "workspace bundle size limit reached", size: stat.size });
      continue;
    }
    const data = fs.readFileSync(full);
    const hash = sha256(data);
    totalBytes += data.length;
    entries.push({ path: `workspace/${archiveRel}`, data, mode: stat.mode & 0o777, mtime: stat.mtime });
    files.push({ path: archiveRel, size: data.length, sha256: hash, mtime: stat.mtime.toISOString() });
  }

  if (excluded.length > 0) warnings.push(`${excluded.length} workspace file(s) were excluded from the debug bundle.`);
  return { entries, files, excluded, warnings };
}

function mediaFromImageBlock(block: JsonRecord): { data: string; mimeType: string; shape: "source" | "direct" } | null {
  if (block.type !== "image") return null;
  const source = block.source;
  if (isRecord(source) && source.type === "base64" && typeof source.data === "string") {
    const mimeType = typeof source.media_type === "string"
      ? source.media_type
      : typeof source.mimeType === "string"
        ? source.mimeType
        : "application/octet-stream";
    return { data: source.data, mimeType, shape: "source" };
  }
  if (typeof block.data === "string") {
    const mimeType = typeof block.mimeType === "string"
      ? block.mimeType
      : typeof block.media_type === "string"
        ? block.media_type
        : "application/octet-stream";
    return { data: block.data, mimeType, shape: "direct" };
  }
  return null;
}

function externalizeMedia(entries: SessionEntry[]): ExternalizedSession {
  const cloned = JSON.parse(JSON.stringify(entries)) as SessionEntry[];
  const mediaByHash = new Map<string, DebugBundleMediaFile>();
  const mediaEntries = new Map<string, TarEntry>();
  let mediaCount = 0;

  for (const entry of cloned) {
    if (entry.type !== "message" && entry.type !== "custom_message") continue;
    const content = entry.type === "message" ? entry.message.content : entry.content;
    if (!Array.isArray(content)) continue;
    for (let i = 0; i < content.length; i += 1) {
      const block = content[i] as unknown;
      if (!isRecord(block)) continue;
      const media = mediaFromImageBlock(block);
      if (!media) continue;
      const data = Buffer.from(media.data, "base64");
      const hash = sha256(data);
      const extension = mimeExtension(media.mimeType);
      const mediaPath = `media/${hash}.${extension}`;
      if (!mediaByHash.has(hash)) {
        const item = { path: mediaPath, sha256: hash, size: data.length, mimeType: media.mimeType, extension };
        mediaByHash.set(hash, item);
        mediaEntries.set(hash, { path: mediaPath, data, mode: 0o600 });
      }
      content[i] = {
        type: "image",
        debugBundleMedia: {
          path: mediaPath,
          sha256: hash,
          size: data.length,
          mimeType: media.mimeType,
          shape: media.shape,
        },
      } as never;
      mediaCount += 1;
    }
  }

  return {
    entries: cloned,
    mediaEntries: Array.from(mediaEntries.values()),
    media: Array.from(mediaByHash.values()).sort((a, b) => a.path.localeCompare(b.path)),
    mediaCount,
  };
}

function rehydrateMedia(entries: SessionEntry[], files: Map<string, ParsedTarEntry>): SessionEntry[] {
  const cloned = JSON.parse(JSON.stringify(entries)) as SessionEntry[];
  for (const entry of cloned) {
    if (entry.type !== "message" && entry.type !== "custom_message") continue;
    const content = entry.type === "message" ? entry.message.content : entry.content;
    if (!Array.isArray(content)) continue;
    for (let i = 0; i < content.length; i += 1) {
      const block = content[i] as unknown;
      if (!isRecord(block) || !isRecord(block.debugBundleMedia)) continue;
      const ref = block.debugBundleMedia;
      const mediaPath = typeof ref.path === "string" ? ref.path : "";
      const media = files.get(mediaPath);
      if (!media) throw new Error(`Bundle media is missing: ${mediaPath}`);
      const hash = sha256(media.data);
      if (typeof ref.sha256 === "string" && ref.sha256 !== hash) {
        throw new Error(`Bundle media checksum mismatch: ${mediaPath}`);
      }
      const data = media.data.toString("base64");
      const mimeType = typeof ref.mimeType === "string" ? ref.mimeType : "application/octet-stream";
      const shape = ref.shape === "source" ? "source" : "direct";
      content[i] = shape === "source"
        ? { type: "image", source: { type: "base64", media_type: mimeType, data } } as never
        : { type: "image", data, mimeType } as never;
    }
  }
  return cloned;
}

function writeOctal(target: Buffer, value: number, offset: number, length: number): void {
  const text = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  target.write(text, offset, length - 1, "ascii");
  target[offset + length - 1] = 0;
}

function splitTarName(name: string): { name: string; prefix: string } | null {
  const encoded = Buffer.byteLength(name);
  if (encoded <= 100) return { name, prefix: "" };
  const parts = name.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const prefix = parts.slice(0, i).join("/");
    const base = parts.slice(i).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(base) <= 100) return { name: base, prefix };
  }
  return null;
}

function createTarHeader(entry: TarEntry): Buffer {
  const split = splitTarName(entry.path);
  if (!split) throw new Error(`Archive path is too long for debug bundle: ${entry.path}`);
  const header = Buffer.alloc(512, 0);
  header.write(split.name, 0, 100, "utf8");
  writeOctal(header, entry.mode ?? 0o600, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, entry.data.length, 124, 12);
  writeOctal(header, Math.floor((entry.mtime ?? new Date()).getTime() / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  if (split.prefix) header.write(split.prefix, 345, 155, "utf8");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  const checksumText = checksum.toString(8).padStart(6, "0");
  header.write(checksumText, 148, 6, "ascii");
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function createTarGz(entries: TarEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const archivePath = safeArchivePath(entry.path);
    if (!archivePath) throw new Error(`Unsafe debug bundle path: ${entry.path}`);
    const normalizedEntry = { ...entry, path: archivePath };
    chunks.push(createTarHeader(normalizedEntry));
    chunks.push(normalizedEntry.data);
    const remainder = normalizedEntry.data.length % 512;
    if (remainder) chunks.push(Buffer.alloc(512 - remainder, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(chunks), { level: 6 });
}

function parseTarGz(data: Buffer): Map<string, ParsedTarEntry> {
  const tar = zlib.gunzipSync(data);
  const entries = new Map<string, ParsedTarEntry>();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const rawName = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const rawPrefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const entryPath = rawPrefix ? `${rawPrefix}/${rawName}` : rawName;
    const safePath = safeArchivePath(entryPath);
    if (!safePath || safePath !== entryPath) throw new Error(`Unsafe archive path: ${entryPath}`);
    const typeFlag = header.subarray(156, 157).toString("ascii");
    if (typeFlag && typeFlag !== "0") throw new Error(`Unsupported archive entry type for ${entryPath}`);
    if (entries.has(entryPath)) throw new Error(`Duplicate archive entry: ${entryPath}`);
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeText || "0", 8);
    if (!Number.isFinite(size) || size < 0 || offset + size > tar.length) throw new Error(`Invalid archive size for ${entryPath}`);
    const modeText = header.subarray(100, 108).toString("ascii").replace(/\0.*$/, "").trim();
    const mtimeText = header.subarray(136, 148).toString("ascii").replace(/\0.*$/, "").trim();
    const fileData = tar.subarray(offset, offset + size);
    offset += size;
    const remainder = size % 512;
    if (remainder) offset += 512 - remainder;
    entries.set(entryPath, {
      path: entryPath,
      data: Buffer.from(fileData),
      mode: parseInt(modeText || "600", 8),
      mtime: new Date((parseInt(mtimeText || "0", 8) || 0) * 1000),
    });
  }
  return entries;
}

function serializeJsonEntry(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function serializeSessionJsonl(header: SessionHeader, entries: SessionEntry[]): Buffer {
  const lines: FileEntry[] = [header, ...entries];
  return Buffer.from(`${lines.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

function parseSessionJsonl(data: Buffer): { header: SessionHeader; entries: SessionEntry[] } {
  const lines = data.toString("utf8").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("Bundle session is empty");
  const parsed = lines.map((line) => JSON.parse(line) as unknown);
  const header = parsed[0];
  if (!isRecord(header) || header.type !== "session" || typeof header.id !== "string" || typeof header.timestamp !== "string" || typeof header.cwd !== "string") {
    throw new Error("Bundle session header is invalid");
  }
  return { header: header as unknown as SessionHeader, entries: parsed.slice(1) as SessionEntry[] };
}

function environmentDiagnostics(cwd: string): JsonRecord {
  let npmVersion: string | undefined;
  try {
    npmVersion = execFileSync("npm", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1_500 }).trim();
  } catch {
    npmVersion = undefined;
  }
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    npmVersion,
    cwd,
    env: {
      PI_WEB_SINGLE_WORKSPACE: process.env.PI_WEB_SINGLE_WORKSPACE ?? undefined,
      PI_WEB_DEFAULT_CWD: process.env.PI_WEB_DEFAULT_CWD ? "[set]" : undefined,
      PI_WEB_ALLOWED_ROOTS: process.env.PI_WEB_ALLOWED_ROOTS ? "[set]" : undefined,
    },
  };
}

export function debugBundleFilename(sessionId: string, firstMessage?: string): string {
  return `pi-debug-bundle-${sanitizeFilePart(firstMessage || sessionId)}.tar.gz`;
}

export function buildDebugBundle(params: {
  sessionId: string;
  header: SessionHeader;
  entries: SessionEntry[];
  sessionName?: string;
  firstMessage?: string;
  appVersion: string;
  piVersion: string;
}): { filename: string; data: Buffer; manifest: DebugBundleManifest } {
  const warnings: string[] = [];
  // Remote command results and captures are sensitive operational data. They
  // can only leave the application through the explicitly approved capture
  // export path, never through a general-purpose debug bundle.
  const safeEntries = filterRemoteSessionEntries(params.entries);
  const externalized = externalizeMedia(safeEntries);
  const workspace = collectWorkspaceEntries(params.header.cwd);
  warnings.push(...workspace.warnings);

  const sessionHeader: SessionHeader = { ...params.header };
  const sessionJsonl = serializeSessionJsonl(sessionHeader, externalized.entries);
  const exportedAt = new Date().toISOString();
  const diagnostics = environmentDiagnostics(params.header.cwd);

  const manifest: DebugBundleManifest = {
    schemaVersion: DEBUG_BUNDLE_SCHEMA_VERSION,
    kind: "pi-web-debug-bundle",
    exportedAt,
    source: {
      appVersion: params.appVersion,
      piVersion: params.piVersion,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cwd: params.header.cwd,
      sessionId: params.sessionId,
      sessionName: params.sessionName,
    },
    importPolicy: {
      defaultTarget: "sandbox",
      canResumeAgent: "if-target-env-ready",
    },
    session: {
      path: "session/session.jsonl",
      originalId: params.sessionId,
      entryCount: safeEntries.length,
      mediaExternalized: externalized.mediaCount,
    },
    workspace: {
      originalCwd: params.header.cwd,
      path: "workspace/",
      files: workspace.files,
      excluded: workspace.excluded,
    },
    media: externalized.media,
    diagnostics: { path: "diagnostics/environment.json" },
    warnings,
  };

  const exportSummary = {
    sessionId: params.sessionId,
    exportedAt,
    originalCwd: params.header.cwd,
    workspaceFileCount: workspace.files.length,
    workspaceBytes: workspace.files.reduce((sum, item) => sum + item.size, 0),
    mediaCount: externalized.media.length,
    mediaBytes: externalized.media.reduce((sum, item) => sum + item.size, 0),
    warnings,
  };

  const entries: TarEntry[] = [
    { path: "manifest.json", data: serializeJsonEntry(manifest), mode: 0o600 },
    { path: "session/session.jsonl", data: sessionJsonl, mode: 0o600 },
    { path: "session/export.json", data: serializeJsonEntry(exportSummary), mode: 0o600 },
    { path: "diagnostics/environment.json", data: serializeJsonEntry(diagnostics), mode: 0o600 },
    ...externalized.mediaEntries,
    ...workspace.entries,
  ];
  const data = createTarGz(entries);
  if (data.length > DEBUG_BUNDLE_MAX_BYTES) {
    throw new Error(`Debug bundle is too large (${data.length} bytes). Exclude large files or media and try again.`);
  }
  return { filename: debugBundleFilename(params.sessionId, params.firstMessage), data, manifest };
}

function parseManifest(value: unknown): DebugBundleManifest {
  if (!isRecord(value) || value.kind !== "pi-web-debug-bundle" || value.schemaVersion !== DEBUG_BUNDLE_SCHEMA_VERSION) {
    throw new Error("Unsupported debug bundle manifest");
  }
  return value as unknown as DebugBundleManifest;
}

function sandboxBaseDir(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return path.join(homedir(), `pi-cwd-${y}${m}${d}`);
}

function targetCwdForManifest(manifest: DebugBundleManifest, create: boolean): string {
  const base = sandboxBaseDir();
  const slug = sanitizeFilePart(manifest.source.sessionName || manifest.source.sessionId).slice(0, 48);
  let target = path.join(base, `pi-debug-${slug}`);
  if (!create) return target;
  fs.mkdirSync(base, { recursive: true });
  let attempt = 1;
  while (fs.existsSync(target)) {
    attempt += 1;
    target = path.join(base, `pi-debug-${slug}-${attempt}`);
  }
  return target;
}

export function inspectDebugBundle(data: Buffer): DebugBundleSummary {
  if (data.length > DEBUG_BUNDLE_MAX_BYTES) throw new Error("Debug bundle is too large");
  const files = parseTarGz(data);
  const manifestEntry = files.get("manifest.json");
  const sessionEntry = files.get("session/session.jsonl");
  if (!manifestEntry || !sessionEntry) throw new Error("Debug bundle is missing manifest.json or session/session.jsonl");
  const manifest = parseManifest(JSON.parse(manifestEntry.data.toString("utf8")) as unknown);
  const session = parseSessionJsonl(sessionEntry.data);
  if (session.header.id !== manifest.session.originalId) {
    throw new Error("Debug bundle manifest/session id mismatch");
  }
  for (const media of manifest.media) {
    const item = files.get(media.path);
    if (!item) throw new Error(`Debug bundle is missing media file: ${media.path}`);
    if (sha256(item.data) !== media.sha256) throw new Error(`Debug bundle media checksum mismatch: ${media.path}`);
  }
  for (const file of manifest.workspace.files) {
    const item = files.get(`workspace/${file.path}`);
    if (!item) throw new Error(`Debug bundle is missing workspace file: ${file.path}`);
    if (sha256(item.data) !== file.sha256) throw new Error(`Debug bundle workspace checksum mismatch: ${file.path}`);
  }
  const fileBytes = manifest.workspace.files.reduce((sum, item) => sum + item.size, 0);
  const mediaBytes = manifest.media.reduce((sum, item) => sum + item.size, 0);
  const warnings = [...manifest.warnings];
  if (manifest.source.platform !== process.platform) {
    warnings.push(`Source platform is ${manifest.source.platform}; importing on ${process.platform}. Original absolute paths will be metadata only.`);
  }
  return {
    manifest,
    targetCwd: targetCwdForManifest(manifest, false),
    sessionId: manifest.session.originalId,
    fileCount: manifest.workspace.files.length,
    fileBytes,
    mediaCount: manifest.media.length,
    mediaBytes,
    warnings,
  };
}

function newSessionId(existingIds: Set<string>): string {
  let id = crypto.randomUUID();
  while (existingIds.has(id)) id = crypto.randomUUID();
  existingIds.add(id);
  return id;
}

function sessionDirForImportedCwd(cwd: string): string {
  return SessionManager.create(cwd).getSessionDir();
}

function timestampForFile(value: string): string {
  const date = new Date(value);
  const source = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  return source.replace(/[:.]/g, "-");
}

export function importDebugBundle(data: Buffer, existingSessionIds: Set<string>): ImportedDebugBundle {
  const files = parseTarGz(data);
  const summary = inspectDebugBundle(data);
  const targetCwd = targetCwdForManifest(summary.manifest, true);
  fs.mkdirSync(targetCwd, { recursive: true });

  let restoredFiles = 0;
  let restoredBytes = 0;
  for (const file of summary.manifest.workspace.files) {
    const archivePath = `workspace/${file.path}`;
    const item = files.get(archivePath);
    if (!item) throw new Error(`Workspace file missing during import: ${file.path}`);
    const safeRel = safeArchivePath(file.path);
    if (!safeRel) throw new Error(`Unsafe workspace path during import: ${file.path}`);
    const targetPath = path.join(targetCwd, safeRel);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (fs.existsSync(targetPath)) throw new Error(`Refusing to overwrite workspace file: ${targetPath}`);
    fs.writeFileSync(targetPath, item.data, { mode: item.mode });
    try {
      fs.utimesSync(targetPath, item.mtime, item.mtime);
    } catch {
      // Best-effort mtime restore.
    }
    restoredFiles += 1;
    restoredBytes += item.data.length;
  }

  const sessionEntry = files.get("session/session.jsonl");
  if (!sessionEntry) throw new Error("Debug bundle session missing during import");
  const parsed = parseSessionJsonl(sessionEntry.data);
  const rehydratedEntries = rehydrateMedia(parsed.entries, files);
  const header: SessionHeader = {
    ...parsed.header,
    cwd: targetCwd,
    id: existingSessionIds.has(parsed.header.id) ? newSessionId(existingSessionIds) : parsed.header.id,
    parentSession: undefined,
  };
  existingSessionIds.add(header.id);

  const sessionDir = sessionDirForImportedCwd(targetCwd);
  fs.mkdirSync(sessionDir, { recursive: true });
  let sessionFilePath = path.join(sessionDir, `${timestampForFile(header.timestamp)}_${header.id}.jsonl`);
  while (fs.existsSync(sessionFilePath)) {
    header.id = newSessionId(existingSessionIds);
    sessionFilePath = path.join(sessionDir, `${timestampForFile(new Date().toISOString())}_${header.id}.jsonl`);
  }
  fs.writeFileSync(sessionFilePath, serializeSessionJsonl(header, rehydratedEntries), { flag: "wx" });
  const manager = SessionManager.open(sessionFilePath, sessionDir, targetCwd);
  const openedHeader = manager.getHeader();
  if (!openedHeader) throw new Error("Imported debug bundle session has no valid header");
  const entries = manager.getEntries() as unknown as SessionEntry[];
  const firstUser = entries.find((entry) => entry.type === "message" && entry.message.role === "user");
  const firstContent = firstUser?.type === "message" ? firstUser.message.content : "";
  const firstMessage = typeof firstContent === "string"
    ? firstContent || "(no messages)"
    : Array.isArray(firstContent)
      ? (firstContent.find((block) => block.type === "text") as { text?: string } | undefined)?.text || "(no messages)"
      : "(no messages)";
  const info: SessionInfo = {
    path: sessionFilePath,
    id: openedHeader.id,
    cwd: openedHeader.cwd ?? targetCwd,
    name: undefined,
    created: openedHeader.timestamp,
    modified: new Date().toISOString(),
    messageCount: entries.filter((entry) => entry.type === "message" || entry.type === "custom_message").length,
    firstMessage,
  };

  return {
    session: info,
    targetCwd,
    restoredFiles,
    restoredBytes,
    warnings: summary.warnings,
    sessionFilePath,
  };
}
