import assert from "node:assert/strict";
import test from "node:test";

const { effectiveAutoThinkingLevel } = await import("../lib/thinking-level.ts");

test("Auto resolves the per-model default first", () => {
  const model = { provider: "openai", modelId: "gpt-x" };
  assert.equal(
    effectiveAutoThinkingLevel(model, { "openai:gpt-x": "high" }, "low"),
    "high",
  );
});

test("Auto falls back to the global default when the model has none", () => {
  const model = { provider: "openai", modelId: "gpt-x" };
  assert.equal(effectiveAutoThinkingLevel(model, {}, "low"), "low");
});

test("Auto falls back to the pi default when nothing is configured", () => {
  assert.equal(effectiveAutoThinkingLevel(null, {}, null), "medium");
  assert.equal(effectiveAutoThinkingLevel({ provider: "p", modelId: "m" }, {}, undefined), "medium");
});

test("a model-specific default wins over the global default for the same model", () => {
  const model = { provider: "p", modelId: "m" };
  assert.equal(effectiveAutoThinkingLevel(model, { "p:m": "max" }, "off"), "max");
  assert.equal(effectiveAutoThinkingLevel({ provider: "p", modelId: "other" }, { "p:m": "max" }, "off"), "off");
});