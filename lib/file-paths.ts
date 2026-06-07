import {
  getPathRelativeToRoot,
  normalizeFilePathSlashes,
  trimTrailingPathSeparators,
} from "./path-identity";

export { normalizeFilePathSlashes };

export function encodeFilePathForApi(filePath: string): string {
  const normalized = normalizeFilePathSlashes(filePath);
  const segments = normalized.startsWith("//")
    ? ["__unc__", ...normalized.slice(2).split("/")]
    : normalized.split("/");

  return segments
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export function getFileName(filePath: string): string {
  const normalized = trimTrailingPathSeparators(filePath);
  return normalized.split("/").pop() ?? normalized;
}

export function getRelativeFilePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;

  return getPathRelativeToRoot(filePath, cwd) || filePath;
}

export function joinFilePath(parent: string, child: string): string {
  const normalizedParent = trimTrailingPathSeparators(parent);
  const normalizedChild = normalizeFilePathSlashes(child).replace(/^\/+/, "");
  return `${normalizedParent.endsWith("/") ? normalizedParent : `${normalizedParent}/`}${normalizedChild}`;
}
