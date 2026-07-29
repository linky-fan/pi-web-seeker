import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAppModelRuntime } from "../lib/model-registry.ts";
import {
  getQuickChatSearchConfig,
  removeQuickChatSearchApiKey,
  saveQuickChatSearchApiKey,
} from "../lib/quick-chat-search.ts";

test("ModelRuntime persists model and Quick Chat credentials through the public APIs", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-model-runtime-"));
  const modelsPath = join(agentDir, "models.json");
  const authPath = join(agentDir, "auth.json");
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeFileSync(modelsPath, "{}\n", { encoding: "utf8", mode: 0o600 });

  try {
    const runtime = await createAppModelRuntime(modelsPath, authPath);
    assert.ok(runtime.getModels("openai").length > 0);

    await runtime.login("openai", "api_key", {
      prompt: async () => "model-test-key",
      notify: () => {},
    });
    assert.equal(JSON.parse(readFileSync(authPath, "utf8")).openai.type, "api_key");

    const reloaded = await createAppModelRuntime(modelsPath, authPath);
    assert.equal((await reloaded.getAuth("openai"))?.source, "stored credential");

    await reloaded.logout("openai");
    assert.equal(JSON.parse(readFileSync(authPath, "utf8")).openai, undefined);

    await saveQuickChatSearchApiKey("tavily-test-key");
    assert.equal(getQuickChatSearchConfig().provider, "tavily");
    assert.equal(getQuickChatSearchConfig().source, "stored");
    assert.equal(getQuickChatSearchConfig().overrideActive, true);
    await removeQuickChatSearchApiKey();
    assert.equal(getQuickChatSearchConfig().overrideActive, false);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  }
});
