import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type { CheckerAdapter } from "../adapter-types";
import type { ProjectContext } from "../discovery";
import { capDiagnostics, normalizeDiagnostic, parseLocationLine, parseJsonLines, resolveExecutable } from "../common";
import type { CheckerDiagnostic } from "../types";

const VENV_TOOL_PATHS = [".venv/Scripts", "venv/Scripts", ".venv/bin", "venv/bin"];

function ruffExecutable(project: ProjectContext): string | null {
  return resolveExecutable("ruff", project.root, VENV_TOOL_PATHS);
}

function mypyExecutable(project: ProjectContext): string | null {
  return resolveExecutable("mypy", project.root, VENV_TOOL_PATHS);
}

function workspaceToolNote(project: ProjectContext, executable: string): string | undefined {
  const fromWorkspaceVenv = VENV_TOOL_PATHS.some((directory) => {
    const relative = path.relative(path.resolve(project.root, directory), executable);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  });
  return fromWorkspaceVenv ? "python.workspaceTool" : undefined;
}

export function parseRuff(project: ProjectContext, checkerId: string, output: string): CheckerDiagnostic[] {
  const entries = parseJsonLines(output);
  const diagnostics: CheckerDiagnostic[] = [];
  for (const value of entries) {
    if (!value || typeof value !== "object") continue;
    const item = value as {
      filename?: unknown;
      location?: { row?: unknown; column?: unknown };
      end_location?: { row?: unknown; column?: unknown };
      code?: unknown;
      message?: unknown;
    };
    if (typeof item.message !== "string") continue;
    const diagnostic = normalizeDiagnostic({
      checkerId,
      language: "python",
      projectRoot: project.root,
      path: typeof item.filename === "string" ? item.filename : null,
      line: Number(item.location?.row) || undefined,
      column: Number(item.location?.column) || undefined,
      endLine: Number(item.end_location?.row) || undefined,
      endColumn: Number(item.end_location?.column) || undefined,
      severity: "warning",
      code: typeof item.code === "string" ? item.code : undefined,
      message: item.message,
    });
    if (diagnostic) diagnostics.push(diagnostic);
  }
  return capDiagnostics(diagnostics);
}

export function parseMypy(project: ProjectContext, checkerId: string, output: string): CheckerDiagnostic[] {
  return capDiagnostics(output
    .split(/\r?\n/)
    .map((line) => parseLocationLine(line, project.root, checkerId, "python"))
    .filter((diagnostic): diagnostic is CheckerDiagnostic => diagnostic !== null));
}

export const pythonRuffAdapter: CheckerAdapter = {
  id: "python-ruff",
  language: "python",
  label: "Python · Ruff",
  detect: (project) => project.entries.has("pyproject.toml")
    || project.entries.has("setup.py")
    || project.entries.has("setup.cfg")
    || project.entries.has("requirements.txt")
    || project.sourceFiles.some((file) => file.toLowerCase().endsWith(".py")),
  availability(project) {
    const executable = ruffExecutable(project);
    return executable
      ? { available: true, note: workspaceToolNote(project, executable) }
      : { available: false, reason: "python.ruffMissing" };
  },
  async createInvocation(project) {
    const executable = ruffExecutable(project);
    if (!executable) throw new Error("Ruff is not available.");
    return {
      command: executable,
      args: ["check", "--output-format=json", "."],
      cwd: project.root,
    };
  },
  parse(project, checkerId, output) {
    return parseRuff(project, checkerId, output.stdout);
  },
};

export const pythonMypyAdapter: CheckerAdapter = {
  id: "python-mypy",
  language: "python",
  label: "Python · mypy",
  detect: pythonRuffAdapter.detect,
  availability(project) {
    const executable = mypyExecutable(project);
    return executable
      ? { available: true, note: workspaceToolNote(project, executable) }
      : { available: false, reason: "python.mypyMissing" };
  },
  async createInvocation(project) {
    const executable = mypyExecutable(project);
    if (!executable) throw new Error("mypy is not available.");
    const cacheKey = createHash("sha256").update(project.root).digest("hex").slice(0, 16);
    const cacheDirectory = path.join(os.tmpdir(), "pi-web-checkers", "mypy", cacheKey);
    return {
      command: executable,
      args: ["--no-incremental", "--show-column-numbers", "--show-error-codes", "--cache-dir", cacheDirectory, "."],
      cwd: project.root,
    };
  },
  parse(project, checkerId, output) {
    return parseMypy(project, checkerId, `${output.stdout}\n${output.stderr}`);
  },
};
