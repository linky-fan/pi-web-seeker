import type { CheckerAdapter } from "../adapter-types";
import type { ProjectContext } from "../discovery";
import { normalizeDiagnostic, resolveExecutable } from "../common";
import type { CheckerDiagnostic } from "../types";

export function parseGoVet(project: ProjectContext, checkerId: string, output: string): CheckerDiagnostic[] {
  return output
    .split(/\r?\n/)
    .map((line) => {
      const match = /^(.+?):(\d+)(?::(\d+))?:\s*(.+)$/.exec(line.trim());
      if (!match) return null;
      return normalizeDiagnostic({
        checkerId,
        language: "go",
        projectRoot: project.root,
        path: match[1],
        line: Number(match[2]),
        column: match[3] ? Number(match[3]) : undefined,
        severity: "warning",
        message: match[4],
      });
    })
    .filter((diagnostic): diagnostic is CheckerDiagnostic => diagnostic !== null)
    .slice(0, 2_000);
}

export const goVetAdapter: CheckerAdapter = {
  id: "go-vet",
  language: "go",
  label: "Go · go vet",
  detect: (project) => project.entries.has("go.mod"),
  availability(project) {
    return resolveExecutable("go", project.root)
      ? { available: true }
      : { available: false, reason: "go.toolMissing" };
  },
  async createInvocation(project) {
    const executable = resolveExecutable("go", project.root);
    if (!executable) throw new Error("Go is not available.");
    return {
      command: executable,
      args: ["vet", "-mod=readonly", "./..."],
      cwd: project.root,
      env: {
        GOPROXY: "off",
        GOSUMDB: "off",
        GOTOOLCHAIN: "local",
        GOFLAGS: "-mod=readonly",
      },
    };
  },
  parse(project, checkerId, output) {
    return parseGoVet(project, checkerId, `${output.stdout}\n${output.stderr}`);
  },
};
