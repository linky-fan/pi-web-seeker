import { join } from "node:path";
import { AuthStorage, ModelRegistry, getAgentDir } from "@earendil-works/pi-coding-agent";
import { ensureModelsConfigCompatible } from "./models-config-compat";

export function createAppModelRegistry(
  authStorage: AuthStorage = AuthStorage.create(),
  modelsPath: string = join(getAgentDir(), "models.json"),
): ModelRegistry {
  ensureModelsConfigCompatible(modelsPath);
  return ModelRegistry.create(authStorage, modelsPath);
}
