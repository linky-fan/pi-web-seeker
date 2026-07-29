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
const { AgentSessionWrapper } = await import("../lib/rpc-manager.ts");

const writer = { provider: "writer-provider", modelId: "writer-model" };
const reviewer = { provider: "review-provider", modelId: "review-model" };
const availableStatus = { subagentsAvailable: true, missingTools: [], installCommand: "install", loadErrors: [] };
const t = (key) => key;

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
  const fromSubagentPlan = { planMode: "plan", planExecutionMode: "subagent", buddyMode: "off" };
  const code = resolveBuddyWorkflowTransition(fromSubagentPlan, "code");
  assert.deepEqual(code, { planMode: "normal", planExecutionMode: "main", buddyMode: "code" });
  assert.deepEqual(resolveBuddyWorkflowTransition(code, "off"), {
    planMode: "normal", planExecutionMode: "main", buddyMode: "off",
  });

  const plan = resolveBuddyWorkflowTransition(code, "plan");
  assert.deepEqual(plan, { planMode: "plan", planExecutionMode: "main", buddyMode: "plan" });
  assert.deepEqual(resolveBuddyWorkflowTransition(plan, "off"), {
    planMode: "plan", planExecutionMode: "main", buddyMode: "off",
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
    _baseSystemPrompt: "base prompt",
    getAllTools: () => allTools,
    getActiveToolNames: () => [...activeToolNames],
    setActiveToolsByName: (names) => { activeToolNames = [...names]; },
    getContextUsage: () => undefined,
    dispose: () => {},
  };
  return { inner, getActiveToolNames: () => activeToolNames };
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
  const configuredState = await wrapper.send({ type: "get_state" });
  assert.equal(configuredState.buddyMode, "off");
  assert.deepEqual(configuredState.buddyReviewerModel, reviewer);
  assert.equal(fake.inner.agent.state.systemPrompt, "base prompt");

  let result = await wrapper.send({
    type: "set_plan_mode",
    enabled: true,
    executionMode: "main",
    buddyMode: "plan",
  });
  assert.equal(result.planMode, true);
  assert.equal(result.buddyMode, "plan");
  assert.match(fake.inner.agent.state.systemPrompt, /Buddy Plan rules/);
  assert.equal(fake.getActiveToolNames().includes("Agent"), true);

  result = await wrapper.send({
    type: "set_plan_mode",
    enabled: true,
    executionMode: "main",
    buddyMode: "off",
  });
  assert.equal(result.planMode, true);
  assert.equal(result.buddyMode, "off");
  assert.doesNotMatch(fake.inner.agent.state.systemPrompt, /Buddy review is active/);
  assert.match(fake.inner.agent.state.systemPrompt, /Plan Mode is active/);

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
  assert.equal(fake.inner.agent.state.systemPrompt, "base prompt");

  result = await wrapper.send({
    type: "set_plan_mode",
    enabled: false,
    executionMode: "main",
    buddyMode: "code",
    buddyReviewerModel: reviewer,
  });
  assert.equal(result.planMode, false);
  assert.equal(result.buddyMode, "code");
  assert.match(fake.inner.agent.state.systemPrompt, /Buddy Code rules/);
  assert.equal(fake.getActiveToolNames().includes("extension_tool"), true);
  assert.equal(fake.getActiveToolNames().includes("Agent"), true);

  reviewerResult = await wrapper.send({
    type: "set_buddy_reviewer",
    buddyReviewerModel: { provider: "review-provider", modelId: "alternate-review" },
  });
  assert.equal(reviewerResult.buddyReviewerModel.modelId, "alternate-review");
  assert.match(fake.inner.agent.state.systemPrompt, /review-provider\/alternate-review/);

  result = await wrapper.send({
    type: "set_plan_mode",
    enabled: false,
    executionMode: "main",
    buddyMode: "off",
  });
  assert.equal(result.planExecutionMode, "main");
  assert.deepEqual(fake.getActiveToolNames(), ["read", "bash", "extension_tool"]);
  assert.equal(fake.inner.agent.state.systemPrompt, "base prompt");
});
