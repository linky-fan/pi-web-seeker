import assert from "node:assert/strict";
import test from "node:test";

const { AgentSessionWrapper } = await import("../lib/rpc-manager.ts");

function createFakeSession(overrides = {}) {
  const allTools = ["read", "bash", "extension_tool"].map((name) => ({ name, description: name }));
  let activeToolNames = allTools.map((tool) => tool.name);
  let reloadCalls = 0;
  let disposed = false;
  let subscriber = null;
  let unsubscribeCalls = 0;
  const inner = {
    sessionId: `extension-ui-${Math.random().toString(36).slice(2)}`,
    sessionFile: "/tmp/extension-ui-test.jsonl",
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: { provider: "test", id: "model" },
    modelRuntime: { getModel: () => undefined, getAvailableSnapshot: () => [] },
    sessionManager: {},
    settingsManager: {},
    agent: { state: { systemPrompt: "test" } },
    getAllTools: () => allTools,
    getActiveToolNames: () => [...activeToolNames],
    setActiveToolsByName: (names) => { activeToolNames = [...names]; },
    subscribe: (listener) => {
      subscriber = listener;
      return () => { unsubscribeCalls += 1; subscriber = null; };
    },
    prompt: async (_text, options) => { options?.preflightResult?.(true); },
    reload: async (options) => {
      reloadCalls += 1;
      await options?.beforeSessionStart?.();
    },
    getContextUsage: () => undefined,
    dispose: () => { disposed = true; },
    ...overrides,
  };
  return {
    inner,
    getActiveToolNames: () => activeToolNames,
    getReloadCalls: () => reloadCalls,
    isDisposed: () => disposed,
    emit: (event) => subscriber?.(event),
    getUnsubscribeCalls: () => unsubscribeCalls,
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

test("event listeners are isolated and a throwing listener is removed", (t) => {
  t.mock.method(console, "error", () => {});
  const fake = createFakeSession();
  const wrapper = new AgentSessionWrapper(fake.inner);
  wrapper.start();
  t.after(() => wrapper.destroy());
  let failedCalls = 0;
  const received = [];
  wrapper.onEvent(() => { failedCalls += 1; throw new Error("listener failed"); });
  wrapper.onEvent((event) => received.push(event.type));

  fake.emit({ type: "agent_start" });
  fake.emit({ type: "agent_end" });

  assert.equal(failedCalls, 1);
  assert.deepEqual(received, ["agent_start", "agent_end"]);
});

test("destroy is idempotent and completes every cleanup step after failures", async (t) => {
  t.mock.method(console, "error", () => {});
  let disposeCalls = 0;
  let unsubscribeCalls = 0;
  const fake = createFakeSession({
    subscribe: () => () => { unsubscribeCalls += 1; throw new Error("unsubscribe failed"); },
    dispose: () => { disposeCalls += 1; throw new Error("dispose failed"); },
  });
  const wrapper = new AgentSessionWrapper(fake.inner);
  wrapper.start();
  const ui = wrapper.createExtensionUiContext();
  let customDisposeCalls = 0;
  const dialogResult = ui.select("Choose", ["one"]);
  const customResult = ui.custom(() => ({
    render: () => ["active"],
    dispose: () => { customDisposeCalls += 1; throw new Error("custom dispose failed"); },
  }));
  await flushFactory();
  let destroyCallbacks = 0;
  wrapper.onDestroy(() => { destroyCallbacks += 1; throw new Error("destroy callback failed"); });

  assert.doesNotThrow(() => wrapper.destroy());
  assert.doesNotThrow(() => wrapper.destroy());
  assert.equal(await dialogResult, undefined);
  assert.equal(await customResult, undefined);
  assert.equal(wrapper.isAlive(), false);
  assert.equal(unsubscribeCalls, 1);
  assert.equal(customDisposeCalls, 1);
  assert.equal(disposeCalls, 1);
  assert.equal(destroyCallbacks, 1);

  let failedStartDisposals = 0;
  const failedStart = new AgentSessionWrapper(createFakeSession({
    subscribe: () => { throw new Error("subscribe failed"); },
    dispose: () => { failedStartDisposals += 1; },
  }).inner);
  assert.throws(() => failedStart.start(), /subscribe failed/);
  assert.equal(failedStart.isAlive(), false);
  assert.equal(failedStartDisposals, 1);
});

test("extension binding and reload failures retire their session after cleanup", async (t) => {
  t.mock.method(console, "error", () => {});
  const bindingFake = createFakeSession({
    bindExtensions: async () => { throw new Error("binding failed"); },
  });
  const bindingWrapper = new AgentSessionWrapper(bindingFake.inner);
  const bindingEvents = [];
  bindingWrapper.onEvent((event) => bindingEvents.push(event));
  let bindingDestroyCalls = 0;
  bindingWrapper.onDestroy(() => { bindingDestroyCalls += 1; });
  bindingWrapper.beginExtensionBinding();
  await flushFactory();
  assert.equal(bindingWrapper.isAlive(), false);
  assert.equal(bindingDestroyCalls, 1);
  assert.equal(bindingEvents.some((event) => event.type === "extension_error" && event.event === "session_start"), true);
  await assert.rejects(bindingWrapper.send({ type: "get_state" }), /no longer available/);

  const reloadFake = createFakeSession({
    reload: async () => { throw new Error("reload failed"); },
  });
  const reloadWrapper = new AgentSessionWrapper(reloadFake.inner);
  const reloadEvents = [];
  reloadWrapper.onEvent((event) => reloadEvents.push(event));
  const ui = reloadWrapper.createExtensionUiContext();
  let customDisposeCalls = 0;
  const dialogResult = ui.confirm("Confirm", "Continue?");
  const customResult = ui.custom(() => ({
    render: () => ["reload pending"],
    dispose: () => { customDisposeCalls += 1; },
  }));
  await flushFactory();

  await assert.rejects(reloadWrapper.send({ type: "reload" }), /reload failed/);
  assert.equal(await dialogResult, false);
  assert.equal(await customResult, undefined);
  assert.equal(customDisposeCalls, 1);
  assert.equal(reloadWrapper.isAlive(), false);
  assert.equal(reloadEvents.some((event) => event.type === "extension_error" && event.event === "reload"), true);
  await assert.rejects(reloadWrapper.send({ type: "get_state" }), /no longer available/);
});

test("accepted prompt failures retire once while preflight errors stay reusable", async (t) => {
  t.mock.method(console, "error", () => {});
  const failedFake = createFakeSession({
    prompt: async (_text, options) => {
      options?.preflightResult?.(true);
      throw new Error("agent loop failed");
    },
  });
  const failedWrapper = new AgentSessionWrapper(failedFake.inner);
  const failedEvents = [];
  failedWrapper.onEvent((event) => failedEvents.push(event));
  let destroyCalls = 0;
  failedWrapper.onDestroy(() => { destroyCalls += 1; });

  assert.equal(await failedWrapper.send({ type: "prompt", message: "hello" }), null);
  await flushFactory();
  assert.equal(failedWrapper.isAlive(), false);
  assert.equal(destroyCalls, 1);
  await assert.rejects(failedWrapper.send({ type: "get_state" }), /no longer available/);
  assert.deepEqual(
    failedEvents.filter((event) => event.type === "runtime_error"),
    [{ type: "runtime_error", scope: "session", message: "agent loop failed", recoverable: true }],
  );

  const preflightFake = createFakeSession({
    prompt: async (_text, options) => {
      options?.preflightResult?.(false);
      throw new Error("authentication required");
    },
  });
  const preflightWrapper = new AgentSessionWrapper(preflightFake.inner);
  t.after(() => preflightWrapper.destroy());
  const preflightEvents = [];
  preflightWrapper.onEvent((event) => preflightEvents.push(event));
  await assert.rejects(preflightWrapper.send({ type: "prompt", message: "hello" }), /authentication required/);
  assert.equal(preflightWrapper.isAlive(), true);
  assert.equal(preflightEvents.some((event) => event.type === "runtime_error"), false);

  const ordinaryFake = createFakeSession();
  const ordinaryWrapper = new AgentSessionWrapper(ordinaryFake.inner);
  ordinaryWrapper.start();
  t.after(() => ordinaryWrapper.destroy());
  assert.equal(await ordinaryWrapper.send({ type: "prompt", message: "hello" }), null);
  ordinaryFake.emit({
    type: "message_end",
    message: { role: "assistant", content: [], stopReason: "error", errorMessage: "provider failed" },
  });
  assert.equal(ordinaryWrapper.isAlive(), true);
});
