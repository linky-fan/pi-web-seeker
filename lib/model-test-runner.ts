import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createAppModelRuntime } from "./model-registry";
import { normalizeModelsJsonCompat } from "./models-config-compat";

const TEST_TIMEOUT_MS = 20_000;
// A keyless endpoint still needs a non-empty client key; local servers ignore this value.
const NO_AUTH_PLACEHOLDER = "pi-web-connection-test";

export interface ModelConnectionTestInput {
  providerName: string;
  provider: Record<string, unknown>;
  model: Record<string, unknown>;
  apiKey: string;
  /** The form explicitly opts in to testing a keyless endpoint (e.g. a local Ollama server). */
  allowNoAuth?: boolean;
}

export type ModelConnectionTestResult =
  | { ok: true; latencyMs: number; status?: number; responseText: string }
  | { ok: false; error: string; latencyMs?: number; status?: number; httpStatus?: number };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Runs a one-shot connection test against the exact model shown in the form.
 * The API key must be the literal form value: the temp credentials file is empty and the
 * key is passed as a request override, so stored logins and environment keys are never used.
 */
export async function runModelConnectionTest(input: ModelConnectionTestInput): Promise<ModelConnectionTestResult> {
  const { providerName, provider, model, apiKey, allowNoAuth = false } = input;
  const modelId = typeof model.id === "string" ? model.id.trim() : "";
  let tempDir: string | undefined;

  try {
    tempDir = mkdtempSync(join(tmpdir(), "pi-web-model-test-"));
    const modelsPath = join(tempDir, "models.json");
    const authPath = join(tempDir, "auth.json");
    writeFileSync(authPath, "{}\n", "utf8");

    const normalized = normalizeModelsJsonCompat({
      providers: { [providerName]: { ...provider, models: [{ ...model, id: modelId }] } },
    });
    writeFileSync(modelsPath, JSON.stringify(normalized.value, null, 2), "utf8");

    const runtime = await createAppModelRuntime(modelsPath, authPath);
    const loadError = runtime.getError();
    if (loadError) return { ok: false, error: loadError };

    const testModel = runtime.getModel(providerName, modelId);
    if (!testModel) return { ok: false, error: `Model not found: ${providerName}/${modelId}` };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    let status: number | undefined;
    const startedAt = Date.now();

    try {
      const message = await runtime.completeSimple(testModel, {
        messages: [{ role: "user", content: "Reply with OK only.", timestamp: Date.now() }],
      }, {
        apiKey: apiKey || (allowNoAuth ? NO_AUTH_PLACEHOLDER : apiKey),
        maxTokens: 16,
        timeoutMs: TEST_TIMEOUT_MS,
        maxRetries: 0,
        cacheRetention: "none",
        signal: controller.signal,
        onResponse: (response) => { status = response.status; },
      });

      const latencyMs = Date.now() - startedAt;
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        return {
          ok: false,
          error: message.errorMessage ?? (controller.signal.aborted ? "Test timed out" : "Model returned an error"),
          latencyMs,
          status,
        };
      }
      return { ok: true, latencyMs, status, responseText: getAssistantText(message).slice(0, 300) };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error), httpStatus: 500 };
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}