export interface TtlValueCache<T> {
  get(): T | null;
  set(value: T): void;
  clear(): void;
}

/** Single-value cache with a TTL, for expensive results that have no per-key identity. */
export function createTtlValueCache<T>(ttlMs: number, now: () => number = Date.now): TtlValueCache<T> {
  let entry: { value: T; expiresAt: number } | null = null;

  return {
    get() {
      if (!entry) return null;
      if (entry.expiresAt <= now()) {
        entry = null;
        return null;
      }
      return entry.value;
    },
    set(value: T) {
      entry = { value, expiresAt: now() + ttlMs };
    },
    clear() {
      entry = null;
    },
  };
}