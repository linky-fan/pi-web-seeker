import type { CheckerLanguage } from "./types";
import type { ProjectContext } from "./discovery";
import type { CheckerInvocation, ProcessResult } from "./process-runner";
import type { CheckerDiagnostic } from "./types";

export interface CheckerAvailability {
  available: boolean;
  reason?: string;
  note?: string;
}

export interface CheckerAdapter {
  id: string;
  language: CheckerLanguage;
  label: string;
  detect(project: ProjectContext): boolean;
  availability(project: ProjectContext): CheckerAvailability;
  createInvocation(project: ProjectContext, checkerId: string): Promise<CheckerInvocation>;
  parse(project: ProjectContext, checkerId: string, output: ProcessResult): CheckerDiagnostic[];
}

export function checkerTargetId(adapterId: string, project: ProjectContext): string {
  return `${adapterId}::${project.relativeRoot}`;
}
