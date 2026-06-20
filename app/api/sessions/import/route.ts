import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  cacheSessionPath,
  getSessionListIndex,
  invalidateSessionFileCache,
  invalidateSessionListCache,
} from "@/lib/session-reader";
import { isWindowsStylePath } from "@/lib/path-identity";
import type { FileEntry, SessionEntry, SessionHeader, SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

interface ParsedImport {
  header: SessionHeader;
  entries: SessionEntry[];
}

interface UploadedFileLike {
  size: number;
  text: () => Promise<string>;
}

class ImportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ImportError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUploadedFile(value: unknown): value is UploadedFileLike {
  return typeof value === "object" &&
    value !== null &&
    typeof (value as { size?: unknown }).size === "number" &&
    typeof (value as { text?: unknown }).text === "function";
}

function isSessionHeader(value: unknown): value is SessionHeader {
  return isRecord(value) &&
    value.type === "session" &&
    isValidSessionId(value.id) &&
    typeof value.timestamp === "string" &&
    value.timestamp.trim().length > 0 &&
    typeof value.cwd === "string" &&
    (value.version === undefined || typeof value.version === "number") &&
    (value.parentSession === undefined || typeof value.parentSession === "string");
}

function isSessionEntry(value: unknown): value is SessionEntry {
  return isRecord(value) &&
    typeof value.type === "string" &&
    value.type !== "session" &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    (value.parentId === null || typeof value.parentId === "string") &&
    typeof value.timestamp === "string" &&
    value.timestamp.length > 0;
}

function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value);
}

function hasValidMessageShape(entry: SessionEntry): boolean {
  if (entry.type !== "message") return true;
  const message = entry.message;
  if (!isRecord(message) || typeof message.role !== "string") return false;
  if (message.role === "user") {
    return typeof message.content === "string" || Array.isArray(message.content);
  }
  if (message.role === "assistant") {
    return Array.isArray(message.content);
  }
  if (message.role === "toolResult") {
    return typeof message.toolCallId === "string" && Array.isArray(message.content);
  }
  if (message.role === "custom") {
    return typeof message.customType === "string" &&
      typeof message.display === "boolean" &&
      (typeof message.content === "string" || Array.isArray(message.content));
  }
  return false;
}

function validateEntries(entries: SessionEntry[]): void {
  if (entries.length === 0) {
    throw new ImportError("Import file does not contain any session entries");
  }

  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new ImportError(`Duplicate session entry id: ${entry.id}`);
    }
    ids.add(entry.id);
    if (!Number.isFinite(new Date(entry.timestamp).getTime())) {
      throw new ImportError(`Invalid timestamp for entry ${entry.id}`);
    }
    if (!hasValidMessageShape(entry)) {
      throw new ImportError(`Invalid message entry: ${entry.id}`);
    }
  }

  for (const entry of entries) {
    if (entry.parentId !== null && !ids.has(entry.parentId)) {
      throw new ImportError(`Entry ${entry.id} references missing parent ${entry.parentId}`);
    }
  }
}

function parseJsonlImport(text: string): ParsedImport {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) throw new ImportError("Import file is empty");

  const parsed = lines.map((line, index) => {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      throw new ImportError(`Invalid JSON on line ${index + 1}`);
    }
  });
  const [headerCandidate, ...entryCandidates] = parsed;
  if (!isSessionHeader(headerCandidate)) throw new ImportError("No valid session header found");
  if (entryCandidates.some((entry) => isRecord(entry) && entry.type === "session")) {
    throw new ImportError("Import file contains multiple session headers");
  }
  if (!entryCandidates.every(isSessionEntry)) {
    throw new ImportError("Import file contains invalid session entries");
  }
  const header = headerCandidate;
  const entries = entryCandidates;
  validateEntries(entries);
  return { header, entries };
}

function parseSessionImport(text: string): ParsedImport {
  try {
    const data = JSON.parse(text) as unknown;
    if (isRecord(data) && isSessionHeader(data.header) && Array.isArray(data.entries)) {
      if (!data.entries.every(isSessionEntry)) {
        throw new ImportError("Import file contains invalid session entries");
      }
      const entries = data.entries;
      validateEntries(entries);
      return {
        header: data.header,
        entries,
      };
    }
  } catch (error) {
    if (error instanceof ImportError) throw error;
    // Fall through to JSONL parsing.
  }
  return parseJsonlImport(text);
}

function timestampForFile(value: string): string {
  const date = new Date(value);
  const source = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  return source.replace(/[:.]/g, "-");
}

function storageCwdForImport(cwd: string): string {
  const trimmed = cwd.trim();
  if (!trimmed) return process.cwd();
  if (process.platform !== "win32" && isWindowsStylePath(trimmed)) return process.cwd();
  if (process.platform === "win32" && trimmed.startsWith("/") && !trimmed.startsWith("//")) return process.cwd();
  if (!path.isAbsolute(trimmed)) return process.cwd();
  return trimmed;
}

function sessionDirForImportedCwd(cwd: string): string {
  return SessionManager.create(storageCwdForImport(cwd)).getSessionDir();
}

function newSessionId(existingIds: Set<string>): string {
  let id = randomUUID();
  while (existingIds.has(id)) id = randomUUID();
  existingIds.add(id);
  return id;
}

function firstMessageFromEntries(entries: SessionEntry[]): string {
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const content = entry.message.content;
    if (typeof content === "string") return content || "(no messages)";
    const text = content.find((block) => block.type === "text");
    if (text?.text) return text.text;
  }
  return "(no messages)";
}

function importedSessionInfo(filePath: string, header: SessionHeader, entries: SessionEntry[]): SessionInfo {
  const now = new Date().toISOString();
  return {
    path: filePath,
    id: header.id,
    cwd: header.cwd ?? "",
    name: undefined,
    created: header.timestamp || now,
    modified: now,
    messageCount: entries.filter((entry) => entry.type === "message" || entry.type === "custom_message").length,
    firstMessage: firstMessageFromEntries(entries),
  };
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!isUploadedFile(file)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Import file is empty" }, { status: 400 });
    }
    if (file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json({ error: "Import file is too large" }, { status: 413 });
    }

    const text = await file.text();
    const { header: importedHeader, entries } = parseSessionImport(text);
    if (!Number.isFinite(new Date(importedHeader.timestamp).getTime())) {
      return NextResponse.json({ error: "Import file has an invalid session timestamp" }, { status: 400 });
    }

    const index = await getSessionListIndex({ force: true });
    const existingIds = new Set(index.sessions.map((session) => session.id));
    const storageCwd = storageCwdForImport(importedHeader.cwd);
    const header: SessionHeader = {
      ...importedHeader,
      cwd: storageCwd,
      id: existingIds.has(importedHeader.id) ? newSessionId(existingIds) : importedHeader.id,
    };
    existingIds.add(header.id);
    const sessionDir = sessionDirForImportedCwd(storageCwd);
    mkdirSync(sessionDir, { recursive: true });

    let targetPath = path.join(sessionDir, `${timestampForFile(header.timestamp)}_${header.id}.jsonl`);
    while (existsSync(targetPath)) {
      header.id = newSessionId(existingIds);
      targetPath = path.join(sessionDir, `${timestampForFile(new Date().toISOString())}_${header.id}.jsonl`);
    }
    const allEntries: FileEntry[] = [header, ...entries];

    writeFileSync(
      targetPath,
      `${allEntries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      { flag: "wx" }
    );

    const manager = SessionManager.open(targetPath, sessionDir, storageCwd);
    const openedHeader = manager.getHeader();
    if (!openedHeader) {
      throw new Error("Imported file does not contain a valid session");
    }

    invalidateSessionFileCache(targetPath);
    invalidateSessionListCache();
    cacheSessionPath(openedHeader.id, targetPath);

    return NextResponse.json({
      ok: true,
      session: importedSessionInfo(targetPath, openedHeader as SessionHeader, manager.getEntries() as unknown as SessionEntry[]),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: error instanceof ImportError ? error.status : 400 }
    );
  }
}
