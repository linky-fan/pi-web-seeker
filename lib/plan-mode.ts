export type PlanMode = "normal" | "plan";

export interface SlashCommandQuery {
  start: number;
  end: number;
  query: string;
}

export interface PlanDocumentSection {
  key: "summary" | "goals" | "implementation" | "tests" | "risks";
  title: string;
  body: string;
}

export interface PlanDocument {
  title: string;
  sections: PlanDocumentSection[];
}

const PLAN_SECTION_KEYS: Array<PlanDocumentSection["key"]> = ["summary", "goals", "implementation", "tests", "risks"];

const SECTION_ALIASES: Record<PlanDocumentSection["key"], RegExp> = {
  summary: /^(摘要|summary)$/i,
  goals: /^(目标与验收|目标和验收|goals?\s*(and|&)\s*acceptance|goals?|acceptance)$/i,
  implementation: /^(实施方案|implementation|key changes?|implementation changes?|approach)$/i,
  tests: /^(测试计划|test plan|tests?)$/i,
  risks: /^(假设与风险|假设和风险|assumptions?\s*(and|&)\s*risks?|assumptions?|risks?)$/i,
};

const DESTRUCTIVE_BASH_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish|run\s+(build|dev|start|release))/i,
  /\byarn\s+(add|remove|install|publish|build|dev|start)/i,
  /\bpnpm\s+(add|remove|install|publish|build|dev|start)/i,
  /\bbun\s+(add|remove|install|run)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
  /\bbrew\s+(install|uninstall|upgrade)/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone|clean)/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
  /\bservice\s+\S+\s+(start|stop|restart)/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
  /\bapply_patch\b/i,
];

const SAFE_BASH_SEGMENT_PATTERNS = [
  /^\s*cat\b/i,
  /^\s*head\b/i,
  /^\s*tail\b/i,
  /^\s*less\b/i,
  /^\s*more\b/i,
  /^\s*grep\b/i,
  /^\s*find\b/i,
  /^\s*ls\b/i,
  /^\s*pwd\b/i,
  /^\s*echo\b/i,
  /^\s*printf\b/i,
  /^\s*wc\b/i,
  /^\s*sort\b/i,
  /^\s*uniq\b/i,
  /^\s*diff\b/i,
  /^\s*file\b/i,
  /^\s*stat\b/i,
  /^\s*du\b/i,
  /^\s*df\b/i,
  /^\s*tree\b/i,
  /^\s*which\b/i,
  /^\s*whereis\b/i,
  /^\s*type\b/i,
  /^\s*env\b/i,
  /^\s*printenv\b/i,
  /^\s*uname\b/i,
  /^\s*whoami\b/i,
  /^\s*id\b/i,
  /^\s*date\b/i,
  /^\s*uptime\b/i,
  /^\s*ps\b/i,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get|rev-parse|ls-files)\b/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
  /^\s*yarn\s+(list|info|why|audit)\b/i,
  /^\s*pnpm\s+(list|why|view|info|outdated|audit)\b/i,
  /^\s*node\s+(--version|-v)\b/i,
  /^\s*npm\s+(--version|-v)\b/i,
  /^\s*python3?\s+(--version|-V)\b/i,
  /^\s*jq\b/i,
  /^\s*sed\s+-n\b/i,
  /^\s*awk\b/i,
  /^\s*rg\b/i,
  /^\s*fd\b/i,
  /^\s*bat\b/i,
  /^\s*eza\b/i,
];

const PIPE_AND_LIST_SEPARATORS = /\s*(?:\|\||&&|;|\|)\s*/;

function normalizeHeading(text: string): string {
  return text
    .replace(/^#+\s*/, "")
    .replace(/\s+#+$/, "")
    .trim();
}

function sectionKeyForHeading(heading: string): PlanDocumentSection["key"] | null {
  const normalized = normalizeHeading(heading);
  for (const key of PLAN_SECTION_KEYS) {
    if (SECTION_ALIASES[key].test(normalized)) return key;
  }
  return null;
}

export function getSlashCommandQuery(text: string, cursor: number): SlashCommandQuery | null {
  const beforeCursor = text.slice(0, cursor);
  const match = beforeCursor.match(/^\/([a-z]*)$/i);
  if (!match) return null;
  return { start: 0, end: cursor, query: match[1].toLowerCase() };
}

export function isSafePlanBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;
  if (DESTRUCTIVE_BASH_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;

  const segments = trimmed
    .split(PIPE_AND_LIST_SEPARATORS)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) return false;
  return segments.every((segment) => SAFE_BASH_SEGMENT_PATTERNS.some((pattern) => pattern.test(segment)));
}

export function parsePlanDocument(markdown: string): PlanDocument | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const titleIndex = lines.findIndex((line) => /^#\s+\S/.test(line.trim()));
  if (titleIndex < 0) return null;

  const title = normalizeHeading(lines[titleIndex]);
  if (!title) return null;

  const headingMatches: Array<{ index: number; key: PlanDocumentSection["key"]; title: string }> = [];
  for (let i = titleIndex + 1; i < lines.length; i++) {
    const match = lines[i].match(/^##\s+(.+?)\s*$/);
    if (!match) continue;
    const key = sectionKeyForHeading(match[1]);
    if (key) headingMatches.push({ index: i, key, title: normalizeHeading(match[1]) });
  }

  const seen = new Set(headingMatches.map((item) => item.key));
  if (!PLAN_SECTION_KEYS.every((key) => seen.has(key))) return null;

  const sections: PlanDocumentSection[] = [];
  for (let i = 0; i < headingMatches.length; i++) {
    const current = headingMatches[i];
    const next = headingMatches[i + 1];
    const body = lines.slice(current.index + 1, next ? next.index : lines.length).join("\n").trim();
    sections.push({ key: current.key, title: current.title, body });
  }

  return { title, sections };
}

export const PLAN_MODE_SYSTEM_PROMPT = `
Plan Mode is active. You are in a read-only planning workflow.

Rules:
- Explore with read-only actions only. Do not edit, create, delete, rename, install, commit, push, or otherwise mutate files or external state.
- If facts can be discovered with read-only inspection, discover them before asking the user.
- Ask concise clarifying questions only when product intent or a high-impact tradeoff cannot be discovered from the environment.
- Do not claim implementation has happened.
- Do not output patches or write commands.
- Produce a decision-complete plan that another engineer or agent can execute without making key decisions.
- Match the user's language.

Final plan format:

# <short plan title>

## 摘要
Use 2-4 sentences to state the goal, current state, recommended path, and what is intentionally out of scope.

## 目标与验收
- State the desired result.
- List the acceptance criteria.

## 实施方案
- Group changes by subsystem or behavior.
- Specify important data flow, interfaces, state, and failure handling.
- Name concrete files only when needed to prevent ambiguity.

## 测试计划
- List the smallest relevant verification.
- Cover important boundary cases and regression risks.

## 假设与风险
- Record assumptions, defaults, unresolved inputs, and remaining risks.
`.trim();
