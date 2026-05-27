const WINDOWS_DRIVE_ROOT_RE = /^[a-zA-Z]:\//;

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
