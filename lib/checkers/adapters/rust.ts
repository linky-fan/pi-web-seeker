import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { CheckerAdapter } from "../adapter-types";
import type { ProjectContext } from "../discovery";
import { normalizeDiagnostic, parseJsonLines, resolveExecutable } from "../common";
import type { CheckerDiagnostic } from "../types";

interface CargoMessage {
  reason?: unknown;
  message?: {
    level?: unknown;
    message?: unknown;
    code?: { code?: unknown } | null;
    spans?: Array<{
      file_name?: unknown;
      line_start?: unknown;
      column_start?: unknown;
      line_end?: unknown;
      column_end?: unknown;
      is_primary?: unknown;
    }>;
  };
}

export function parseCargoMessages(project: ProjectContext, checkerId: string, output: string): CheckerDiagnostic[] {
  const diagnostics: CheckerDiagnostic[] = [];
  for (const value of parseJsonLines(output)) {
    if (!value || typeof value !== "object") continue;
    const item = value as CargoMessage;
    if (item.reason !== "compiler-message" || !item.message || typeof item.message.message !== "string") continue;
    const primary = item.message.spans?.find((span) => span.is_primary) ?? item.message.spans?.[0];
    const diagnostic = normalizeDiagnostic({
      checkerId,
      language: "rust",
      projectRoot: project.root,
      path: typeof primary?.file_name === "string" ? primary.file_name : null,
      line: Number(primary?.line_start) || undefined,
      column: Number(primary?.column_start) || undefined,
      endLine: Number(primary?.line_end) || undefined,
      endColumn: Number(primary?.column_end) || undefined,
      severity: item.message.level,
      code: typeof item.message.code?.code === "string" ? item.message.code.code : undefined,
      message: item.message.message.slice(0, 2_000),
    });
    if (diagnostic) diagnostics.push(diagnostic);
  }
  return diagnostics.slice(0, 2_000);
}

function isCargoWorkspace(project: ProjectContext): boolean {
  const manifest = path.join(project.root, "Cargo.toml");
  try {
    if (fs.statSync(manifest).size > 1024 * 1024) return false;
    return /^\s*\[\s*workspace\s*\]\s*(?:#.*)?$/m.test(fs.readFileSync(manifest, "utf8"));
  } catch {
    return false;
  }
}

export const rustClippyAdapter: CheckerAdapter = {
  id: "rust-clippy",
  language: "rust",
  label: "Rust · Clippy",
  detect: (project) => project.entries.has("Cargo.toml"),
  availability(project) {
    return resolveExecutable("cargo", project.root)
      ? { available: true, note: "rust.buildScriptNote" }
      : { available: false, reason: "rust.toolMissing" };
  },
  async createInvocation(project) {
    const executable = resolveExecutable("cargo", project.root);
    if (!executable) throw new Error("Cargo is not available.");
    const cacheKey = createHash("sha256").update(project.root).digest("hex").slice(0, 16);
    return {
      command: executable,
      args: [
        "--offline",
        "--locked",
        "clippy",
        ...(isCargoWorkspace(project) ? ["--workspace"] : []),
        "--all-targets",
        "--message-format=json",
        "--manifest-path",
        path.join(project.root, "Cargo.toml"),
      ],
      cwd: project.root,
      env: {
        CARGO_NET_OFFLINE: "true",
        CARGO_TARGET_DIR: path.join(os.tmpdir(), "pi-web-checkers", "cargo", cacheKey),
      },
    };
  },
  parse(project, checkerId, output) {
    return parseCargoMessages(project, checkerId, output.stdout);
  },
};
