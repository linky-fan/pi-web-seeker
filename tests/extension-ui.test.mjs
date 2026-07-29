import assert from "node:assert/strict";
import test from "node:test";

const { AgentSessionWrapper } = await import("../lib/rpc-manager.ts");

function createFakeSession() {
  const allTools = ["read", "bash", "extension_tool"].map((name) => ({ name, description: name }));
  let activeToolNames = allTools.map((tool) => tool.name);
  let reloadCalls = 0;
  let disposed = false;
  const inner = {
    sessionId: `extension-ui-${Math.random().toString(36).slice(2)}`,
    sessionFile: "/tmp/extension-ui-test.jsonl",
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: { provider: "test", id: "model" },
    modelRegistry: { find: () => undefined },
    sessionManager: {},
    settingsManager: {},
    agent: { state: { systemPrompt: "test" } },
    getAllTools: () => allTools,
    getActiveToolNames: () => [...activeToolNames],
    setActiveToolsByName: (names) => { activeToolNames = [...names]; },
    reload: async (options) => {
      reloadCalls += 1;
      await options?.beforeSessionStart?.();
    },
    getContextUsage: () => undefined,
    dispose: () => { disposed = true; },
  };
  return {
    inner,
    getActiveToolNames: () => activeToolNames,
    getReloadCalls: () => reloadCalls,
    isDisposed: () => disposed,
  };
}

function customEvents(events) {
  return events.filter((event) => event.type === "extension_ui_request" && event.method === "custom");
}

async function flushFactory() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("custom UI renders, replays, handles input, and closes with one disposal", async (t) => {
  const fake = createFakeSession();
  const wrapper = new AgentSessionWrapper(fake.inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  const ui = wrapper.createExtensionUiContext();
  let finish;
  let line = "initial";
  let disposeCalls = 0;
  const inputs = [];

  const resultPromise = ui.custom((_, __, ___, done) => {
    finish = done;
    return {
      render: (width) => [`${line}:${width}`],
      handleInput: (data) => { inputs.push(data); line = `input-${data}`; },
      dispose: () => { disposeCalls += 1; },
    };
  }, { overlayOptions: { width: 180 } });
  await flushFactory();

  const opened = customEvents(events).at(-1);
  assert.deepEqual(opened.lines, ["initial:140"]);
  const replayed = [];
  wrapper.onEvent((event) => replayed.push(event));
  assert.deepEqual(customEvents(replayed), [opened]);

  await wrapper.send({ type: "extension_ui_input", id: opened.id, data: "x" });
  assert.deepEqual(inputs, ["x"]);
  assert.deepEqual(customEvents(events).at(-1).lines, ["input-x:140"]);

  finish("accepted");
  finish("ignored");
  assert.equal(await resultPromise, "accepted");
  assert.equal(disposeCalls, 1);
  assert.equal(customEvents(events).at(-1).closed, true);
  const afterCloseReplay = [];
  wrapper.onEvent((event) => afterCloseReplay.push(event));
  assert.deepEqual(customEvents(afterCloseReplay), []);
});

test("custom UI input failures, reload, and destroy settle and clean up components", async () => {
  const fake = createFakeSession();
  const wrapper = new AgentSessionWrapper(fake.inner);
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  const ui = wrapper.createExtensionUiContext();
  let inputFailureDisposals = 0;

  const failedResult = ui.custom(() => ({
    render: () => ["throws on input"],
    handleInput: () => { throw new Error("input failed"); },
    dispose: () => { inputFailureDisposals += 1; },
  }));
  await flushFactory();
  const failedPanel = customEvents(events).at(-1);
  await wrapper.send({ type: "extension_ui_input", id: failedPanel.id, data: "x" });
  assert.equal(await failedResult, undefined);
  assert.equal(inputFailureDisposals, 1);
  assert.equal(customEvents(events).at(-1).closed, true);
  assert.equal(events.some((event) => event.type === "extension_error" && event.event === "custom_ui_input"), true);

  let reloadDisposals = 0;
  const reloadResult = ui.custom(() => ({
    render: () => ["reload me"],
    dispose: () => { reloadDisposals += 1; },
  }));
  await flushFactory();
  await wrapper.send({ type: "reload" });
  assert.equal(await reloadResult, undefined);
  assert.equal(reloadDisposals, 1);
  assert.equal(fake.getReloadCalls(), 1);

  let activeDestroyDisposals = 0;
  const activeDestroyResult = ui.custom(() => ({
    render: () => ["destroy me"],
    dispose: () => { activeDestroyDisposals += 1; },
  }));
  await flushFactory();

  let releaseFactory;
  let staleDisposals = 0;
  const staleResult = ui.custom(async () => {
    await new Promise((resolve) => { releaseFactory = resolve; });
    return {
      render: () => ["must not render"],
      dispose: () => { staleDisposals += 1; },
    };
  });
  await flushFactory();
  wrapper.destroy();
  releaseFactory();
  assert.equal(await activeDestroyResult, undefined);
  assert.equal(await staleResult, undefined);
  assert.equal(activeDestroyDisposals, 1);
  assert.equal(staleDisposals, 1);
  assert.equal(fake.isDisposed(), true);
  assert.equal(customEvents(events).some((event) => event.lines?.[0] === "must not render"), false);
});

test("a synchronous custom UI completion never leaves a live panel", async (t) => {
  const fake = createFakeSession();
  const wrapper = new AgentSessionWrapper(fake.inner);
  t.after(() => wrapper.destroy());
  const events = [];
  wrapper.onEvent((event) => events.push(event));
  const ui = wrapper.createExtensionUiContext();
  let disposeCalls = 0;

  const resultPromise = ui.custom((_, __, ___, done) => {
    done("already done");
    return {
      render: () => ["must not open"],
      dispose: () => { disposeCalls += 1; },
    };
  });
  assert.equal(await resultPromise, "already done");
  await flushFactory();
  assert.equal(disposeCalls, 1);
  assert.deepEqual(customEvents(events), []);
});

test("normal tool presets preserve extension tools while exact mode stays exact", async (t) => {
  const fake = createFakeSession();
  const wrapper = new AgentSessionWrapper(fake.inner);
  t.after(() => wrapper.destroy());

  await wrapper.send({ type: "set_tools", toolNames: ["read"] });
  assert.deepEqual(fake.getActiveToolNames(), ["read", "extension_tool"]);
  await wrapper.send({ type: "set_tools", toolNames: ["bash"], exact: true });
  assert.deepEqual(fake.getActiveToolNames(), ["bash"]);
});
