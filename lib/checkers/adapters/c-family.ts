import fs from "node:fs";
import path from "node:path";
import type { CheckerAdapter } from "../adapter-types";
import type { ProjectContext } from "../discovery";
import { resolveInsideProject } from "../discovery";
import { parseLocationLine, resolveExecutable } from "../common";
import type { CheckerDiagnostic } from "../types";

const MAX_C_SOURCES = 120;
const COMPILE_DATABASE_CANDIDATES = [
  "compile_commands.json",
  "build/compile_commands.json",
  "cmake-build-debug/compile_commands.json",
  "cmake-build-release/compile_commands.json",
  "out/build/compile_commands.json",
];

interface CompileCommandEntry {
  directory?: unknown;
  file?: unknown;
}

export function compileDatabase(project: ProjectContext): { path: string; directory: string; sources: string[] } | null {
  for (const candidate of COMPILE_DATABASE_CANDIDATES) {
    const databasePath = resolveInsideProject(project.root, candidate);
    if (!databasePath || !fs.existsSync(databasePath)) continue;
    let entries: unknown;
    try {
      const stat = fs.statSync(databasePath);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) continue;
      entries = JSON.parse(fs.readFileSync(databasePath, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    const sources: string[] = [];
    for (const rawEntry of entries) {
      if (!rawEntry || typeof rawEntry !== "object") continue;
      const entry = rawEntry as CompileCommandEntry;
      if (typeof entry.directory !== "string" || typeof entry.file !== "string" || !/\.(?:c|cc|cpp|cxx)$/i.test(entry.file)) continue;
      const directory = path.isAbsolute(entry.directory)
        ? entry.directory
        : path.resolve(project.root, entry.directory);
      const file = resolveInsideProject(project.root, path.resolve(directory, entry.file));
      if (file) {
        sources.push(file);
        if (sources.length >= MAX_C_SOURCES) break;
      }
    }
    if (sources.length > 0) return { path: databasePath, directory: path.dirname(databasePath), sources };
  }
  return null;
}

export function parseClangTidy(project: ProjectContext, checkerId: string, output: string): CheckerDiagnostic[] {
  return output
    .split(/\r?\n/)
    .map((line) => parseLocationLine(line, project.root, checkerId, "c"))
    .filter((diagnostic): diagnostic is CheckerDiagnostic => diagnostic !== null)
    .slice(0, 2_000);
}

export const cFamilyAdapter: CheckerAdapter = {
  id: "c-clang-tidy",
  language: "c",
  label: "C / C++ · clang-tidy",
  detect: (project) => project.entries.has("CMakeLists.txt")
    || project.entries.has("compile_commands.json")
    || project.sourceFiles.some((file) => /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i.test(file)),
  availability(project) {
    if (!compileDatabase(project)) {
      return { available: false, reason: "c.compileDatabaseMissing" };
    }
    return resolveExecutable("clang-tidy", project.root)
      ? { available: true }
      : { available: false, reason: "c.clangTidyMissing" };
  },
  async createInvocation(project) {
    const executable = resolveExecutable("clang-tidy", project.root);
    const database = compileDatabase(project);
    if (!executable) throw new Error("clang-tidy is not available.");
    if (!database) throw new Error("A valid compile_commands.json is required.");
    return {
      command: executable,
      args: ["-p", database.directory, ...database.sources],
      cwd: project.root,
    };
  },
  parse(project, checkerId, output) {
    return parseClangTidy(project, checkerId, `${output.stdout}\n${output.stderr}`);
  },
};
