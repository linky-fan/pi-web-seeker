import { resolve, sep } from "node:path";

const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Invalid caller-supplied coms-net input, reported to clients as 400 rather than 500. */
export class ComsNetInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComsNetInputError";
  }
}

/** coms-net project ids become directory names, so they must stay a single safe path segment. */
export function isValidComsNetProjectId(project: string): boolean {
  if (!PROJECT_ID_RE.test(project)) return false;
  return project !== "." && project !== ".." && !project.includes("..");
}

export function assertComsNetProjectId(project: string): string {
  if (!isValidComsNetProjectId(project)) throw new ComsNetInputError(`Invalid coms-net project id: ${project}`);
  return project;
}

/** Resolves a project id under the projects root and proves the result stays inside it. */
export function comsNetProjectDir(projectsRoot: string, project: string): string {
  assertComsNetProjectId(project);
  const root = resolve(projectsRoot);
  const dir = resolve(root, project);
  if (!dir.startsWith(root + sep)) {
    throw new ComsNetInputError(`Invalid coms-net project id: ${project}`);
  }
  return dir;
}