export type PlanMode = "normal" | "plan";
export type PlanExecutionMode = "main" | "subagent";
export type BuddyMode = "off" | "plan" | "code";

export interface ModelRef {
  provider: string;
  modelId: string;
}

export interface PlanModeStatus {
  subagentsAvailable: boolean;
  missingTools: string[];
  installCommand: string;
  loadErrors: string[];
}

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
export const PLAN_SUBAGENT_REQUIRED_TOOLS = ["Agent", "get_subagent_result"];
export const PLAN_SUBAGENT_OPTIONAL_TOOLS = ["steer_subagent"];
export const PLAN_SUBAGENTS_INSTALL_COMMAND = "npx --no-install pi install npm:@tintinweb/pi-subagents";

const SECTION_ALIASES: Record<PlanDocumentSection["key"], RegExp> = {
  summary: /^(摘要|summary)$/i,
  goals: /^(目标与验收|目标和验收|goals?\s*(and|&)\s*acceptance|goals?|acceptance)$/i,
  implementation: /^(实施方案|implementation|key changes?|implementation changes?|approach)$/i,
  tests: /^(测试计划|test plan|tests?)$/i,
  risks: /^(假设与风险|假设和风险|assumptions?\s*(and|&)\s*risks?|assumptions?|risks?)$/i,
};

const DESTRUCTIVE_BASH_PATTERNS = [
  /\$\(/,
  /`[^`]*`/,
  /<</,
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
  /\bxargs\b/i,
  /\bfind\b[^;&|]*\s-delete\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish|audit\s+fix|run\s+(build|dev|start|release))/i,
  /\byarn\s+(add|remove|install|publish|build|dev|start)/i,
  /\bpnpm\s+(add|remove|install|publish|build|dev|start)/i,
  /\bbun\s+(add|remove|install|run)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
  /\bbrew\s+(install|uninstall|upgrade)/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|switch|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone|clean)/i,
  /\bgit\s+diff\b[^;&|]*\s--output(?:=|\s+)/i,
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
  const match = beforeCursor.match(/^\/([a-z-]*)$/i);
  if (!match) return null;
  return { start: 0, end: cursor, query: match[1].toLowerCase() };
}

export function getPlanModeStatus(toolNames: string[], loadErrors: string[] = []): PlanModeStatus {
  const available = new Set(toolNames);
  const missingTools = PLAN_SUBAGENT_REQUIRED_TOOLS.filter((tool) => !available.has(tool));
  return {
    subagentsAvailable: missingTools.length === 0,
    missingTools,
    installCommand: PLAN_SUBAGENTS_INSTALL_COMMAND,
    loadErrors,
  };
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
  const titleIndex = lines.findIndex((line) => line.trim().length > 0);
  if (titleIndex < 0 || !/^#\s+\S/.test(lines[titleIndex].trim())) return null;

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

  const firstByKey = new Map<PlanDocumentSection["key"], number>();
  for (const item of headingMatches) {
    if (!firstByKey.has(item.key)) firstByKey.set(item.key, item.index);
  }
  const orderedIndexes = PLAN_SECTION_KEYS.map((key) => firstByKey.get(key) ?? -1);
  if (orderedIndexes.some((index, i) => i > 0 && index < orderedIndexes[i - 1])) return null;

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

export const PLAN_MODE_SUBAGENT_SYSTEM_PROMPT = `
Plan Mode is active with the optional Plan via Subagent workflow.

Rules:
- Use the subagent tools to start exactly one Plan subagent before producing the final plan.
- The Plan subagent must work read-only: it may inspect files, commands, and session context, but must not edit, create, delete, install, commit, push, or otherwise mutate state.
- Give the subagent a narrow prompt with the user's request, current cwd context, and the fixed plan format requirements.
- Wait for the Plan subagent result with get_subagent_result before answering.
- Base the final answer on the Plan subagent result. Resolve wording and formatting, but do not invent implementation facts that the subagent did not establish.
- If the subagent tools fail after being available, explain the failure and ask the user whether to retry or use default Plan Mode.
- Match the user's language and keep the final answer as a plan, not an implementation report.

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

const BUDDY_REVIEW_FORMAT = `
VERDICT: PASS | REVISE

BLOCKING_ISSUES:
- correctness, requirement, or safety problems that must be fixed

FACT_ERRORS:
- claims that are not supported by the repository or task context

MISSING_TESTS:
- important verification gaps

NON_BLOCKING:
- optional improvements only
`.trim();

export function buildBuddySystemPrompt(mode: Exclude<BuddyMode, "off">, reviewer: ModelRef): string {
  const reviewerModel = `${reviewer.provider}/${reviewer.modelId}`;
  const common = `
Buddy review is active. The main agent is the sole author and must use exactly one independent reviewer model before its final answer.

Reviewer protocol:
- First do the work yourself and prepare a complete draft or implementation.
- Then call the Agent tool exactly once with subagent_type "Plan", model "${reviewerModel}", inherit_context false, and run_in_background false.
- Put the user's request, relevant verified facts, and the complete draft or git diff summary in the reviewer prompt. Do not include hidden chain-of-thought.
- Tell the reviewer to challenge assumptions and return only this review format:

${BUDDY_REVIEW_FORMAT}

- Incorporate valid blocking feedback yourself. Do not let the reviewer edit files.
- Do not expose the full internal debate. Briefly state that an independent review ran and whether blocking issues were fixed.
- If the reviewer cannot run or fails, clearly mark the result as unverified instead of pretending review succeeded.
- Never call a different subagent type or reviewer model while Buddy review is active.
`.trim();

  if (mode === "plan") {
    return `${common}

Buddy Plan rules:
- Both agents are read-only. Do not edit, create, delete, rename, install, commit, push, or otherwise mutate files or external state.
- The main agent writes the plan. The reviewer only criticizes that plan.
- Output only the revised decision-complete plan in the required Plan Mode format.`;
  }

  return `${common}

Buddy Code rules:
- The main agent is the only writer. Implement the requested change, run proportionate checks, then request review.
- The reviewer is read-only and must inspect the described changes for correctness, regressions, security issues, and missing tests.
- Fix valid blocking issues and rerun the relevant checks before the final answer.
- Do not ask the reviewer to implement, edit, commit, or push anything.`;
}
