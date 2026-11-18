export interface CachedScan<T> {
  scan: T;
  expiresAt: number;
}

/**
 * Short-lived cache for workspace scans that are expensive to rebuild.
 * The key includes every input the scan depends on, and entries record their
 * workspace so one workspace's settings change can drop only its own scans.
 */
export function createScanCache<T extends { cwd: string }>(ttlMs: number, now: () => number = Date.now) {
  const entries = new Map<string, CachedScan<T>>();

  return {
    key(inputs: readonly unknown[]): string {
      return JSON.stringify(inputs);
    },
    get(key: string): T | null {
      const cached = entries.get(key);
      if (!cached) return null;
      if (cached.expiresAt <= now()) {
        entries.delete(key);
        return null;
      }
      return cached.scan;
    },
    set(key: string, scan: T): void {
      entries.set(key, { scan, expiresAt: now() + ttlMs });
    },
    /** Drops one workspace's entries, or every entry when cwd is omitted. */
    forget(cwd?: string): void {
      if (cwd === undefined) {
        entries.clear();
        return;
      }
      for (const [key, entry] of entries) {
        if (entry.scan.cwd === cwd) entries.delete(key);
      }
    },
    size(): number {
      return entries.size;
    },
  };
}