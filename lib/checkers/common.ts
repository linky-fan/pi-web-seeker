import fs from "node:fs";
import path, { delimiter as pathDelimiter } from "node:path";
import type { CheckerDiagnostic, CheckerLanguage, CheckerSeverity } from "./types";
import { relativeProjectPath } from "./discovery";

const ANSI_ESCAPE_RE = new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]`, "g");
const MAX_DIAGNOSTICS = 2_000;
const MAX_MESSAGE_LENGTH = 2_000;

export function resolveExecutable(
  name: string,
  workspaceRoot: string,
  localDirectories: string[] = [],
): string | null {
  const isWindows = process.platform === "win32";
  const pathExtensions = isWindows
    ? (process.env.PATHEXT ?? ".EXE;.COM").split(";").filter((extension) => /\.(?:exe|com)$/i.test(extension))
    : [""];
  const names = isWindows
    ? [name, ...pathExtensions.map((extension) => `${name}${extension}`)]
    : [name];
  const directories = [
    ...localDirectories.map((relative) => path.join(workspaceRoot, relative)),
    ...(process.env.PATH ?? "").split(pathDelimiter).filter(Boolean).map((item) => item.replace(/^"|"$/g, "")),
  ];

  for (const directory of directories) {
    for (const candidateName of names) {
      const candidate = path.resolve(directory, candidateName);
      try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) continue;
        if (!isWindows) fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // Continue through PATH; do not invoke a shell for command discovery.
      }
    }
  }
  return null;
}

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_RE, "").replace(/\r/g, "");
}

export function severityFrom(value: unknown, fallback: CheckerSeverity = "warning"): CheckerSeverity {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "error" || normalized === "fatal" || normalized === "failure") return "error";
  if (normalized === "note" || normalized === "info" || normalized === "information") return "info";
  if (normalized === "warning" || normalized === "warn") return "warning";
  return fallback;
}

export function normalizeDiagnostic(
  input: {
    checkerId: string;
    language: CheckerLanguage;
    projectRoot: string;
    path?: string | null;
    line?: number;
    column?: number;
    endLine?: number;
    endColumn?: number;
    severity?: unknown;
    code?: string;
    message: string;
  },
): CheckerDiagnostic | null {
  const cleanMessage = stripAnsi(input.message).trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!cleanMessage) return null;

  const relativePath = input.path
    ? relativeProjectPath(input.projectRoot, input.path)
    : null;
  const line = Number.isInteger(input.line) && (input.line ?? 0) > 0 ? input.line : undefined;
  const column = Number.isInteger(input.column) && (input.column ?? 0) > 0 ? input.column : undefined;
  const endLine = Number.isInteger(input.endLine) && (input.endLine ?? 0) > 0 ? input.endLine : undefined;
  const endColumn = Number.isInteger(input.endColumn) && (input.endColumn ?? 0) > 0 ? input.endColumn : undefined;
  const code = input.code?.trim().slice(0, 120) || undefined;
  const diagnostic: CheckerDiagnostic = {
    id: `${input.checkerId}:${relativePath ?? ""}:${line ?? 0}:${column ?? 0}:${code ?? cleanMessage}`,
    checkerId: input.checkerId,
    language: input.language,
    path: relativePath,
    severity: severityFrom(input.severity),
    message: cleanMessage,
  };
  if (line) diagnostic.line = line;
  if (column) diagnostic.column = column;
  if (endLine) diagnostic.endLine = endLine;
  if (endColumn) diagnostic.endColumn = endColumn;
  if (code) diagnostic.code = code;
  return diagnostic;
}

export function capDiagnostics(diagnostics: CheckerDiagnostic[]): CheckerDiagnostic[] {
  return diagnostics.slice(0, MAX_DIAGNOSTICS);
}

export function parseLocationLine(
  line: string,
  projectRoot: string,
  checkerId: string,
  language: CheckerLanguage,
): CheckerDiagnostic | null {
  const match = /^(.+?):(\d+)(?::(\d+))?:\s*(error|warning|note|info):\s*(.*?)(?:\s+\[([^\]]+)\])?$/.exec(line.trim());
  if (!match) return null;
  return normalizeDiagnostic({
    checkerId,
    language,
    projectRoot,
    path: match[1],
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : undefined,
    severity: match[4],
    message: match[5],
    code: match[6],
  });
}

export function parseJsonLines(value: string): unknown[] {
  const clean = stripAnsi(value).trim();
  if (!clean) return [];
  try {
    const parsed: unknown = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    // Most compiler tools emit one JSON object per line.
  }
  const entries: unknown[] = [];
  for (const line of clean.split("\n")) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Ignore non-JSON progress lines; the adapter may parse stderr separately.
    }
  }
  return entries;
}

export function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, value: string) => {
      const codePoint = Number(value);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, value: string) => {
      const codePoint = Number.parseInt(value, 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "";
    })
    .replace(/&amp;/g, "&");
}

export function projectRelativeSourceFiles(
  projectRoot: string,
  files: string[],
  extensions: string[],
  limit = 250,
): string[] {
  const allowed = new Set(extensions.map((extension) => extension.toLowerCase()));
  return files
    .filter((file) => allowed.has(path.extname(file).toLowerCase()))
    .filter((file) => relativeProjectPath(projectRoot, file) !== null)
    .slice(0, limit);
}
