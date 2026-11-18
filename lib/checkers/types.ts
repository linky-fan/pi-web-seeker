export type CheckerLanguage = "python" | "java" | "c" | "go" | "rust";
export type CheckerSeverity = "error" | "warning" | "info";
export const MAX_CHECKER_SELECTION = 20;

export type CheckerStatus =
  | "passed"
  | "issues"
  | "failed"
  | "cancelled";

export interface CheckerDiagnostic {
  id: string;
  checkerId: string;
  language: CheckerLanguage;
  path: string | null;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: CheckerSeverity;
  code?: string;
  message: string;
}

export interface CheckerTarget {
  id: string;
  language: CheckerLanguage;
  label: string;
  projectPath: string;
  available: boolean;
  reason?: string;
  note?: string;
}

export interface CheckerInventory {
  targets: CheckerTarget[];
  scannedDirectories: number;
  truncated: boolean;
}

export interface CheckerResult {
  targetId: string;
  language: CheckerLanguage;
  label: string;
  projectPath: string;
  status: CheckerStatus;
  durationMs: number;
  exitCode: number | null;
  diagnostics: CheckerDiagnostic[];
  error?: string;
  outputTruncated?: boolean;
}
