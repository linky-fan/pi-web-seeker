#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE_DIR = path.join(ROOT, "templates", "agents");
const REQUIRED_SECTIONS = ["Commands", "Architecture", "Critical Rules", "Common Flows", "Traps", "Verification"];
const DEFAULT_MAX_TOKENS = 2500;
const DEFAULT_SECTION_MAX_TOKENS = 650;

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

function listTemplates() {
  return fs.readdirSync(TEMPLATE_DIR)
    .filter((name) => name.endsWith(".AGENTS.md"))
    .map((name) => name.replace(/\.AGENTS\.md$/, ""))
    .sort();
}

function readTemplate(name) {
  const filePath = path.join(TEMPLATE_DIR, `${name}.AGENTS.md`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Unknown template "${name}". Available: ${listTemplates().join(", ")}`);
  }
  return fs.readFileSync(filePath, "utf8");
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
  const content = readTemplate(template);

  if (fs.existsSync(output) && !force) {
    throw new Error(`${output} already exists. Pass --force to overwrite.`);
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content);
  console.log(JSON.stringify({
    ok: true,
    output,
    template,
    approxTokens: approxTokens(content),
    message: "AGENTS.md template written. Fill in project-specific commands, flows, and traps before using it.",
  }, null, 2));
}

function printHelp() {
  console.log(`Usage:
  npm run agents -- templates
  npm run agents:init -- --template standard --dir /path/to/project
  npm run agents:check -- --path /path/to/project/AGENTS.md

Commands:
  init                 Write an AGENTS.md template
  check                Inspect AGENTS.md length, structure, and obvious risks
  templates            List available templates

Options:
  --template <name>    Template for init (${listTemplates().join(", ")})
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
  } else if (command === "check") {
    const filePath = path.resolve(String(args.path ?? "AGENTS.md"));
    if (!fs.existsSync(filePath)) {
      throw new Error(`${filePath} does not exist. Run "npm run agents:init" to create one.`);
    }
    checkAgents(filePath, args);
  } else if (command === "templates") {
    console.log(listTemplates().join("\n"));
  } else if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else {
    throw new Error(`Unknown command "${command}". Run "npm run agents -- help".`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
