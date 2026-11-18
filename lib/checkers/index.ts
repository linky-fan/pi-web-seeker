import type { CheckerAdapter } from "./adapter-types";
import { checkerTargetId } from "./adapter-types";
import { cFamilyAdapter } from "./adapters/c-family";
import { goVetAdapter } from "./adapters/go";
import { javaCheckstyleAdapter } from "./adapters/java";
import { pythonMypyAdapter, pythonRuffAdapter } from "./adapters/python";
import { rustClippyAdapter } from "./adapters/rust";
import { scanWorkspace, type ProjectContext } from "./discovery";
import { runCheckerProcess, type ProcessResult } from "./process-runner";
import { MAX_CHECKER_SELECTION, type CheckerDiagnostic, type CheckerInventory, type CheckerResult, type CheckerTarget } from "./types";

interface BoundChecker {
  adapter: CheckerAdapter;
  project: ProjectContext;
  target: CheckerTarget;
}

const ADAPTERS: CheckerAdapter[] = [
  pythonRuffAdapter,
  pythonMypyAdapter,
  javaCheckstyleAdapter,
  cFamilyAdapter,
  goVetAdapter,
  rustClippyAdapter,
];
const MAX_CONCURRENT_CHECKERS = 2;

export function validateCheckerIds(value: unknown): string[] | null {
  if (
    !Array.isArray(value)
    || value.length === 0
    || value.length > MAX_CHECKER_SELECTION
    || value.some((id) => typeof id !== "string" || id.length === 0 || id.length > 500)
  ) {
    return null;
  }
  const ids = value as string[];
  return new Set(ids).size === ids.length ? ids : null;
}

function discoverBoundCheckers(workspaceRoot: string): {
  scan: ReturnType<typeof scanWorkspace>;
  checkers: BoundChecker[];
} {
  const scan = scanWorkspace(workspaceRoot);
  const checkers: BoundChecker[] = [];
  for (const project of scan.projects) {
    for (const adapter of ADAPTERS) {
      if (!adapter.detect(project)) continue;
      const availability = adapter.availability(project);
      checkers.push({
        adapter,
        project,
        target: {
          id: checkerTargetId(adapter.id, project),
          language: adapter.language,
          label: adapter.label,
          projectPath: project.relativeRoot,
          available: availability.available,
          reason: availability.reason,
          note: availability.note,
        },
      });
    }
  }
  return { scan, checkers };
}

export function prepareCheckerRun(workspaceRoot: string) {
  const { scan, checkers } = discoverBoundCheckers(workspaceRoot);
  return {
    inventory: {
      targets: checkers.map(({ target }) => target),
      scannedDirectories: scan.scannedDirectories,
      truncated: scan.truncated,
    },
    runSelected: (selectedIds: string[], signal?: AbortSignal) => runSelectedCheckersFrom(checkers, selectedIds, signal),
  };
}

export function getCheckerInventory(workspaceRoot: string): CheckerInventory {
  return prepareCheckerRun(workspaceRoot).inventory;
}

function resultFor(
  checker: BoundChecker,
  status: CheckerResult["status"],
  startedAt: number,
  output: ProcessResult | null,
  diagnostics: CheckerDiagnostic[] = [],
  error?: string,
): CheckerResult {
  return {
    targetId: checker.target.id,
    language: checker.target.language,
    label: checker.target.label,
    projectPath: checker.target.projectPath,
    status,
    durationMs: Math.max(0, Date.now() - startedAt),
    exitCode: output?.exitCode ?? null,
    diagnostics,
    error,
    outputTruncated: output?.outputTruncated || undefined,
  };
}

async function runOne(checker: BoundChecker, signal?: AbortSignal): Promise<CheckerResult> {
  const startedAt = Date.now();
  try {
    const invocation = await checker.adapter.createInvocation(checker.project, checker.target.id);
    const output = await runCheckerProcess(invocation, signal);
    let diagnostics: CheckerDiagnostic[] = [];
    try {
      diagnostics = checker.adapter.parse(checker.project, checker.target.id, output);
    } catch {
      return resultFor(checker, "failed", startedAt, output, [], "parse");
    }

    if (output.aborted) {
      return resultFor(checker, "cancelled", startedAt, output, diagnostics);
    }
    if (output.spawnError) {
      return resultFor(checker, "failed", startedAt, output, diagnostics, "spawn");
    }
    if (output.timedOut) {
      return resultFor(checker, "failed", startedAt, output, diagnostics, "timeout");
    }
    if (output.outputTruncated) {
      return resultFor(checker, "failed", startedAt, output, diagnostics, "outputLimit");
    }
    if (diagnostics.length > 0) {
      return resultFor(checker, "issues", startedAt, output, diagnostics);
    }
    if (output.exitCode === 0) {
      return resultFor(checker, "passed", startedAt, output);
    }
    return resultFor(checker, "failed", startedAt, output, [], "nonzero");
  } catch {
    return resultFor(checker, "failed", startedAt, null, [], "setup");
  }
}

async function runSelectedCheckersFrom(
  checkers: BoundChecker[],
  selectedIds: string[],
  signal?: AbortSignal,
): Promise<CheckerResult[]> {
  const uniqueIds = validateCheckerIds(selectedIds);
  if (!uniqueIds) throw new Error("Invalid checker selection.");

  const byId = new Map(checkers.map((checker) => [checker.target.id, checker]));
  const selected = uniqueIds.map((id) => {
    const checker = byId.get(id);
    if (!checker || !checker.target.available) throw new Error("Selected checker is unavailable.");
    return checker;
  });
  const results = new Array<CheckerResult>(selected.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < selected.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await runOne(selected[index], signal);
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(MAX_CONCURRENT_CHECKERS, selected.length) },
    () => worker(),
  ));
  return results;
}

export function runSelectedCheckers(
  workspaceRoot: string,
  selectedIds: string[],
  signal?: AbortSignal,
): Promise<CheckerResult[]> {
  return prepareCheckerRun(workspaceRoot).runSelected(selectedIds, signal);
}
