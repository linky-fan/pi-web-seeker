const WINDOWS_DRIVE_ROOT_RE = /^[a-zA-Z]:\//;
const WINDOWS_DRIVE_ROOT_ONLY_RE = /^[a-zA-Z]:\/$/;
const WINDOWS_DRIVE_ONLY_RE = /^[a-zA-Z]:$/;
const UNC_SHARE_ROOT_RE = /^\/\/[^/]+\/[^/]+\/?$/;

export function normalizeFilePathSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

export function isWindowsStylePath(filePath: string): boolean {
  const normalized = normalizeFilePathSlashes(filePath);
  return WINDOWS_DRIVE_ROOT_RE.test(normalized) || normalized.startsWith("//");
}

export function normalizePathForComparison(filePath: string): string {
  let normalized = normalizeFilePathSlashes(filePath);
  if (normalized.startsWith("//")) {
    normalized = "//" + normalized.replace(/^\/+/, "");
  }

  while (
    normalized.length > 1 &&
    normalized.endsWith("/") &&
    !/^[a-zA-Z]:\/$/.test(normalized) &&
    !/^\/\/[^/]+\/[^/]+\/?$/.test(normalized)
  ) {
    normalized = normalized.slice(0, -1);
  }

  return isWindowsStylePath(normalized) ? normalized.toLowerCase() : normalized;
}

export function areSameFilePath(left: string, right: string): boolean {
  return normalizePathForComparison(left) === normalizePathForComparison(right);
}

export function trimTrailingPathSeparators(filePath: string): string {
  let normalized = normalizeFilePathSlashes(filePath);
  if (WINDOWS_DRIVE_ONLY_RE.test(normalized)) return `${normalized}/`;
  if (normalized.startsWith("//")) {
    normalized = "//" + normalized.replace(/^\/+/, "");
  }

  while (
    normalized.length > 1 &&
    normalized.endsWith("/") &&
    !WINDOWS_DRIVE_ROOT_ONLY_RE.test(normalized) &&
    !UNC_SHARE_ROOT_RE.test(normalized)
  ) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

export function getPathRelativeToRoot(filePath: string, root: string): string | null {
  const normalizedFile = trimTrailingPathSeparators(filePath);
  const normalizedRoot = trimTrailingPathSeparators(root);
  const fileKey = normalizePathForComparison(normalizedFile);
  const rootKey = normalizePathForComparison(normalizedRoot);

  if (fileKey === rootKey) return "";
  const rootPrefix = rootKey.endsWith("/") ? rootKey : `${rootKey}/`;
  if (!fileKey.startsWith(rootPrefix)) return null;
  const sliceAt = normalizedRoot.endsWith("/") ? normalizedRoot.length : normalizedRoot.length + 1;
  return normalizedFile.slice(sliceAt);
}

export function isPathInOrEqualToRoot(filePath: string, root: string): boolean {
  return getPathRelativeToRoot(filePath, root) !== null;
}
