import { useCallback, useEffect, useRef, useState } from "react";
import { apiPath } from "@/lib/api-path";
import { sendAgentCommand } from "@/lib/agent-client";
import type { BuddyMode, ModelRef, PlanExecutionMode, PlanMode, PlanModeStatus } from "@/lib/plan-mode";
import {
  BUDDY_MODE_STORAGE_PREFIX,
  BUDDY_REVIEWER_STORAGE_PREFIX,
  isAbortError,
  PLAN_EXECUTION_MODE_STORAGE_PREFIX,
  PLAN_MODE_STORAGE_PREFIX,
  sessionStorageKey,
} from "./helpers";
import type { LiveAgentState, ModelListItem, ThinkingLevelOption } from "./types";

interface PreferencesOptions {
  sessionId: string | null;
  sessionCwd: string | null;
  newSessionCwd: string | null;
  isNew: boolean;
  modelsRefreshKey?: number;
  sessionIdRef: React.MutableRefObject<string | null>;
  agentRunningRef: React.MutableRefObject<boolean>;
  gate: {
    capture: () => { generation: number; identity: string };
    isCurrent: (token: { generation: number; identity: string }) => boolean;
  };
  contextModel: { provider: string; modelId: string } | null;
  contextThinkingLevel?: ThinkingLevelOption;
  currentModelOverride: { provider: string; modelId: string } | null;
  pendingModel: { provider: string; modelId: string } | null;
  setCurrentModelOverride: (model: { provider: string; modelId: string } | null) => void;
  setTaskError: (message: string | null) => void;
  externalSetNewSessionModel?: (model: { provider: string; modelId: string } | null) => void;
}

function writeStorage(key: string | null, value: string | null) {
  if (!key) return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* localStorage may be unavailable */ }
}

export function usePreferencesController(options: PreferencesOptions) {
  const {
    sessionId, sessionCwd, newSessionCwd, isNew, modelsRefreshKey, sessionIdRef, agentRunningRef,
    gate, contextModel, contextThinkingLevel, currentModelOverride, pendingModel,
    setCurrentModelOverride, setTaskError, externalSetNewSessionModel,
  } = options;
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelListItem[]>([]);
  const [modelThinkingLevels, setModelThinkingLevels] = useState<Record<string, string[]>>({});
  const [modelThinkingLevelMaps, setModelThinkingLevelMaps] = useState<Record<string, Record<string, string | null>>>({});
  const [newSessionModel, setNewSessionModelState] = useState<{ provider: string; modelId: string } | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevelOption>("auto");
  const [planMode, setPlanMode] = useState<PlanMode>("normal");
  const [planExecutionMode, setPlanExecutionMode] = useState<PlanExecutionMode>("main");
  const [planModeStatus, setPlanModeStatus] = useState<PlanModeStatus | null>(null);
  const [buddyMode, setBuddyMode] = useState<BuddyMode>("off");
  const [buddyReviewerModel, setBuddyReviewerModel] = useState<ModelRef | null>(null);
  const modelRequestRef = useRef<AbortController | null>(null);
  const operationRef = useRef({ mode: 0, model: 0, reviewer: 0, thinking: 0 });

  const setNewSessionModel = useCallback((model: { provider: string; modelId: string } | null) => {
    setNewSessionModelState(model);
    externalSetNewSessionModel?.(model);
  }, [externalSetNewSessionModel]);

  const planModeStorageKey = sessionStorageKey(PLAN_MODE_STORAGE_PREFIX, sessionId, newSessionCwd);
  const planExecutionModeStorageKey = sessionStorageKey(PLAN_EXECUTION_MODE_STORAGE_PREFIX, sessionId, newSessionCwd);
  const buddyModeStorageKey = sessionStorageKey(BUDDY_MODE_STORAGE_PREFIX, sessionId, newSessionCwd);
  const buddyReviewerStorageKey = sessionCwd || newSessionCwd
    ? `${BUDDY_REVIEWER_STORAGE_PREFIX}:cwd:${newSessionCwd ?? sessionCwd}`
    : BUDDY_REVIEWER_STORAGE_PREFIX;

  useEffect(() => {
    operationRef.current.mode += 1;
    operationRef.current.model += 1;
    operationRef.current.reviewer += 1;
    operationRef.current.thinking += 1;
    try {
      setPlanMode(planModeStorageKey && window.localStorage.getItem(planModeStorageKey) === "plan" ? "plan" : "normal");
      setPlanExecutionMode(planExecutionModeStorageKey && window.localStorage.getItem(planExecutionModeStorageKey) === "subagent" ? "subagent" : "main");
      const savedBuddy = buddyModeStorageKey ? window.localStorage.getItem(buddyModeStorageKey) : null;
      setBuddyMode(savedBuddy === "plan" || savedBuddy === "code" ? savedBuddy : "off");
      const savedReviewer = window.localStorage.getItem(buddyReviewerStorageKey);
      const parsed = savedReviewer ? JSON.parse(savedReviewer) as Partial<ModelRef> : null;
      setBuddyReviewerModel(parsed && typeof parsed.provider === "string" && typeof parsed.modelId === "string"
        ? { provider: parsed.provider, modelId: parsed.modelId }
        : null);
    } catch {
      setPlanMode("normal");
      setPlanExecutionMode("main");
      setBuddyMode("off");
      setBuddyReviewerModel(null);
    }
  }, [buddyModeStorageKey, buddyReviewerStorageKey, planExecutionModeStorageKey, planModeStorageKey]);

  useEffect(() => {
    if (contextThinkingLevel && contextThinkingLevel !== "off") setThinkingLevel(contextThinkingLevel);
  }, [contextThinkingLevel]);

  const persistModes = useCallback((nextPlan: PlanMode, nextExecution: PlanExecutionMode, nextBuddy: BuddyMode) => {
    writeStorage(planModeStorageKey, nextPlan === "plan" ? "plan" : null);
    writeStorage(planExecutionModeStorageKey, nextExecution === "subagent" ? "subagent" : null);
    writeStorage(buddyModeStorageKey, nextBuddy === "off" ? null : nextBuddy);
  }, [buddyModeStorageKey, planExecutionModeStorageKey, planModeStorageKey]);

  const persistReviewer = useCallback((model: ModelRef | null) => {
    writeStorage(buddyReviewerStorageKey, model ? JSON.stringify(model) : null);
  }, [buddyReviewerStorageKey]);

  const displayModel = isNew ? newSessionModel : currentModelOverride ?? contextModel ?? pendingModel ?? null;

  const handlePlanModeChange = useCallback(async (mode: PlanMode, executionMode: PlanExecutionMode = "main") => {
    if (agentRunningRef.current) return false;
    const operation = ++operationRef.current.mode;
    const previous = { planMode, planExecutionMode, buddyMode };
    const nextExecution = mode === "plan" ? executionMode : "main";
    setPlanMode(mode);
    setPlanExecutionMode(nextExecution);
    setBuddyMode("off");
    persistModes(mode, nextExecution, "off");
    const sid = sessionIdRef.current;
    if (!sid || isNew) return true;
    try {
      const result = await sendAgentCommand<LiveAgentState>(sid, {
        type: "set_plan_mode", enabled: mode === "plan", executionMode, buddyMode: "off",
      });
      if (operation !== operationRef.current.mode || sid !== sessionIdRef.current) return false;
      if (result.planExecutionMode) setPlanExecutionMode(result.planExecutionMode);
      if (result.planModeStatus) setPlanModeStatus(result.planModeStatus);
      return true;
    } catch (caught) {
      if (operation !== operationRef.current.mode || sid !== sessionIdRef.current) return false;
      console.error("Failed to set plan mode:", caught);
      setPlanMode(previous.planMode);
      setPlanExecutionMode(previous.planExecutionMode);
      setBuddyMode(previous.buddyMode);
      persistModes(previous.planMode, previous.planExecutionMode, previous.buddyMode);
      return false;
    }
  }, [agentRunningRef, buddyMode, isNew, persistModes, planExecutionMode, planMode, sessionIdRef]);

  const handleBuddyModeChange = useCallback(async (nextBuddyMode: BuddyMode) => {
    if (agentRunningRef.current) return false;
    if (nextBuddyMode !== "off") {
      if (!buddyReviewerModel || !displayModel) return false;
      if (buddyReviewerModel.provider === displayModel.provider && buddyReviewerModel.modelId === displayModel.modelId) return false;
      if (planModeStatus && !planModeStatus.subagentsAvailable) return false;
    }
    const operation = ++operationRef.current.mode;
    const previous = { buddyMode, planMode, planExecutionMode };
    const nextPlan: PlanMode = nextBuddyMode === "plan" ? "plan" : nextBuddyMode === "code" ? "normal" : planMode;
    const nextExecution: PlanExecutionMode = nextBuddyMode === "plan" ? "main" : planExecutionMode;
    setBuddyMode(nextBuddyMode);
    setPlanMode(nextPlan);
    setPlanExecutionMode(nextExecution);
    persistModes(nextPlan, nextExecution, nextBuddyMode);
    const sid = sessionIdRef.current;
    if (!sid || isNew) return true;
    try {
      const result = await sendAgentCommand<LiveAgentState>(sid, {
        type: "set_plan_mode", enabled: nextPlan === "plan", executionMode: nextExecution,
        buddyMode: nextBuddyMode, buddyReviewerModel,
      });
      if (operation !== operationRef.current.mode || sid !== sessionIdRef.current) return false;
      if (result.buddyMode) setBuddyMode(result.buddyMode);
      return true;
    } catch (caught) {
      if (operation !== operationRef.current.mode || sid !== sessionIdRef.current) return false;
      console.error("Failed to set buddy mode:", caught);
      setBuddyMode(previous.buddyMode);
      setPlanMode(previous.planMode);
      setPlanExecutionMode(previous.planExecutionMode);
      persistModes(previous.planMode, previous.planExecutionMode, previous.buddyMode);
      return false;
    }
  }, [agentRunningRef, buddyReviewerModel, displayModel, isNew, persistModes, planExecutionMode, planMode, planModeStatus, sessionIdRef, buddyMode]);

  const handleBuddyReviewerChange = useCallback(async (provider: string, modelId: string) => {
    const next = { provider, modelId };
    if (displayModel?.provider === provider && displayModel.modelId === modelId) return false;
    const operation = ++operationRef.current.reviewer;
    const previous = buddyReviewerModel;
    setBuddyReviewerModel(next);
    persistReviewer(next);
    const sid = sessionIdRef.current;
    if (!sid || isNew) return true;
    try {
      await sendAgentCommand(sid, { type: "set_buddy_reviewer", buddyReviewerModel: next });
      return operation === operationRef.current.reviewer && sid === sessionIdRef.current;
    } catch (caught) {
      if (operation !== operationRef.current.reviewer || sid !== sessionIdRef.current) return false;
      console.error("Failed to set buddy reviewer:", caught);
      setBuddyReviewerModel(previous);
      persistReviewer(previous);
      return false;
    }
  }, [buddyReviewerModel, displayModel, isNew, persistReviewer, sessionIdRef]);

  const handleModelChange = useCallback(async (provider: string, modelId: string) => {
    if (buddyMode !== "off" && buddyReviewerModel?.provider === provider && buddyReviewerModel.modelId === modelId) {
      setTaskError("Buddy writer and reviewer models must be different");
      return;
    }
    if (isNew) return setNewSessionModel({ provider, modelId });
    const sid = sessionIdRef.current;
    if (!sid) return;
    const operation = ++operationRef.current.model;
    try {
      await sendAgentCommand(sid, { type: "set_model", provider, modelId });
      if (operation === operationRef.current.model && sid === sessionIdRef.current) setCurrentModelOverride({ provider, modelId });
    } catch (caught) {
      if (operation === operationRef.current.model && sid === sessionIdRef.current) console.error("Failed to set model:", caught);
    }
  }, [buddyMode, buddyReviewerModel, isNew, sessionIdRef, setCurrentModelOverride, setNewSessionModel, setTaskError]);

  const handleThinkingLevelChange = useCallback(async (level: ThinkingLevelOption) => {
    setThinkingLevel(level);
    if (level === "auto") return;
    const sid = sessionIdRef.current;
    if (!sid) return;
    const operation = ++operationRef.current.thinking;
    try {
      await sendAgentCommand(sid, { type: "set_thinking_level", level });
    } catch (caught) {
      if (operation === operationRef.current.thinking && sid === sessionIdRef.current) console.error("Failed to set thinking level:", caught);
    }
  }, [sessionIdRef]);

  const applyPreferenceState = useCallback((state: LiveAgentState | undefined) => {
    if (!state) return;
    if (state.thinkingLevel !== undefined) setThinkingLevel((state.thinkingLevel as ThinkingLevelOption) ?? "auto");
    if (state.planMode !== undefined) setPlanMode(state.planMode ? "plan" : "normal");
    if (state.planExecutionMode === "main" || state.planExecutionMode === "subagent") setPlanExecutionMode(state.planExecutionMode);
    if (state.planModeStatus !== undefined) setPlanModeStatus(state.planModeStatus ?? null);
    if (state.buddyMode) setBuddyMode(state.buddyMode);
    if (state.buddyReviewerModel !== undefined) setBuddyReviewerModel(state.buddyReviewerModel ?? null);
  }, []);

  useEffect(() => {
    modelRequestRef.current?.abort();
    const controller = new AbortController();
    modelRequestRef.current = controller;
    const token = gate.capture();
    fetch(apiPath("models"), { signal: controller.signal }).then((response) => response.json()).then((result: {
      models: Record<string, string>; modelList?: ModelListItem[]; defaultModel?: ModelRef | null;
      thinkingLevels?: Record<string, string[]>; thinkingLevelMaps?: Record<string, Record<string, string | null>>;
    }) => {
      if (!gate.isCurrent(token) || modelRequestRef.current !== controller) return;
      setModelNames(result.models);
      if (result.thinkingLevels) setModelThinkingLevels(result.thinkingLevels);
      if (result.thinkingLevelMaps) setModelThinkingLevelMaps(result.thinkingLevelMaps);
      if (!result.modelList) return;
      setModelList(result.modelList);
      setBuddyReviewerModel((current) => {
        if (current && result.modelList?.some((model) => model.provider === current.provider && model.id === current.modelId)) return current;
        const preferred = result.modelList?.find((model) => /deepseek.*v4.*pro/i.test(`${model.name} ${model.id}`));
        const next = preferred ? { provider: preferred.provider, modelId: preferred.id } : null;
        if (next) persistReviewer(next);
        return next;
      });
      if (isNew && result.modelList.length) {
        const match = result.defaultModel && result.modelList.find((model) => model.id === result.defaultModel?.modelId && model.provider === result.defaultModel?.provider);
        setNewSessionModel(match
          ? { provider: match.provider, modelId: match.id }
          : { provider: result.modelList[0].provider, modelId: result.modelList[0].id });
      }
    }).catch((caught) => { if (!isAbortError(caught)) console.error("Failed to load models:", caught); });
    return () => controller.abort();
  }, [gate, isNew, modelsRefreshKey, persistReviewer, setNewSessionModel]);

  return {
    modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, newSessionModel,
    thinkingLevel, setThinkingLevel, planMode, planExecutionMode, planModeStatus,
    buddyMode, buddyReviewerModel, displayModel,
    handlePlanModeChange, handleBuddyModeChange, handleBuddyReviewerChange,
    handleModelChange, handleThinkingLevelChange, applyPreferenceState, persistModes,
  };
}
