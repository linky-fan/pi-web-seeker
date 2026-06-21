#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = path.join(ROOT, "templates", "agents");
const REQUIRED_SECTIONS = ["Commands", "Architecture", "Critical Rules", "Common Flows", "Traps", "Verification"];
const DEFAULT_MAX_TOKENS = 2500;
const DEFAULT_SECTION_MAX_TOKENS = 650;
const ARCHITECT_PROMPT_PATH = path.join(TEMPLATE_DIR, "agents-architect.prompt.md");

const SAFE_TEXT_FILES = new Set([
  "README.md",
  "README",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "Dockerfile",
  "docker-compose.yml",
  "compose.yml",
  "Makefile",
  "AGENTS.md",
]);

const IGNORED_ROOT_NAMES = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
]);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function approxTokens(text) {
  return Math.ceil(text.length / 4);
}

function readTextIfSafe(dir, fileName, maxBytes = 80_000) {
  if (!SAFE_TEXT_FILES.has(fileName) && !fileName.endsWith(".md")) return null;
  const filePath = path.join(dir, fileName);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function rootEntries(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !IGNORED_ROOT_NAMES.has(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function hasFile(dir, name) {
  return fs.existsSync(path.join(dir, name));
}

function hasAnyFile(dir, names) {
  return names.some((name) => hasFile(dir, name));
}

function packageManagerFor(dir, pkg) {
  if (typeof pkg?.packageManager === "string" && pkg.packageManager.trim()) {
    return pkg.packageManager.split("@")[0];
  }
  if (hasFile(dir, "pnpm-lock.yaml")) return "pnpm";
  if (hasFile(dir, "yarn.lock")) return "yarn";
  if (hasFile(dir, "bun.lockb") || hasFile(dir, "bun.lock")) return "bun";
  if (hasFile(dir, "package-lock.json")) return "npm";
  return null;
}

function scriptCommand(packageManager, scriptName) {
  if (!packageManager || packageManager === "npm") return `npm run ${scriptName}`;
  if (packageManager === "yarn") return `yarn ${scriptName}`;
  if (packageManager === "bun") return `bun run ${scriptName}`;
  return `${packageManager} run ${scriptName}`;
}

function addUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function compactList(values, max = 8) {
  return values.slice(0, max);
}

function detectProject(dir) {
  const resolvedDir = path.resolve(String(dir ?? process.cwd()));
  const entries = rootEntries(resolvedDir);
  const rootFiles = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const rootDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const pkg = readJson(path.join(resolvedDir, "package.json"));
  const scripts = pkg && typeof pkg === "object" && pkg.scripts && typeof pkg.scripts === "object"
    ? Object.fromEntries(Object.entries(pkg.scripts).filter(([, value]) => typeof value === "string"))
    : {};
  const dependencies = {
    ...((pkg && typeof pkg === "object" && pkg.dependencies && typeof pkg.dependencies === "object") ? pkg.dependencies : {}),
    ...((pkg && typeof pkg === "object" && pkg.devDependencies && typeof pkg.devDependencies === "object") ? pkg.devDependencies : {}),
  };
  const depNames = Object.keys(dependencies);
  const pyproject = readTextIfSafe(resolvedDir, "pyproject.toml");
  const requirements = readTextIfSafe(resolvedDir, "requirements.txt");
  const readme = readTextIfSafe(resolvedDir, "README.md") ?? readTextIfSafe(resolvedDir, "README");
  const makefile = readTextIfSafe(resolvedDir, "Makefile");
  const dockerFiles = ["Dockerfile", "docker-compose.yml", "compose.yml"].filter((name) => hasFile(resolvedDir, name));
  const evidence = [];
  const languages = [];
  const frameworks = [];
  const tools = [];
  const warnings = [];
  const questions = [];

  if (pkg) {
    addUnique(languages, "JavaScript/TypeScript");
    evidence.push("package.json");
  }
  if (hasAnyFile(resolvedDir, ["tsconfig.json", "tsconfig.base.json"])) addUnique(languages, "TypeScript");
  if (pyproject || requirements || rootDirs.includes("tests") || rootDirs.includes("src")) {
    const hasPythonSignal = pyproject || requirements || rootFiles.some((name) => name.endsWith(".py"));
    if (hasPythonSignal) addUnique(languages, "Python");
  }
  if (depNames.includes("next") || rootDirs.includes("app") && hasFile(resolvedDir, "next.config.mjs")) {
    addUnique(frameworks, "Next.js");
    evidence.push(depNames.includes("next") ? "next dependency" : "next.config.mjs");
  }
  if (depNames.includes("react")) addUnique(frameworks, "React");
  if (depNames.includes("vite") || hasFile(resolvedDir, "vite.config.ts") || hasFile(resolvedDir, "vite.config.js")) addUnique(frameworks, "Vite");
  if (pyproject) {
    evidence.push("pyproject.toml");
    if (/\bpytest\b/i.test(pyproject)) addUnique(tools, "pytest");
    if (/\bruff\b/i.test(pyproject)) addUnique(tools, "ruff");
    if (/\bmypy\b/i.test(pyproject)) addUnique(tools, "mypy");
    if (/\bblack\b/i.test(pyproject)) addUnique(tools, "black");
  }
  if (requirements) {
    evidence.push("requirements.txt");
    if (/\bpytest\b/i.test(requirements)) addUnique(tools, "pytest");
    if (/\bruff\b/i.test(requirements)) addUnique(tools, "ruff");
    if (/\bmypy\b/i.test(requirements)) addUnique(tools, "mypy");
  }
  if (dockerFiles.length > 0) {
    addUnique(frameworks, "Docker");
    addUnique(tools, "Docker");
    evidence.push(...dockerFiles);
  }
  if (hasFile(resolvedDir, "turbo.json")) addUnique(tools, "Turborepo");
  if (hasFile(resolvedDir, "pnpm-workspace.yaml")) addUnique(tools, "pnpm workspace");
  if (depNames.includes("eslint") || scripts.lint) addUnique(tools, "ESLint");
  if (depNames.includes("typescript") || hasAnyFile(resolvedDir, ["tsconfig.json", "tsconfig.base.json"])) addUnique(tools, "TypeScript compiler");
  if (depNames.includes("vitest") || scripts.test?.includes("vitest")) addUnique(tools, "Vitest");
  if (depNames.includes("jest") || scripts.test?.includes("jest")) addUnique(tools, "Jest");
  if (makefile) evidence.push("Makefile");
  if (readme) evidence.push("README");

  const packageManager = packageManagerFor(resolvedDir, pkg);
  const commands = [];
  if (scripts.dev) commands.push({ label: "Dev", command: scriptCommand(packageManager, "dev"), source: "package.json scripts.dev" });
  if (scripts.typecheck) commands.push({ label: "Typecheck", command: scriptCommand(packageManager, "typecheck"), source: "package.json scripts.typecheck" });
  else if (depNames.includes("typescript") || hasAnyFile(resolvedDir, ["tsconfig.json", "tsconfig.base.json"])) {
    commands.push({ label: "Typecheck", command: "node_modules/.bin/tsc --noEmit", source: "typescript dependency or tsconfig" });
  }
  if (scripts.lint) commands.push({ label: "Lint", command: scriptCommand(packageManager, "lint"), source: "package.json scripts.lint" });
  if (scripts.test) commands.push({ label: "Test", command: scriptCommand(packageManager, "test"), source: "package.json scripts.test" });
  if (pyproject || requirements) {
    if (tools.includes("pytest")) commands.push({ label: "Test", command: "pytest", source: "Python test tooling" });
    if (tools.includes("ruff")) commands.push({ label: "Lint", command: "ruff check .", source: "Python lint tooling" });
    if (tools.includes("mypy")) commands.push({ label: "Typecheck", command: "mypy .", source: "Python type tooling" });
  }
  if (dockerFiles.includes("docker-compose.yml") || dockerFiles.includes("compose.yml")) {
    commands.push({ label: "Compose", command: "docker compose up", source: "compose file" });
  }

  const codeSignals = rootFiles.filter((name) => !/^(README(?:\.md)?|LICENSE|AGENTS\.md)$/i.test(name)).length +
    rootDirs.filter((name) => !["docs", "templates"].includes(name)).length;
  const isEmpty = codeSignals === 0;
  const template = frameworks.includes("Next.js")
    ? "next-app"
    : frameworks.includes("Docker") && commands.length <= 2
      ? "docker-service"
      : languages.includes("Python") && !pkg
        ? "python"
        : "standard";

  if (isEmpty) {
    questions.push("What kind of project is this, and who will work on it?");
    questions.push("Which commands should agents use for development, tests, linting, and release?");
    questions.push("Which files, data, or operations should agents avoid touching?");
  }
  if (commands.length === 0) questions.push("Confirm the canonical dev/test/lint commands before relying on this AGENTS.md.");
  if (!readme) warnings.push("No README found; generated architecture notes are based only on file names.");

  return {
    dir: resolvedDir,
    projectName: typeof pkg?.name === "string" ? pkg.name : path.basename(resolvedDir),
    packageManager,
    template,
    isEmpty,
    rootFiles: compactList(rootFiles),
    rootDirs: compactList(rootDirs),
    languages,
    frameworks,
    tools,
    scripts,
    commands,
    evidence: compactList(evidence, 12),
    warnings,
    questions,
  };
}

function architectureBullets(profile) {
  const bullets = [];
  const dirs = new Set(profile.rootDirs);
  if (dirs.has("app")) bullets.push("`app/` - application routes, pages, layouts, or API handlers.");
  if (dirs.has("components")) bullets.push("`components/` - reusable UI and client components.");
  if (dirs.has("lib")) bullets.push("`lib/` - shared helpers and integration code.");
  if (dirs.has("src")) bullets.push("`src/` - primary application or package source.");
  if (dirs.has("tests")) bullets.push("`tests/` - automated test suite.");
  if (dirs.has("public")) bullets.push("`public/` - static assets.");
  if (dirs.has("docs")) bullets.push("`docs/` - project documentation and lower-frequency agent notes.");
  if (profile.frameworks.includes("Docker")) {
    if (profile.rootFiles.includes("Dockerfile")) bullets.push("`Dockerfile` - container image build.");
    if (profile.rootFiles.includes("docker-compose.yml") || profile.rootFiles.includes("compose.yml")) bullets.push("Compose file - local service wiring.");
  }
  if (bullets.length === 0) bullets.push("- TODO: Describe the main source, test, config, and documentation directories.");
  return bullets;
}

function draftAgentsMarkdown(profile) {
  const lines = [];
  const commandLines = profile.commands.length > 0
    ? profile.commands.map((item) => `- ${item.label}: \`${item.command}\`.`)
    : ["- TODO: Confirm development, test, lint, and release commands with the project owner."];
  const architecture = architectureBullets(profile);
  const isNext = profile.frameworks.includes("Next.js");
  const isDocker = profile.frameworks.includes("Docker");
  const isPython = profile.languages.includes("Python");

  lines.push(`# ${profile.projectName} - Development Notes`);
  lines.push("");
  lines.push("Generated by the AGENTS Architect from repository evidence. Keep this file short and move long references to `docs/agent-notes/`.");
  if (profile.isEmpty) {
    lines.push("");
    lines.push("> TODO: This project looks empty or early-stage. Confirm the product goal, stack, commands, and safety rules before relying on this file.");
  }
  lines.push("");
  lines.push("## Commands");
  lines.push("");
  lines.push(...commandLines);
  if (isNext && !commandLines.some((line) => line.includes("next build"))) {
    lines.push("- Do not run production builds during ordinary dev unless requested.");
  }
  lines.push("");
  lines.push("## Architecture");
  lines.push("");
  for (const bullet of architecture) lines.push(bullet.startsWith("- ") ? bullet : `- ${bullet}`);
  lines.push("- More details: `docs/agent-notes/architecture.md`");
  lines.push("");
  lines.push("## Critical Rules");
  lines.push("");
  lines.push("- Never revert user changes unless explicitly requested.");
  lines.push("- Keep secrets, API keys, auth files, local data, and private paths out of commits, logs, screenshots, and generated docs.");
  lines.push("- Prefer existing project scripts and documented workflows over ad hoc commands.");
  lines.push("- Keep generated files, caches, build output, and vendored dependencies untouched unless the task explicitly requires them.");
  if (isDocker) lines.push("- Keep host-mounted data and container paths clearly separated.");
  if (isNext) lines.push("- Avoid editing generated `.next/` output.");
  lines.push("");
  lines.push("## Common Flows");
  lines.push("");
  if (isNext || profile.frameworks.includes("React")) {
    lines.push("- UI changes: edit the relevant component or route, run type/lint checks, then smoke-test the affected page in a browser.");
    lines.push("- API changes: inspect the route handler and shared helper together; verify success and error paths.");
  } else if (isPython) {
    lines.push("- Library or CLI changes: edit source and matching tests together, then run the focused test command.");
    lines.push("- Data/config changes: verify sample inputs and document any required local setup.");
  } else {
    lines.push("- Feature changes: inspect the owning module, update focused tests, then run the smallest useful verification command.");
    lines.push("- Config/dependency changes: prefer documented scripts and note any local setup assumptions.");
  }
  if (isDocker) lines.push("- Docker changes: verify compose startup, bind mounts, environment variables, and network ports.");
  lines.push("");
  lines.push("## Traps");
  lines.push("");
  lines.push("- Do not assume undocumented commands are safe; confirm missing commands before adding them here.");
  if (isNext) lines.push("- Client components can hydrate differently when render logic depends on browser-only state, time, or random values.");
  if (isDocker) lines.push("- Host paths and container paths differ; verify which side a path belongs to before editing or deleting files.");
  if (isPython) lines.push("- Virtualenvs, caches, generated data, and local notebooks should stay out of commits unless explicitly requested.");
  if (profile.isEmpty) lines.push("- This project needs owner input before agents can know the intended stack, workflows, and constraints.");
  lines.push("");
  lines.push("## Verification");
  lines.push("");
  if (profile.commands.length > 0) {
    for (const item of profile.commands.filter((item) => ["Typecheck", "Lint", "Test"].includes(item.label))) {
      lines.push(`- ${item.label}: \`${item.command}\``);
    }
  }
  if (!lines.at(-1)?.startsWith("- ")) lines.push("- TODO: Add the smallest reliable verification command for ordinary changes.");
  if (isNext || profile.frameworks.includes("React")) lines.push("- Browser: load the affected route and check for console errors, clipping, and broken interactions.");
  if (isDocker) lines.push("- Docker: verify container startup, logs, permissions, and exposed ports.");
  lines.push("");
  lines.push("## More Details");
  lines.push("");
  lines.push("- Architecture: `docs/agent-notes/architecture.md`");
  if (isDocker) lines.push("- Deployment/runtime config: `docs/agent-notes/deployment.md`");
  if (isPython) lines.push("- Data formats: `docs/agent-notes/data-formats.md`");
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function draftAgents(options) {
  const dir = path.resolve(String(options.dir ?? process.cwd()));
  const profile = detectProject(dir);
  const markdown = draftAgentsMarkdown(profile);
  const warnings = [...profile.warnings];
  if (approxTokens(markdown) > DEFAULT_MAX_TOKENS) warnings.push(`Draft is about ${approxTokens(markdown)} tokens; keep AGENTS.md below ${DEFAULT_MAX_TOKENS} tokens when possible.`);
  return {
    ok: true,
    dir,
    profile,
    template: profile.template,
    markdown,
    approxTokens: approxTokens(markdown),
    warnings,
    questions: profile.questions,
    architectPromptPath: fs.existsSync(ARCHITECT_PROMPT_PATH) ? ARCHITECT_PROMPT_PATH : null,
  };
}

function listTemplates() {
  return fs.readdirSync(TEMPLATE_DIR)
    .filter((name) => name.endsWith(".AGENTS.md"))
    .map((name) => name.replace(/\.AGENTS\.md$/, ""))
    .sort();
}

function listTemplateOptions() {
  return ["auto", ...listTemplates()];
}

function readTemplate(name) {
  const filePath = path.join(TEMPLATE_DIR, `${name}.AGENTS.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Unknown template "${name}". Available: ${listTemplateOptions().join(", ")}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function commandReferences(text) {
  const refs = [];
  const pattern = /`((?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[A-Za-z0-9:_-]+)`/g;
  let match;
  while ((match = pattern.exec(text))) refs.push(match[1]);
  return refs;
}

function checkReferencedCommands(filePath, text, warnings) {
  const dir = path.dirname(filePath);
  const pkg = readJson(path.join(dir, "package.json"));
  if (!pkg?.scripts || typeof pkg.scripts !== "object") return;
  for (const ref of commandReferences(text)) {
    const parts = ref.split(/\s+/);
    const scriptName = parts[1] === "run" ? parts[2] : parts[1];
    if (scriptName && !pkg.scripts[scriptName]) {
      warnings.push(`Referenced command \`${ref}\` is not present in package.json scripts.`);
    }
  }
}

function checkAgentNotesLinks(filePath, text, warnings) {
  const dir = path.dirname(filePath);
  const refs = new Set();
  for (const match of text.matchAll(/`(docs\/agent-notes\/[^`]+?)`/g)) refs.add(match[1]);
  for (const match of text.matchAll(/\]\((docs\/agent-notes\/[^)]+?)\)/g)) refs.add(match[1]);
  for (const ref of refs) {
    const clean = ref.split("#")[0];
    if (clean && !fs.existsSync(path.join(dir, clean))) {
      warnings.push(`Referenced agent note does not exist yet: ${clean}`);
    }
  }
}

function splitSections(text) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = { title: "(preamble)", level: 0, start: 1, lines: [] };
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#{2,4})\s+(.+?)\s*$/);
    if (match) {
      sections.push(current);
      current = { title: match[2], level: match[1].length, start: i + 1, lines: [lines[i]] };
    } else {
      current.lines.push(lines[i]);
    }
  }
  sections.push(current);
  return sections
    .map((section) => ({ ...section, text: section.lines.join("\n") }))
    .filter((section) => section.text.trim().length > 0);
}

function hasLikelyFileTree(section) {
  const treeLines = section.lines.filter((line) => /^\s*(?:[|` ]{0,4})?(?:├|└|│|[A-Za-z0-9_.-]+\/\s*$)/.test(line));
  return treeLines.length >= 12;
}

function hasLargeCodeBlock(section) {
  const blocks = section.text.match(/```[\s\S]*?```/g) ?? [];
  return blocks.some((block) => approxTokens(block) > 250);
}

function findSensitiveHints(text) {
  const patterns = [
    /\b(api[_-]?key|secret|token|password|authorization)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{12,}/i,
    /\bsk-[A-Za-z0-9_-]{20,}/,
    /-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function checkAgents(filePath, options) {
  const text = fs.readFileSync(filePath, "utf8");
  const maxTokens = Number(options["max-tokens"] ?? DEFAULT_MAX_TOKENS);
  const sectionMaxTokens = Number(options["section-max-tokens"] ?? DEFAULT_SECTION_MAX_TOKENS);
  const sections = splitSections(text);
  const sectionTitles = new Set(sections.map((section) => section.title.toLowerCase()));
  const warnings = [];
  const errors = [];

  const totalTokens = approxTokens(text);
  if (totalTokens > maxTokens) {
    warnings.push(`AGENTS.md is about ${totalTokens} tokens, above the ${maxTokens} token target.`);
  }

  for (const required of REQUIRED_SECTIONS) {
    if (!sectionTitles.has(required.toLowerCase())) {
      warnings.push(`Missing recommended section: ${required}`);
    }
  }

  if (findSensitiveHints(text)) {
    errors.push("Possible secret/API key/token/private key found. Remove it before committing or sharing.");
  }

  checkReferencedCommands(filePath, text, warnings);
  checkAgentNotesLinks(filePath, text, warnings);

  for (const section of sections) {
    const tokens = approxTokens(section.text);
    if (tokens > sectionMaxTokens) {
      warnings.push(`Section "${section.title}" starts at line ${section.start} and is about ${tokens} tokens; consider moving details to docs/agent-notes/.`);
    }
    if (hasLikelyFileTree(section)) {
      warnings.push(`Section "${section.title}" looks like a large file tree; keep only key entry points and link to docs instead.`);
    }
    if (hasLargeCodeBlock(section)) {
      warnings.push(`Section "${section.title}" contains a large code/schema block; move examples to docs and link them.`);
    }
  }

  const summary = {
    file: filePath,
    chars: text.length,
    approxTokens: totalTokens,
    lines: text.split(/\r?\n/).length,
    sections: sections.map((section) => ({
      title: section.title,
      start: section.start,
      approxTokens: approxTokens(section.text),
      lines: section.lines.length,
    })),
    errors,
    warnings,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (errors.length > 0 || (options.strict && warnings.length > 0)) {
    process.exitCode = 1;
  }
}

function initAgents(options) {
  const template = String(options.template ?? "standard");
  const dir = path.resolve(String(options.dir ?? process.cwd()));
  const output = path.resolve(String(options.output ?? path.join(dir, "AGENTS.md")));
  const force = Boolean(options.force);
  const draft = template === "auto" ? draftAgents({ dir }) : null;
  const content = draft ? draft.markdown : readTemplate(template);

  if (fs.existsSync(output) && !force) {
    throw new Error(`${output} already exists. Pass --force to overwrite.`);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content);
  console.log(JSON.stringify({
    ok: true,
    output,
    template: draft?.template ?? template,
    profile: draft?.profile,
    warnings: draft?.warnings ?? [],
    questions: draft?.questions ?? [],
    approxTokens: approxTokens(content),
    message: draft
      ? "AGENTS.md generated from repository evidence. Review TODOs and project-specific traps before relying on it."
      : "AGENTS.md template written. Fill in project-specific commands, flows, and traps before using it.",
  }, null, 2));
}

function printHelp() {
  console.log(`Usage:
  npm run agents -- templates
  npm run agents -- detect --dir /path/to/project
  npm run agents -- draft --dir /path/to/project
  npm run agents:init -- --template standard --dir /path/to/project
  npm run agents:init -- --template auto --dir /path/to/project
  npm run agents:check -- --path /path/to/project/AGENTS.md

Commands:
  init                 Write an AGENTS.md template
  check                Inspect AGENTS.md length, structure, and obvious risks
  detect               Detect a project profile for AGENTS.md generation
  draft                Generate an AGENTS.md draft without writing it
  templates            List available templates

Options:
  --template <name>    Template for init (${listTemplateOptions().join(", ")})
  --dir <path>         Project directory for init
  --output <path>      Output file for init
  --force              Overwrite existing AGENTS.md
  --path <path>        File to check, default ./AGENTS.md
  --max-tokens <n>     Total warning threshold, default ${DEFAULT_MAX_TOKENS}
  --section-max-tokens <n> Section warning threshold, default ${DEFAULT_SECTION_MAX_TOKENS}
  --strict             Exit non-zero on warnings
`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0] ?? "check";

try {
  if (command === "init") {
    initAgents(args);
  } else if (command === "detect") {
    const dir = path.resolve(String(args.dir ?? process.cwd()));
    console.log(JSON.stringify({ ok: true, dir, profile: detectProject(dir) }, null, 2));
  } else if (command === "draft") {
    console.log(JSON.stringify(draftAgents(args), null, 2));
  } else if (command === "check") {
    const filePath = path.resolve(String(args.path ?? "AGENTS.md"));
    if (!fs.existsSync(filePath)) {
      throw new Error(`${filePath} does not exist. Run "npm run agents:init" to create one.`);
    }
    checkAgents(filePath, args);
  } else if (command === "templates") {
    console.log(listTemplateOptions().join("\n"));
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else {
    throw new Error(`Unknown command "${command}". Run "npm run agents -- help".`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
