import assert from "node:assert/strict";
import test from "node:test";

const {
  buddyReviewBlockReason,
  modelRefsEqual,
  resolveBuddyWorkflowTransition,
} = await import("../lib/plan-mode.ts");
const {
  buildWorkflowSlashCommands,
  getBuddyReviewerControlPresentation,
  shouldShowBuddyReviewerControl,
} = await import("../components/chat-input/helpers.ts");
const { AgentSessionWrapper, createWorkflowPromptExtension } = await import("../lib/rpc-manager.ts");
const {
  getDefaultActiveToolNames,
  includeDefaultExtensionTools,
} = await import("../lib/tool-settings.ts");

const writer = { provider: "writer-provider", modelId: "writer-model" };
const reviewer = { provider: "review-provider", modelId: "review-model" };
const availableStatus = { subagentsAvailable: true, missingTools: [], installCommand: "install", loadErrors: [] };
const t = (key) => key;

test("workflow prompt extension applies only the current Plan and Buddy state", () => {
  const state = {
    planModeEnabled: true,
    planExecutionMode: "main",
    buddyMode: "plan",
    buddyReviewerModel: reviewer,
    subagentsEnabled: false,
    forceEmptySystemPrompt: false,
  };
  const extension = createWorkflowPromptExtension(state);
  let handleBeforeAgentStart;
  extension.factory({ on: (event, handler) => {
    assert.equal(event, "before_agent_start");
    handleBeforeAgentStart = handler;
  } });

  const event = { systemPrompt: "base prompt", systemPromptOptions: { promptGuidelines: [] } };
  assert.equal(handleBeforeAgentStart(event), undefined);
  assert.match(event.systemPromptOptions.promptGuidelines.join("\n"), /Plan Mode is active/);
  assert.match(event.systemPromptOptions.promptGuidelines.join("\n"), /Buddy Plan rules/);

  state.planModeEnabled = false;
  state.buddyMode = "off";
  const normalEvent = { systemPrompt: "base prompt", systemPromptOptions: { promptGuidelines: [] } };
  assert.equal(handleBeforeAgentStart(normalEvent), undefined);
  assert.deepEqual(normalEvent.systemPromptOptions.promptGuidelines, []);

  state.forceEmptySystemPrompt = true;
  assert.deepEqual(handleBeforeAgentStart({ systemPrompt: "base prompt", systemPromptOptions: { promptGuidelines: [] } }), { systemPrompt: "" });
});

test("composer presents Buddy configuration separately from an active reviewer", () => {
  assert.equal(shouldShowBuddyReviewerControl(2, true), true);
  assert.equal(shouldShowBuddyReviewerControl(1, true), false);
  assert.equal(shouldShowBuddyReviewerControl(2, false), false);
  assert.deepEqual(getBuddyReviewerControlPresentation("off", "Review Model", t), {
    title: "chat.buddyConfigure",
    label: "chat.buddyConfigure",
    hint: "chat.buddyConfigureHint",
  });
  for (const mode of ["plan", "code"]) {
    assert.deepEqual(getBuddyReviewerControlPresentation(mode, "Review Model", t), {
      title: "chat.buddyReviewer",
      label: "chat.buddyReviewer · Review Model",
      hint: "chat.buddyReviewerHint",
    });
  }
  assert.equal(
    getBuddyReviewerControlPresentation("code", null, t).label,
    "chat.buddyReviewerSelect",
  );
});

test("composer blocks Buddy commands for a same-model reviewer", () => {
  const commands = buildWorkflowSlashCommands({
    planMode: "normal",
    planExecutionMode: "main",
    planModeStatus: availableStatus,
    buddyMode: "off",
    subagentsEnabled: false,
    buddyReviewerModel: writer,
    mainModel: writer,
    t,
  });

  for (const name of ["buddy-plan", "buddy-code"]) {
    const command = commands.find((item) => item.name === name);
    assert.equal(command?.disabled, true);
    assert.equal(command?.disabledReason, "same-model");
  }
  const available = buildWorkflowSlashCommands({
    planMode: "normal",
    planExecutionMode: "main",
    planModeStatus: availableStatus,
    buddyMode: "off",
    subagentsEnabled: false,
    buddyReviewerModel: reviewer,
    mainModel: writer,
    t,
  });
  assert.deepEqual(available.filter((item) => item.name.startsWith("buddy-")).map((item) => [item.name, item.disabled]), [
    ["buddy-plan", false],
    ["buddy-code", false],
  ]);
});

test("Buddy mode transitions normalize execution state and preserve Plan Mode when leaving Buddy Plan", () => {
  const fromSubagentPlan = { planMode: "plan", planExecutionMode: "subagent", buddyMode: "off", subagentsEnabled: false };
  const code = resolveBuddyWorkflowTransition(fromSubagentPlan, "code");
  assert.deepEqual(code, { planMode: "normal", planExecutionMode: "main", buddyMode: "code", subagentsEnabled: false });
  assert.deepEqual(resolveBuddyWorkflowTransition(code, "off"), {
    planMode: "normal", planExecutionMode: "main", buddyMode: "off", subagentsEnabled: false,
  });

  const plan = resolveBuddyWorkflowTransition(code, "plan");
  assert.deepEqual(plan, { planMode: "plan", planExecutionMode: "main", buddyMode: "plan", subagentsEnabled: false });
  assert.deepEqual(resolveBuddyWorkflowTransition(plan, "off"), {
    planMode: "plan", planExecutionMode: "main", buddyMode: "off", subagentsEnabled: false,
  });
  assert.deepEqual(resolveBuddyWorkflowTransition(fromSubagentPlan, "off"), fromSubagentPlan);
});

test("Buddy reviewer guard enforces independence, the exact model, and one foreground read-only review", () => {
  const validArgs = {
    subagent_type: "Plan",
    model: "review-provider/review-model",
    inherit_context: false,
    run_in_background: false,
  };
  const workflow = {
    buddyMode: "code",
    reviewerModel: reviewer,
    mainModel: writer,
    buddyReviewCalls: 0,
  };

  assert.equal(buddyReviewBlockReason(workflow, "Agent", validArgs), null);
  assert.match(buddyReviewBlockReason({ ...workflow, mainModel: reviewer }, "Agent", validArgs), /must be different/);
  assert.match(buddyReviewBlockReason({ ...workflow, buddyReviewCalls: 1 }, "Agent", validArgs), /only one/);
  assert.match(buddyReviewBlockReason(workflow, "Agent", { ...validArgs, model: "other/model" }), /must be exactly/);
  assert.match(buddyReviewBlockReason(workflow, "Agent", { ...validArgs, subagent_type: "Explore" }), /read-only/);
  assert.match(buddyReviewBlockReason(workflow, "Agent", { ...validArgs, inherit_context: true }), /independent/);
  assert.match(buddyReviewBlockReason(workflow, "Agent", { ...validArgs, run_in_background: true }), /before completion/);
  assert.equal(buddyReviewBlockReason(workflow, "bash", {}), null);
  assert.equal(modelRefsEqual(writer, { ...writer }), true);
  assert.equal(modelRefsEqual(writer, reviewer), false);
});

test("default tool selection defers subagent tools but preserves other extensions and explicit opt-in", () => {
  const extensions = ["Agent", "get_subagent_result", "steer_subagent", "extension_tool"];
  assert.deepEqual(getDefaultActiveToolNames(extensions), ["read", "bash", "edit", "write", "extension_tool"]);
  assert.deepEqual(includeDefaultExtensionTools(["read", "Agent"], extensions), ["read", "Agent", "extension_tool"]);
  assert.deepEqual(includeDefaultExtensionTools([], extensions), []);
});

test("composer exposes session-scoped subagents mode and disables it when tools are unavailable", () => {
  const available = buildWorkflowSlashCommands({
    planMode: "normal",
    planExecutionMode: "main",
    planModeStatus: availableStatus,
    buddyMode: "off",
    subagentsEnabled: true,
    t,
  });
  const subagents = available.find((item) => item.name === "subagents");
  const normal = available.find((item) => item.name === "normal");
  assert.equal(subagents?.active, true);
  assert.equal(subagents?.disabled, false);
  assert.equal(normal?.active, false);

  const unavailable = buildWorkflowSlashCommands({
    planMode: "normal",
    planExecutionMode: "main",
    planModeStatus: { ...availableStatus, subagentsAvailable: false, missingTools: ["Agent"] },
    buddyMode: "off",
    subagentsEnabled: false,
    t,
  }).find((item) => item.name === "subagents");
  assert.equal(unavailable?.disabled, true);
  assert.equal(unavailable?.disabledReason, "subagents-unavailable");
});

function createFakeSession() {
  const models = new Map([
    ["writer-provider/writer-model", { provider: "writer-provider", id: "writer-model" }],
    ["review-provider/review-model", { provider: "review-provider", id: "review-model" }],
    ["review-provider/alternate-review", { provider: "review-provider", id: "alternate-review" }],
  ]);
  const allTools = ["read", "bash", "grep", "find", "ls", "Agent", "get_subagent_result", "steer_subagent", "extension_tool"]
    .map((name) => ({ name, description: name }));
  let activeToolNames = ["read", "bash", "extension_tool"];
  const state = { systemPrompt: "base prompt", thinkingLevel: "off" };
  const queues = { steering: [], followUp: [] };
  const inner = {
    sessionId: "buddy-test",
    sessionFile: "/tmp/buddy-test.jsonl",
    isStreaming: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    autoRetryEnabled: true,
    model: models.get("writer-provider/writer-model"),
    modelRuntime: {
      getModel: (provider, modelId) => models.get(`${provider}/${modelId}`),
      getAvailableSnapshot: () => [...models.values()],
    },
    sessionManager: {},
    settingsManager: {},
    agent: { state },
    get systemPrompt() { return state.systemPrompt; },
    _baseSystemPrompt: "base prompt",
    getAllTools: () => allTools,
    getActiveToolNames: () => [...activeToolNames],
    setActiveToolsByName: (names) => {
      activeToolNames = [...names];
      const prompt = names.includes("Agent") ? "base prompt\nAgent extension guidance" : "base prompt";
      inner._baseSystemPrompt = prompt;
      state.systemPrompt = prompt;
    },
    getContextUsage: () => undefined,
    getSteeringMessages: () => [...queues.steering],
    getFollowUpMessages: () => [...queues.followUp],
    get pendingMessageCount() { return queues.steering.length + queues.followUp.length; },
    clearQueue: () => {
      const cleared = { steering: [...queues.steering], followUp: [...queues.followUp] };
      queues.steering.length = 0;
      queues.followUp.length = 0;
      return cleared;
    },
    abort: async () => {},
    dispose: () => {},
  };
  return { inner, queues, getActiveToolNames: () => activeToolNames };
}

test("RPC workflow state applies Buddy prompts/tools and restores the original snapshot on full exit", async (t) => {
  const fake = createFakeSession();
  const wrapper = new AgentSessionWrapper(fake.inner);
  t.after(() => wrapper.destroy());

  await assert.rejects(wrapper.send({
    type: "set_buddy_reviewer",
    buddyReviewerModel: writer,
  }), /must be different/);
  let reviewerResult = await wrapper.send({
    type: "set_buddy_reviewer",
    buddyReviewerModel: reviewer,
  });
  assert.deepEqual(reviewerResult.buddyReviewerModel, reviewer);
  fake.inner.messages = [{ role: "user", content: "one" }];
  fake.queues.steering.push("queued steer");
  fake.queues.followUp.push("queued follow-up");
  const configuredState = await wrapper.send({ type: "get_state" });
  assert.equal(configuredState.buddyMode, "off");
  assert.equal(configuredState.messageCount, 1);
  assert.equal(configuredState.pendingMessageCount, 2);
  assert.deepEqual(configuredState.steeringMessages, ["queued steer"]);
  assert.deepEqual(configuredState.followUpMessages, ["queued follow-up"]);
  assert.deepEqual(configuredState.buddyReviewerModel, reviewer);
  assert.equal((await wrapper.send({ type: "get_state" })).systemPrompt, "base prompt");

  const aborted = await wrapper.send({ type: "abort" });
  assert.deepEqual(aborted, {
    queuedMessages: { steering: ["queued steer"], followUp: ["queued follow-up"] },
  });
  const afterAbort = await wrapper.send({ type: "get_state" });
  assert.equal(afterAbort.pendingMessageCount, 0);
  assert.deepEqual(afterAbort.steeringMessages, []);
  assert.deepEqual(afterAbort.followUpMessages, []);

  let result = await wrapper.send({
    type: "set_plan_mode",
    enabled: true,
    executionMode: "main",
    buddyMode: "plan",
  });
  assert.equal(result.planMode, true);
  assert.equal(result.buddyMode, "plan");
  const buddyPlanState = await wrapper.send({ type: "get_state" });
  assert.match(buddyPlanState.systemPrompt, /Buddy Plan rules/);
  assert.equal(buddyPlanState.systemPrompt.match(/Agent extension guidance/g)?.length, 1);
  assert.equal(fake.getActiveToolNames().includes("Agent"), true);

  result = await wrapper.send({
    type: "set_plan_mode",
    enabled: true,
    executionMode: "main",
    buddyMode: "off",
  });
  assert.equal(result.planMode, true);
  assert.equal(result.buddyMode, "off");
  const planState = await wrapper.send({ type: "get_state" });
  assert.doesNotMatch(planState.systemPrompt, /Buddy review is active/);
  assert.match(planState.systemPrompt, /Plan Mode is active/);

  result = await wrapper.send({
    type: "set_plan_mode",
    enabled: false,
    executionMode: "subagent",
    buddyMode: "off",
  });
  assert.equal(result.planMode, false);
  assert.equal(result.planExecutionMode, "main");
  assert.equal(result.buddyMode, "off");
  assert.deepEqual(fake.getActiveToolNames(), ["read", "bash", "extension_tool"]);
  assert.equal((await wrapper.send({ type: "get_state" })).systemPrompt, "base prompt");

  result = await wrapper.send({
    type: "set_plan_mode",
    enabled: false,
    executionMode: "main",
    buddyMode: "code",
    buddyReviewerModel: reviewer,
  });
  assert.equal(result.planMode, false);
  assert.equal(result.buddyMode, "code");
  assert.match((await wrapper.send({ type: "get_state" })).systemPrompt, /Buddy Code rules/);
  assert.equal(fake.getActiveToolNames().includes("extension_tool"), true);
  assert.equal(fake.getActiveToolNames().includes("Agent"), true);

  reviewerResult = await wrapper.send({
    type: "set_buddy_reviewer",
    buddyReviewerModel: { provider: "review-provider", modelId: "alternate-review" },
  });
  assert.equal(reviewerResult.buddyReviewerModel.modelId, "alternate-review");
  assert.match((await wrapper.send({ type: "get_state" })).systemPrompt, /review-provider\/alternate-review/);

  result = await wrapper.send({
    type: "set_plan_mode",
    enabled: false,
    executionMode: "main",
    buddyMode: "off",
  });
  assert.equal(result.planExecutionMode, "main");
  assert.deepEqual(fake.getActiveToolNames(), ["read", "bash", "extension_tool"]);
  assert.equal((await wrapper.send({ type: "get_state" })).systemPrompt, "base prompt");
});

test("RPC subagents mode adds conditional guidance once and restores the configured baseline", async (t) => {
  const fake = createFakeSession();
  const wrapper = new AgentSessionWrapper(fake.inner);
  t.after(() => wrapper.destroy());

  let result = await wrapper.send({
    type: "set_plan_mode",
    enabled: false,
    executionMode: "main",
    buddyMode: "off",
    subagentsEnabled: true,
  });
  assert.equal(result.subagentsEnabled, true);
  assert.equal(fake.getActiveToolNames().includes("Agent"), true);
  assert.equal(fake.inner.agent.state.systemPrompt.match(/Agent extension guidance/g)?.length, 1);
  assert.equal(
    (await wrapper.send({ type: "get_state" })).systemPrompt.match(/Subagents Mode is active/g)?.length,
    1,
  );

  result = await wrapper.send({
    type: "set_plan_mode",
    enabled: false,
    executionMode: "main",
    buddyMode: "off",
    subagentsEnabled: false,
  });
  assert.equal(result.subagentsEnabled, false);
  assert.deepEqual(fake.getActiveToolNames(), ["read", "bash", "extension_tool"]);
  assert.equal(fake.inner.agent.state.systemPrompt, "base prompt");
});
