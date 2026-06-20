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
    typeof value.id === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.cwd === "string";
}

function isSessionEntry(value: unknown): value is SessionEntry {
  return isRecord(value) && typeof value.type === "string" && value.type !== "session";
}

function parseJsonlImport(text: string): ParsedImport {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const parsed = lines.map((line) => JSON.parse(line) as unknown);
  const header = parsed.find(isSessionHeader);
  if (!header) throw new Error("No session header found");
  const entries = parsed.filter(isSessionEntry);
  return { header, entries };
}

function parseSessionImport(text: string): ParsedImport {
  try {
    const data = JSON.parse(text) as unknown;
    if (isRecord(data) && isSessionHeader(data.header) && Array.isArray(data.entries)) {
      return {
        header: data.header,
        entries: data.entries.filter(isSessionEntry),
      };
    }
  } catch {
    // Fall through to JSONL parsing.
  }
  return parseJsonlImport(text);
}

function timestampForFile(value: string): string {
  const date = new Date(value);
  const source = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  return source.replace(/[:.]/g, "-");
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
    const index = await getSessionListIndex({ force: true });
    const existingIds = new Set(index.sessions.map((session) => session.id));
    const header: SessionHeader = {
      ...importedHeader,
      id: existingIds.has(importedHeader.id) ? newSessionId(existingIds) : importedHeader.id,
    };
    const sessionDir = SessionManager.create(header.cwd || process.cwd()).getSessionDir();
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

    const manager = SessionManager.open(targetPath);
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
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
