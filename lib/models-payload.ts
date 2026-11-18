import { createAppModelRuntime } from "@/lib/model-registry";
import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { createTtlValueCache } from "./ttl-cache";

export interface ModelsPayload {
  models: Record<string, string>;
  modelList: { id: string; name: string; provider: string }[];
  defaultModel: { provider: string; modelId: string } | null;
  thinkingLevels: Record<string, string[]>;
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  modelThinkingDefaults: Record<string, string>;
  defaultThinkingLevel: string | null;
}

export const EMPTY_MODELS_PAYLOAD: ModelsPayload = {
  models: {},
  modelList: [],
  defaultModel: null,
  thinkingLevels: {},
  thinkingLevelMaps: {},
  modelThinkingDefaults: {},
  defaultThinkingLevel: null,
};

const CACHE_TTL_MS = 5_000;

declare global {
  // Building a ModelRuntime reloads models.json and runs an availability refresh.
  var __piModelsPayloadCache: ReturnType<typeof createTtlValueCache<ModelsPayload>> | undefined;
}

function payloadCache() {
  if (!globalThis.__piModelsPayloadCache) {
    globalThis.__piModelsPayloadCache = createTtlValueCache<ModelsPayload>(CACHE_TTL_MS);
  }
  return globalThis.__piModelsPayloadCache;
}

/** Drops the cached payload after credentials or models.json change. */
export function invalidateModelsPayloadCache(): void {
  globalThis.__piModelsPayloadCache?.clear();
}

export async function buildModelsPayload(): Promise<ModelsPayload> {
  const nameMap = new Map<string, string>();
  let modelList: ModelsPayload["modelList"] = [];
  let defaultModel: ModelsPayload["defaultModel"] = null;
  const thinkingLevels: ModelsPayload["thinkingLevels"] = {};
  const thinkingLevelMaps: ModelsPayload["thinkingLevelMaps"] = {};
  const modelThinkingDefaults: ModelsPayload["modelThinkingDefaults"] = {};
  let defaultThinkingLevel: string | null = null;

  try {
    const agentDir = getAgentDir();
    const runtime = await createAppModelRuntime();
    const available = await runtime.getAvailable();
    modelList = available.map((m: { id: string; name: string; provider: string }) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
    }));

    const settings = SettingsManager.create(process.cwd(), agentDir);
    defaultThinkingLevel = settings.getDefaultThinkingLevel() ?? null;
    for (const m of available) {
      const key = `${m.provider}:${m.id}`;
      nameMap.set(key, m.name);
      thinkingLevels[key] = getSupportedThinkingLevels(m);
      if (m.thinkingLevelMap) thinkingLevelMaps[key] = m.thinkingLevelMap;
      const perModel = settings.getModelThinkingLevel(m.provider, m.id);
      if (perModel) modelThinkingDefaults[key] = perModel;
    }

    const provider = settings.getDefaultProvider();
    const modelId = settings.getDefaultModel();
    if (provider) {
      defaultModel = { provider, modelId: modelId ?? available[0]?.id ?? "" };
    }
  } catch { /* Return whatever was gathered before the error. */ }

  return {
    models: Object.fromEntries(nameMap),
    modelList,
    defaultModel,
    thinkingLevels,
    thinkingLevelMaps,
    modelThinkingDefaults,
    defaultThinkingLevel,
  };
}

export async function getModelsPayload(): Promise<ModelsPayload> {
  const cache = payloadCache();
  const cached = cache.get();
  if (cached) return cached;

  const payload = await buildModelsPayload();
  cache.set(payload);
  return payload;
}