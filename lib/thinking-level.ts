export type ResolvedThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * "Auto" means the level pi would pick on its own: a per-model override wins,
 * then the global default, then pi's built-in fallback.
 */
export function effectiveAutoThinkingLevel(
  model: { provider: string; modelId: string } | null,
  modelDefaults: Record<string, string>,
  globalDefault: string | null | undefined,
  fallback = "medium",
): string {
  if (model) {
    const perModel = modelDefaults[`${model.provider}:${model.modelId}`];
    if (perModel) return perModel;
  }
  if (globalDefault) return globalDefault;
  return fallback;
}