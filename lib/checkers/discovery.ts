import fs from "node:fs";
import path from "node:path";

export interface ProjectContext {
  workspaceRoot: string;
  root: string;
  relativeRoot: string;
  entries: Set<string>;
  sourceFiles: string[];
}

export interface ProjectScan {
  projects: ProjectContext[];
  scannedDirectories: number;
  truncated: boolean;
}

const MAX_DIRECTORIES = 400;
const MAX_FILES = 8_000;
const MAX_DEPTH = 5;
const SOURCE_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx",
  ".java", ".go", ".py", ".rs",
]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".idea",
  ".gradle",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  "node_modules",
  "vendor",
  "target",
  "build",
  "dist",
  "coverage",
  ".cache",
]);

interface ScannedDirectory {
  absolutePath: string;
  relativePath: string;
  depth: number;
  entries: Set<string>;
  directSources: string[];
}

function normalizeRelativePath(value: string): string {
  const normalized = value.split(path.sep).join("/");
  return normalized || ".";
}

function withinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sourceExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

export function isSourceFile(filePath: string, extension: string): boolean {
  return sourceExtension(filePath) === extension;
}

function collectDirectories(workspaceRoot: string): {
  directories: ScannedDirectory[];
  truncated: boolean;
} {
  const directories: ScannedDirectory[] = [];
  const pending = [{ absolutePath: workspaceRoot, relativePath: ".", depth: 0 }];
  let fileCount = 0;
  let truncated = false;

  while (pending.length > 0) {
    const current = pending.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }

    const directory: ScannedDirectory = {
      ...current,
      entries: new Set(),
      directSources: [],
    };
    directories.push(directory);

    for (const entry of entries) {
      directory.entries.add(entry.name);
      if (entry.isFile()) {
        fileCount += 1;
        if (SOURCE_EXTENSIONS.has(sourceExtension(entry.name))) {
          directory.directSources.push(path.join(current.absolutePath, entry.name));
        }
        if (fileCount >= MAX_FILES) {
          truncated = true;
          break;
        }
      } else if (
        entry.isDirectory()
        && !IGNORED_DIRECTORIES.has(entry.name.toLowerCase())
        && !entry.name.startsWith(".")
      ) {
        if (current.depth >= MAX_DEPTH) {
          truncated = true;
          continue;
        }
        pending.push({
          absolutePath: path.join(current.absolutePath, entry.name),
          relativePath: current.relativePath === "."
            ? entry.name
            : path.join(current.relativePath, entry.name),
          depth: current.depth + 1,
        });
      }
    }

    if (directories.length >= MAX_DIRECTORIES || fileCount >= MAX_FILES) {
      if (pending.length > 0) truncated = true;
      break;
    }
  }

  return { directories, truncated };
}

function hasLanguageMarker(entries: Set<string>, language: string): boolean {
  switch (language) {
    case "python":
      return ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "tox.ini"]
        .some((name) => entries.has(name));
    case "java":
      return ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"]
        .some((name) => entries.has(name));
    case "c":
      return ["CMakeLists.txt", "compile_commands.json"]
        .some((name) => entries.has(name));
    case "go":
      return entries.has("go.mod");
    case "rust":
      return entries.has("Cargo.toml");
    default:
      return false;
  }
}

function sourceLanguages(files: string[]): Set<string> {
  const languages = new Set<string>();
  for (const source of files) {
    const extension = sourceExtension(source);
    if (extension === ".py") languages.add("python");
    else if (extension === ".java") languages.add("java");
    else if ([".c", ".h"].includes(extension)) languages.add("c");
    else if (extension === ".go") languages.add("go");
    else if (extension === ".rs") languages.add("rust");
    else if ([".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx"].includes(extension)) languages.add("c");
  }
  return languages;
}

function projectHasAncestorMarker(directory: ScannedDirectory, language: string, directories: ScannedDirectory[]): boolean {
  return directories.some((candidate) => (
    candidate.absolutePath !== directory.absolutePath
    && withinRoot(candidate.absolutePath, directory.absolutePath)
    && hasLanguageMarker(candidate.entries, language)
  ));
}

function hasWorkspaceMarker(directories: ScannedDirectory[], language: string): boolean {
  if (language === "go") return directories.some((directory) => directory.entries.has("go.work"));
  if (language === "rust") {
    return directories.some((directory) => {
      if (!directory.entries.has("Cargo.toml")) return false;
      try {
        const manifest = path.join(directory.absolutePath, "Cargo.toml");
        if (fs.statSync(manifest).size > 1024 * 1024) return false;
        return /^\s*\[\s*workspace\s*\]\s*(?:#.*)?$/m.test(fs.readFileSync(manifest, "utf8"));
      } catch {
        return false;
      }
    });
  }
  return false;
}

export function scanWorkspace(workspacePath: string): ProjectScan {
  const workspaceRoot = fs.realpathSync.native(workspacePath);
  const { directories, truncated } = collectDirectories(workspaceRoot);
  if (directories.length === 0) {
    return { projects: [], scannedDirectories: 0, truncated };
  }
  const candidateRoots = new Map<string, ScannedDirectory>();
  const workspaceMarkers = new Set<string>();

  for (const directory of directories) {
    for (const language of ["python", "java", "c", "go", "rust"]) {
      if (!hasLanguageMarker(directory.entries, language)) continue;
      if (projectHasAncestorMarker(directory, language, directories)) continue;
      candidateRoots.set(`${language}:${directory.absolutePath}`, directory);
      workspaceMarkers.add(language);
    }
  }

  const allFiles = directories.flatMap((directory) => directory.directSources);
  const workspaceRootDirectory = directories[0];
  for (const language of sourceLanguages(allFiles)) {
    if (!workspaceMarkers.has(language) && !hasWorkspaceMarker(directories, language)) {
      candidateRoots.set(`${language}:${workspaceRoot}`, workspaceRootDirectory);
    }
  }

  const languageExtension: Record<string, Set<string>> = {
    python: new Set([".py"]),
    java: new Set([".java"]),
    c: new Set([".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx"]),
    go: new Set([".go"]),
    rust: new Set([".rs"]),
  };

  const projects = [...candidateRoots.entries()]
    .map(([key, directory]) => {
      const language = key.slice(0, key.indexOf(":"));
      const root = directory.absolutePath;
      const sourceFiles = allFiles.filter((file) => (
        withinRoot(root, file) && languageExtension[language].has(sourceExtension(file))
      ));
      return {
        workspaceRoot,
        root,
        relativeRoot: normalizeRelativePath(path.relative(workspaceRoot, root)),
        entries: directory.entries,
        sourceFiles,
      } satisfies ProjectContext;
    })
    .sort((a, b) => a.relativeRoot.localeCompare(b.relativeRoot));

  return { projects, scannedDirectories: directories.length, truncated };
}

export function resolveInsideProject(projectRoot: string, filePath: string): string | null {
  const resolved = path.resolve(projectRoot, filePath);
  if (!withinRoot(projectRoot, resolved)) return null;
  try {
    const realRoot = fs.realpathSync.native(projectRoot);
    const realPath = fs.realpathSync.native(resolved);
    return withinRoot(realRoot, realPath) ? realPath : null;
  } catch {
    return null;
  }
}

export function relativeProjectPath(projectRoot: string, filePath: string): string | null {
  const resolved = path.resolve(projectRoot, filePath);
  if (!withinRoot(projectRoot, resolved)) return null;
  let displayPath = resolved;
  let displayRoot = projectRoot;
  try {
    displayRoot = fs.realpathSync.native(projectRoot);
    displayPath = fs.realpathSync.native(resolved);
  } catch {
    // Diagnostics may refer to a just-removed file; keep lexical paths in that case.
  }
  if (!withinRoot(displayRoot, displayPath)) return null;
  return normalizeRelativePath(path.relative(displayRoot, displayPath));
}
