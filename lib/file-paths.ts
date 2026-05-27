import { normalizeFilePathSlashes, normalizePathForComparison } from "./path-identity";

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
  const normalized = normalizeFilePathSlashes(filePath).replace(/\/+$/, "");
  return normalized.split("/").pop() ?? normalized;
}

export function getRelativeFilePath(filePath: string, cwd?: string): string {
  if (!cwd) return filePath;

  const normalizedFile = normalizeFilePathSlashes(filePath);
  const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
  const fileKey = normalizePathForComparison(normalizedFile);
  const cwdKey = normalizePathForComparison(normalizedCwd);
  if (fileKey.startsWith(cwdKey + "/")) {
    return normalizedFile.slice(normalizedCwd.length + 1);
  }
  return filePath;
}

export function joinFilePath(parent: string, child: string): string {
  return `${normalizeFilePathSlashes(parent).replace(/\/$/, "")}/${child}`;
}
