import { constants, copyFileSync, existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

const LEGACY_SESSION_ID_FIELD = "sendSessionIdHeader";
const SESSION_AFFINITY_FIELD = "sessionAffinityFormat";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCompatOwner(owner: Record<string, unknown>): { value: Record<string, unknown>; changed: boolean } {
  if (!isRecord(owner.compat) || !(LEGACY_SESSION_ID_FIELD in owner.compat)) {
    return { value: owner, changed: false };
  }

  const compat = { ...owner.compat };
  const legacyValue = compat[LEGACY_SESSION_ID_FIELD];
  if (!(SESSION_AFFINITY_FIELD in compat) && typeof legacyValue === "boolean") {
    compat[SESSION_AFFINITY_FIELD] = legacyValue ? "openai" : "openai-nosession";
  }
  delete compat[LEGACY_SESSION_ID_FIELD];

  return { value: { ...owner, compat }, changed: true };
}

export function normalizeModelsJsonCompat(data: unknown): { value: unknown; changed: boolean } {
  if (!isRecord(data) || !isRecord(data.providers)) return { value: data, changed: false };

  let changed = false;
  const providers: Record<string, unknown> = {};

  for (const [providerName, providerValue] of Object.entries(data.providers)) {
    if (!isRecord(providerValue)) {
      providers[providerName] = providerValue;
      continue;
    }

    const normalizedProvider = normalizeCompatOwner(providerValue);
    let provider = normalizedProvider.value;
    changed ||= normalizedProvider.changed;

    if (Array.isArray(provider.models)) {
      let modelsChanged = false;
      const models = provider.models.map((model) => {
        if (!isRecord(model)) return model;
        const normalizedModel = normalizeCompatOwner(model);
        modelsChanged ||= normalizedModel.changed;
        return normalizedModel.value;
      });
      if (modelsChanged) provider = { ...provider, models };
      changed ||= modelsChanged;
    }

    providers[providerName] = provider;
  }

  return changed
    ? { value: { ...data, providers }, changed: true }
    : { value: data, changed: false };
}

function createMigrationBackup(path: string): void {
  const backupPath = `${path}.pre-0.80.7.bak`;
  if (existsSync(backupPath)) return;

  try {
    copyFileSync(path, backupPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export function writeModelsJsonAtomic(path: string, data: unknown): void {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const mode = existsSync(path) ? statSync(path).mode : 0o600;

  try {
    writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode });
    renameSync(tempPath, path);
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

export function ensureModelsConfigCompatible(path: string): boolean {
  if (!existsSync(path)) return false;

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return false;
  }

  const normalized = normalizeModelsJsonCompat(data);
  if (!normalized.changed) return false;

  createMigrationBackup(path);
  writeModelsJsonAtomic(path, normalized.value);
  return true;
}
