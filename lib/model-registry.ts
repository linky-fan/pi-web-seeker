import { join } from "node:path";
import { ModelRuntime, getAgentDir } from "@earendil-works/pi-coding-agent";
import { ensureModelsConfigCompatible } from "./models-config-compat";

export async function createAppModelRuntime(
  modelsPath: string = join(getAgentDir(), "models.json"),
  authPath?: string,
): Promise<ModelRuntime> {
  ensureModelsConfigCompatible(modelsPath);
  return ModelRuntime.create({ modelsPath, authPath, allowModelNetwork: false });
}
