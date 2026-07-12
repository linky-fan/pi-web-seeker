import { existsSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type ExtensionCommandContextActions,
  type ExtensionUIDialogOptions,
  type ExtensionUIContext,
  type ExtensionWidgetOptions,
} from "@earendil-works/pi-coding-agent";
import { cacheSessionPath, invalidateSessionListCache } from "./session-reader";
import type { AgentSessionLike, ToolInfo } from "./pi-types";
import type { ExtensionUiRequest, ExtensionUiResponse } from "./types";
import {
  getPlanModeStatus,
  isSafePlanBashCommand,
  buildBuddySystemPrompt,
  PLAN_MODE_SUBAGENT_SYSTEM_PROMPT,
  PLAN_MODE_SYSTEM_PROMPT,
  PLAN_SUBAGENT_OPTIONAL_TOOLS,
  PLAN_SUBAGENT_REQUIRED_TOOLS,
  type BuddyMode,
  type ModelRef,
  type PlanExecutionMode,
  type PlanModeStatus,
} from "./plan-mode";
import {
  BUILTIN_CODING_TOOL_NAMES,
  BUILTIN_CODING_TOOL_SET,
  filterKnownToolNames,
  getLoadedExtensionToolNames,
  readActiveTools,
  uniqueToolNames,
} from "./tool-settings";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;

interface PendingGuide {
  message: string;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
}

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionStatusItem = {
  key: string;
  text: string;
};

type ExtensionWidgetItem = {
  key: string;
  lines: string[];
  placement?: "aboveEditor" | "belowEditor";
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type ExtensionBindingOptions = {
  forceEmptySystemPrompt?: boolean;
};

interface ToolCallHookContext {
  toolCall: { id?: string; name?: string };
  args: unknown;
}

interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
}

type BeforeToolCallHook = (
  context: ToolCallHookContext,
  signal?: AbortSignal
) => Promise<BeforeToolCallResult | undefined>;

interface AgentWithToolHooks {
  beforeToolCall?: BeforeToolCallHook;
}

interface AgentSessionPlanAccess extends AgentSessionLike {
  _baseSystemPrompt?: string;
}

interface PlanModeSnapshot {
  activeToolNames: string[];
  baseSystemPrompt: string | undefined;
  stateSystemPrompt: string | undefined;
}

const MAX_FOREGROUND_TIMEOUT_SECONDS = 300;
const LONG_TASK_TIMEOUT_SECONDS = 120;
const RPC_SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const PLAN_MODE_MAIN_TOOL_NAMES = ["read", "bash", "grep", "find", "ls"];
const PLAN_MODE_SUBAGENT_TOOL_NAMES = [
  ...PLAN_SUBAGENT_REQUIRED_TOOLS,
  ...PLAN_SUBAGENT_OPTIONAL_TOOLS,
];

function getRuntimeOsLabel(): string {
  switch (process.platform) {
    case "darwin":
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return process.platform;
  }
}

function getShellLabel(): string {
  return process.env.SHELL || process.env.ComSpec || "unknown";
}

function getPackageManagerSignals(cwd: string): string {
  const signals = [
    ["npm", "package-lock.json"],
    ["bun", "bun.lock"],
    ["pnpm", "pnpm-lock.yaml"],
    ["yarn", "yarn.lock"],
  ]
    .filter(([, lockfile]) => existsSync(join(cwd, lockfile)))
    .map(([name, lockfile]) => `${name} (${lockfile})`);

  return signals.length > 0 ? signals.join(", ") : "none detected";
}

function getPathStyleGuidance(): string {
  if (process.platform !== "win32") return "POSIX (/)";

  return [
    "Windows: many APIs and modern tools accept both / and \\",
    "prefer \\ for cmd.exe and PowerShell-native commands",
    "prefer / for POSIX-like shells such as Git Bash, MSYS, or WSL",
  ].join("; ");
}

function buildSubagentsGuidance(): string[] {
  return [
    "",
    "Subagents guidance:",
    "- If subagent tools such as `Agent`, `get_subagent_result`, or `steer_subagent` are available, use them only when the task is complex or uncertain enough to benefit from parallel work.",
    "- Good fits: large codebase exploration, cross-module changes, design tradeoff analysis, risk review, complex debugging, or investigation before implementation.",
    "- Poor fits: simple questions, single-file edits, direct command requests, small obvious fixes, or any task where the user asks you not to use subagents.",
    "- By default, start at most two background subagents. Useful pairings include Explore + Plan, Implement + Review, or Debug + Review.",
    "- Give each subagent a narrow, concrete prompt with clear boundaries. Default subagent work to read-only unless the user explicitly asked for implementation.",
    "- The main agent owns the final answer and any file edits: collect subagent results, resolve conflicts, and summarize the decision before concluding.",
  ];
}

function buildRuntimeSystemPrompt(cwd: string): string {
  return [
    "Runtime context:",
    `- OS: ${getRuntimeOsLabel()} (${process.platform})`,
    `- Shell: ${getShellLabel()}`,
    `- Working directory: ${cwd.replace(/\\/g, "/")}`,
    `- Path style: ${getPathStyleGuidance()}`,
    `- Package manager signals: ${getPackageManagerSignals(cwd)}`,
    "",
    "Execution guidance:",
    "- Prefer commands compatible with the current OS and shell.",
    "- When path separators or shell syntax may differ across platforms, prefer the active shell's convention and inspect before assuming.",
    "- Prefer existing package scripts before inventing direct framework commands.",
    "- File lookup scope: when a file is requested by a bare name, only check the current working directory itself. Do not run recursive or global searches such as `find`, `rg --files`, or `Get-ChildItem -Recurse` to locate it.",
    "- Only read/search outside the current directory level when the user provides a complete path, either absolute or explicitly relative from the working directory (for example `./components/AppShell.tsx` or `components/AppShell.tsx`).",
    "- Long-running commands must stay observable and recoverable. Do not run downloads, renders, transcodes, builds, test suites, model jobs, or other slow tasks as one foreground command with a very large timeout.",
    "- For tasks expected to take more than 120 seconds, use a job-style loop: start the task in the background, write logs to a known file, print the PID and log path, then poll with short commands that inspect process status, recent logs, and output file size.",
    "- For large or unreliable downloads, prefer resumable commands such as `curl -L -C -` or tool-specific resume flags. Use short time windows and repeat progress checks instead of waiting silently for completion.",
    "- For video or audio rendering, first render a small sample or still frame to estimate duration. Run the full render as a background job with a log file, then check progress periodically with short `tail`, `ps`, `ls`, or tool-specific status commands.",
    "- Keep individual bash timeouts modest unless the user explicitly asks to block. Prefer 10-60 seconds for status checks and avoid timeouts over 300 seconds for a single foreground command.",
    "- Do not print secrets from environment variables, auth files, or local config.",
    ...buildSubagentsGuidance(),
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberFromUnknown(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function isBackgroundJobCommand(command: string): boolean {
  return /\b(nohup|setsid|disown)\b/i.test(command) ||
    /\bStart-Process\b/i.test(command) ||
    /(^|\s)&\s*(?:[#;]|$)/.test(command) ||
    />\s*[^&\n]+\s*2>&1\s*&/i.test(command);
}

function isLikelyLongRunningCommand(command: string): boolean {
  return /\b(remotion\s+render|ffmpeg|ffprobe|curl|wget|aria2c|yt-dlp)\b/i.test(command);
}

function hasShortDownloadLimit(command: string): boolean {
  return /\b(--max-time|-m|--timeout|--connect-timeout|--speed-time)\b/i.test(command);
}

function longRunningToolBlockReason(command: string, timeout?: number): string | null {
  if (isBackgroundJobCommand(command)) return null;

  const longTask = isLikelyLongRunningCommand(command);
  if (timeout !== undefined && timeout > MAX_FOREGROUND_TIMEOUT_SECONDS) {
    return [
      `Blocked by Pi Web long-running tool guard: this foreground bash command requested timeout=${timeout}s.`,
      "",
      "Do not wait for slow downloads, renders, transcodes, builds, or tests in one foreground tool call.",
      "Use a job-style loop instead:",
      "1. Start the task in the background.",
      "2. Redirect output to a known log file.",
      "3. Print the PID and log path.",
      "4. Poll with short commands that inspect process status, recent logs, and output file size.",
      "",
      "For downloads, use resumable options such as `curl -L -C -` plus short `--max-time` windows.",
      "For video/audio renders, render a small sample first, then run the full render as a background job and poll the log.",
    ].join("\n");
  }

  if (longTask && (timeout === undefined || timeout > LONG_TASK_TIMEOUT_SECONDS)) {
    const downloadHint = /\b(curl|wget|aria2c)\b/i.test(command) && !hasShortDownloadLimit(command)
      ? "\nFor this download, add resume and short-window options, for example `curl -L -C - --max-time 60 -o <file> <url>`."
      : "";
    return [
      "Blocked by Pi Web long-running tool guard: this looks like a long-running foreground task.",
      "",
      `Use a timeout of ${LONG_TASK_TIMEOUT_SECONDS}s or less for foreground checks, or start it as a background job with a log file and poll progress.${downloadHint}`,
    ].join("\n");
  }

  return null;
}

type WorkflowGuardState = {
  planExecutionMode: PlanExecutionMode | null;
  buddyMode: BuddyMode;
  reviewerModel: ModelRef | null;
  mainModel: ModelRef | null;
  buddyReviewCalls: number;
};

function modelRefKey(model: ModelRef): string {
  return `${model.provider}/${model.modelId}`;
}

function modelRefsEqual(a: ModelRef | null, b: ModelRef | null): boolean {
  if (!a || !b) return a === b;
  return a.provider === b.provider && a.modelId === b.modelId;
}

function installToolGuards(
  session: AgentSessionLike,
  getWorkflowState: () => WorkflowGuardState,
  recordBuddyReviewCall: () => void,
): void {
  const agent = session.agent as AgentWithToolHooks;
  const existingBeforeToolCall = agent.beforeToolCall?.bind(agent);
  agent.beforeToolCall = async (context, signal) => {
    const existingResult = await existingBeforeToolCall?.(context, signal);
    if (existingResult?.block) return existingResult;
    const toolName = context.toolCall.name ?? "";
    const workflow = getWorkflowState();
    const planBlockReason = planModeToolBlockReason(workflow.planExecutionMode, workflow.buddyMode, toolName, context.args);
    if (planBlockReason) return { block: true, reason: planBlockReason };
    const buddyBlockReason = buddyToolBlockReason(workflow, toolName, context.args);
    if (buddyBlockReason) return { block: true, reason: buddyBlockReason };
    if (workflow.buddyMode !== "off" && toolName === "Agent") recordBuddyReviewCall();
    if (toolName !== "bash" || !isRecord(context.args)) return existingResult;

    const command = typeof context.args.command === "string" ? context.args.command : "";
    if (!command.trim()) return existingResult;

    const timeout = numberFromUnknown(context.args.timeout);
    const reason = longRunningToolBlockReason(command, timeout);
    if (!reason) return existingResult;

    return { block: true, reason };
  };
}

function planModeToolBlockReason(planExecutionMode: PlanExecutionMode | null, buddyMode: BuddyMode, toolName: string, args: unknown): string | null {
  if (!planExecutionMode) return null;
  const allowedToolNames = planExecutionMode === "subagent"
    ? PLAN_MODE_SUBAGENT_TOOL_NAMES
    : buddyMode === "plan"
      ? uniqueToolNames([...PLAN_MODE_MAIN_TOOL_NAMES, ...PLAN_MODE_SUBAGENT_TOOL_NAMES])
      : PLAN_MODE_MAIN_TOOL_NAMES;
  if (!allowedToolNames.includes(toolName)) {
    return [
      "Blocked by Pi Web Plan Mode: this mode is read-only.",
      "",
      `Tool "${toolName}" is not available while planning.`,
      "Switch back to Normal mode before asking the agent to make changes.",
    ].join("\n");
  }
  if (toolName !== "bash") return null;
  if (!isRecord(args)) {
    return "Blocked by Pi Web Plan Mode: bash arguments were not readable.";
  }
  const command = typeof args.command === "string" ? args.command : "";
  if (isSafePlanBashCommand(command)) return null;
  return [
    "Blocked by Pi Web Plan Mode: bash is limited to read-only inspection commands.",
    "",
    "Allowed examples: rg, sed -n, cat, ls, pwd, git status/log/diff/show, npm list/view, node --version.",
    `Command: ${command}`,
  ].join("\n");
}

function buddyToolBlockReason(workflow: WorkflowGuardState, toolName: string, args: unknown): string | null {
  if (workflow.buddyMode === "off" || toolName !== "Agent") return null;
  if (!workflow.reviewerModel || !workflow.mainModel) return "Blocked by Pi Web Buddy Mode: reviewer or main model is unavailable.";
  if (!isRecord(args)) return "Blocked by Pi Web Buddy Mode: Agent arguments were not readable.";
  if (workflow.buddyReviewCalls >= 1) return "Blocked by Pi Web Buddy Mode: only one independent reviewer call is allowed per request.";

  const expectedModel = modelRefKey(workflow.reviewerModel);
  const requestedModel = typeof args.model === "string" ? args.model : "";
  if (modelRefKey(workflow.mainModel) === expectedModel) {
    return "Blocked by Pi Web Buddy Mode: the writer and reviewer models must be different.";
  }
  if (args.subagent_type !== "Plan") {
    return 'Blocked by Pi Web Buddy Mode: the reviewer must use the read-only "Plan" subagent type.';
  }
  if (requestedModel !== expectedModel) {
    return `Blocked by Pi Web Buddy Mode: reviewer model must be exactly "${expectedModel}".`;
  }
  if (args.inherit_context !== false) {
    return "Blocked by Pi Web Buddy Mode: reviewer must set inherit_context to false for an independent review.";
  }
  if (args.run_in_background !== false) {
    return "Blocked by Pi Web Buddy Mode: reviewer must set run_in_background to false so the result is reviewed before completion.";
  }
  if (args.isolated === true || args.isolation !== undefined) {
    return "Blocked by Pi Web Buddy Mode: the read-only reviewer cannot use an isolated worktree.";
  }
  return null;
}

function includeExtensionTools(requestedToolNames: string[], extensionToolNames: string[]): string[] {
  return requestedToolNames.length === 0 ? [] : uniqueToolNames([...requestedToolNames, ...extensionToolNames]);
}

function parsePlanExecutionMode(value: unknown): PlanExecutionMode | undefined {
  return value === "subagent" || value === "main" ? value : undefined;
}

function parseBuddyMode(value: unknown): BuddyMode | undefined {
  return value === "off" || value === "plan" || value === "code" ? value : undefined;
}

function parseModelRef(value: unknown): ModelRef | undefined {
  if (!isRecord(value)) return undefined;
  const provider = typeof value.provider === "string" ? value.provider.trim() : "";
  const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
  return provider && modelId ? { provider, modelId } : undefined;
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionStatuses = new Map<string, ExtensionStatusItem>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private pendingGuide: PendingGuide | null = null;
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private forceEmptySystemPrompt = false;
  private planModeEnabled = false;
  private planExecutionMode: PlanExecutionMode = "main";
  private planModeSnapshot: PlanModeSnapshot | null = null;
  private buddyMode: BuddyMode = "off";
  private buddyReviewerModel: ModelRef | null = null;
  private buddyReviewCalls = 0;
  private _alive = true;

  constructor(public readonly inner: AgentSessionLike, private readonly extensionLoadErrors: string[] = []) {}

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
  }

  isPlanModeEnabled(): boolean {
    return this.planModeEnabled;
  }

  getPlanExecutionMode(): PlanExecutionMode | null {
    return this.planModeEnabled ? this.planExecutionMode : null;
  }

  getWorkflowGuardState(): WorkflowGuardState {
    const model = this.inner.model;
    return {
      planExecutionMode: this.planModeEnabled ? this.planExecutionMode : null,
      buddyMode: this.buddyMode,
      reviewerModel: this.buddyReviewerModel,
      mainModel: model ? { provider: model.provider, modelId: model.id } : null,
      buddyReviewCalls: this.buddyReviewCalls,
    };
  }

  recordBuddyReviewCall(): void {
    this.buddyReviewCalls += 1;
  }

  getPlanModeStatus(): PlanModeStatus {
    return getPlanModeStatus(this.inner.getAllTools().map((tool) => tool.name), this.extensionLoadErrors);
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      this.resetIdleTimer();
      for (const l of this.listeners) l(event);
      if (event.type === "agent_end") {
        this.flushPendingGuideSoon();
      }
    });
    this.resetIdleTimer();
  }

  setForceEmptySystemPrompt(force: boolean): void {
    this.forceEmptySystemPrompt = force;
    this.applyForcedEmptySystemPrompt();
  }

  beginExtensionBinding(options: ExtensionBindingOptions = {}): void {
    void this.ensureExtensionsBound(options).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[pi-web] failed to dispatch session_start to extensions:", message);
      this.emit({
        type: "extension_error",
        extensionPath: "extension-runtime",
        event: "session_start",
        error: message,
      });
    });
  }

  private ensureExtensionsBound(options: ExtensionBindingOptions = {}): Promise<void> {
    if (options.forceEmptySystemPrompt) this.forceEmptySystemPrompt = true;
    if (this.extensionsBound) {
      this.applyForcedEmptySystemPrompt();
      return Promise.resolve();
    }
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        await this.inner.bindExtensions({
          uiContext,
          mode: "rpc",
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () => this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "notify",
            notifyType: "warning",
            message: "Extension requested shutdown, but shutdown is not supported in Pi Web.",
          } satisfies ExtensionUiRequest),
          onError: (error: { extensionPath: string; event: string; error: string }) => this.emit({
            type: "extension_error",
            extensionPath: error.extensionPath,
            event: error.event,
            error: error.error,
          }),
        });
      } else {
        this.inner.extensionRunner?.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      this.applyForcedEmptySystemPrompt();
    })().catch((error) => {
      this.extensionBindingError = error;
      throw error;
    });

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (this.extensionBindingPromise) await this.extensionBindingPromise;
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt" || type === "steer" || type === "follow_up";
  }

  private applyForcedEmptySystemPrompt(): void {
    if (this.forceEmptySystemPrompt && this.inner.agent.state) {
      this.inner.agent.state.systemPrompt = "";
    }
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private promptNow(guide: PendingGuide): void {
    this.inner.prompt(
      guide.message,
      guide.images?.length ? { images: guide.images } : undefined
    ).catch(() => {});
  }

  private flushPendingGuideSoon(): void {
    const guide = this.pendingGuide;
    if (!guide) return;
    this.pendingGuide = null;
    // Keep guidance as a normal visible user prompt after the aborted turn settles.
    setTimeout(() => {
      if (!this._alive) return;
      this.promptNow(guide);
    }, 0);
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.inner.isStreaming || this.inner.isCompacting) {
        this.resetIdleTimer();
        return;
      }
      this.destroy();
    }, RPC_SESSION_IDLE_TIMEOUT_MS);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    this.resetIdleTimer();
    const type = command.type as string;
    if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();

    switch (type) {
      case "set_plan_mode": {
        const executionMode = parsePlanExecutionMode(command.executionMode);
        this.setWorkflowMode(
          command.enabled === true,
          executionMode,
          parseBuddyMode(command.buddyMode),
          parseModelRef(command.buddyReviewerModel),
        );
        return {
          planMode: this.planModeEnabled,
          planExecutionMode: this.planExecutionMode,
          planModeStatus: this.getPlanModeStatus(),
          buddyMode: this.buddyMode,
          buddyReviewerModel: this.buddyReviewerModel,
        };
      }

      case "set_buddy_reviewer": {
        const reviewer = parseModelRef(command.buddyReviewerModel);
        if (!reviewer) throw new Error("Buddy reviewer model is required");
        this.assertBuddyReviewer(reviewer);
        this.buddyReviewerModel = reviewer;
        if (this.buddyMode !== "off") this.applyWorkflowSystemPrompt();
        return { buddyReviewerModel: reviewer };
      }

      case "prompt": {
        if (typeof command.planMode === "boolean") {
          this.setWorkflowMode(
            command.planMode,
            parsePlanExecutionMode(command.planExecutionMode),
            parseBuddyMode(command.buddyMode),
            parseModelRef(command.buddyReviewerModel),
          );
        }
        this.buddyReviewCalls = 0;
        // Fire and forget — events come via subscribe
        const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        this.inner.prompt(command.message as string, promptImages?.length ? { images: promptImages } : undefined).catch(() => {});
        return null;
      }

      case "abort":
        await this.inner.abort();
        return null;

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: 0,
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          systemPrompt: this.inner.agent.state?.systemPrompt ?? "",
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          planMode: this.planModeEnabled,
          planExecutionMode: this.planExecutionMode,
          planModeStatus: this.getPlanModeStatus(),
          buddyMode: this.buddyMode,
          buddyReviewerModel: this.buddyReviewerModel,
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const registry = this.inner.modelRegistry;
        const model = registry.find(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        if (this.buddyMode !== "off" && this.buddyReviewerModel && modelRefKey(this.buddyReviewerModel) === `${provider}/${modelId}`) {
          throw new Error("Buddy writer and reviewer models must be different");
        }
        await this.inner.setModel(model);
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          const newManager = SessionManager.create(sessionManager.getCwd(), sessionDir);
          newManager.newSession({ parentSession: currentSessionFile });
          newSessionFile = newManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = sourceManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        const newSessionId = SessionManager.open(newSessionFile, sessionDir).getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        invalidateSessionListCache();
        this.destroy();
        return { cancelled: false, newSessionId };
      }

      case "navigate_tree": {
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        return null;
      }

      case "compact": {
        // pi's compact() does not guard against empty messagesToSummarize — use findCutPoint
        // to pre-check and skip instead of generating a useless empty summary.
        const { findCutPoint, DEFAULT_COMPACTION_SETTINGS } = await import("@earendil-works/pi-coding-agent");
        const pathEntries = this.inner.sessionManager.getBranch() as Array<{ type: string }>;
        const settings = { ...DEFAULT_COMPACTION_SETTINGS, ...this.inner.settingsManager.getCompactionSettings() };
        let prevCompactionIndex = -1;
        for (let i = pathEntries.length - 1; i >= 0; i--) {
          if (pathEntries[i].type === "compaction") { prevCompactionIndex = i; break; }
        }
        const boundaryStart = prevCompactionIndex + 1;
        const cutPoint = findCutPoint(pathEntries as never, boundaryStart, pathEntries.length, settings.keepRecentTokens);
        const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
        if (historyEnd <= boundaryStart) {
          return { skipped: true, reason: "nothing_to_compact" };
        }
        const result = await this.inner.compact(command.customInstructions as string | undefined);
        return result;
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "steer": {
        if (typeof command.planMode === "boolean") {
          this.setWorkflowMode(command.planMode, parsePlanExecutionMode(command.planExecutionMode), parseBuddyMode(command.buddyMode), parseModelRef(command.buddyReviewerModel));
        }
        this.buddyReviewCalls = 0;
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        if (command.interrupt === true) {
          const guide = {
            message: command.message as string,
            ...(steerImages?.length ? { images: steerImages } : {}),
          };
          if (this.inner.isStreaming) {
            this.pendingGuide = guide;
            try {
              await this.inner.abort();
            } catch (error) {
              if (this.pendingGuide === guide) this.pendingGuide = null;
              throw error;
            }
            if (!this.inner.isStreaming && this.pendingGuide === guide) {
              this.flushPendingGuideSoon();
            }
          } else {
            this.promptNow(guide);
          }
          return null;
        }
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        if (typeof command.planMode === "boolean") {
          this.setWorkflowMode(command.planMode, parsePlanExecutionMode(command.planExecutionMode), parseBuddyMode(command.buddyMode), parseModelRef(command.buddyReviewerModel));
        }
        this.buddyReviewCalls = 0;
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          name: t.name,
          description: t.description,
          active: active.has(t.name),
        }));
      }

      case "set_tools": {
        const requestedToolNames = command.toolNames as string[];
        const exact = command.exact as boolean | undefined;
        const allToolNames = this.inner.getAllTools().map((tool) => tool.name);
        const knownRequestedToolNames = filterKnownToolNames(requestedToolNames, allToolNames);
        this.setForceEmptySystemPrompt(requestedToolNames.length === 0);
        if (exact) {
          this.inner.setActiveToolsByName(knownRequestedToolNames);
          this.applyForcedEmptySystemPrompt();
          return null;
        }
        const extensionToolNames = this.inner
          .getAllTools()
          .map((tool) => tool.name)
          .filter((name) => !BUILTIN_CODING_TOOL_SET.has(name));
        this.inner.setActiveToolsByName(includeExtensionTools(knownRequestedToolNames, extensionToolNames));
        this.applyForcedEmptySystemPrompt();
        return null;
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      case "extension_ui_response": {
        this.respondToExtensionUi(command as ExtensionUiResponse);
        return null;
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "reload": {
        await this.reloadExtensionsAware();
        return { success: true };
      }

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  private setWorkflowMode(enabled: boolean, executionMode?: PlanExecutionMode, buddyMode?: BuddyMode, reviewerModel?: ModelRef): void {
    const nextExecutionMode = executionMode ?? this.planExecutionMode;
    const nextBuddyMode = buddyMode ?? this.buddyMode;
    const nextReviewerModel = reviewerModel ?? this.buddyReviewerModel;
    if (enabled && nextExecutionMode === "subagent") this.assertPlanSubagentsAvailable();
    if (nextBuddyMode !== "off") {
      this.assertPlanSubagentsAvailable();
      if (!nextReviewerModel) throw new Error("Select a Buddy reviewer model before enabling Buddy Mode");
      this.assertBuddyReviewer(nextReviewerModel);
      if (nextBuddyMode === "plan" && !enabled) throw new Error("Buddy Plan requires Plan Mode");
      if (nextBuddyMode === "code" && enabled) throw new Error("Buddy Code cannot run inside read-only Plan Mode");
    }
    const wasActive = this.planModeEnabled || this.buddyMode !== "off";
    const willBeActive = enabled || nextBuddyMode !== "off";
    if (
      enabled === this.planModeEnabled &&
      nextExecutionMode === this.planExecutionMode &&
      nextBuddyMode === this.buddyMode &&
      modelRefsEqual(nextReviewerModel, this.buddyReviewerModel)
    ) return;

    if (willBeActive) {
      if (!this.planModeSnapshot) this.planModeSnapshot = this.createPlanModeSnapshot();
      this.planExecutionMode = nextExecutionMode;
      this.planModeEnabled = enabled;
      this.buddyMode = nextBuddyMode;
      this.buddyReviewerModel = nextReviewerModel;
      this.applyWorkflowTools();
      this.applyWorkflowSystemPrompt();
      return;
    }

    if (wasActive) this.restorePlanModeSnapshot();
    this.planModeEnabled = false;
    this.planExecutionMode = "main";
    this.buddyMode = "off";
    this.planModeSnapshot = null;
  }

  private createPlanModeSnapshot(): PlanModeSnapshot {
    const inner = this.inner as AgentSessionPlanAccess;
    return {
      activeToolNames: this.inner.getActiveToolNames(),
      baseSystemPrompt: inner._baseSystemPrompt,
      stateSystemPrompt: this.inner.agent.state?.systemPrompt,
    };
  }

  private applyWorkflowTools(): void {
    const allToolNames = this.inner.getAllTools().map((tool) => tool.name);
    let requested: string[];
    if (this.planModeEnabled) {
      requested = this.planExecutionMode === "subagent"
        ? PLAN_MODE_SUBAGENT_TOOL_NAMES
        : this.buddyMode === "plan"
          ? uniqueToolNames([...PLAN_MODE_MAIN_TOOL_NAMES, ...PLAN_MODE_SUBAGENT_TOOL_NAMES])
          : PLAN_MODE_MAIN_TOOL_NAMES;
    } else {
      requested = uniqueToolNames([
        ...(this.planModeSnapshot?.activeToolNames ?? this.inner.getActiveToolNames()),
        ...PLAN_MODE_SUBAGENT_TOOL_NAMES,
      ]);
    }
    this.inner.setActiveToolsByName(filterKnownToolNames(requested, allToolNames));
  }

  private applyWorkflowSystemPrompt(): void {
    const inner = this.inner as AgentSessionPlanAccess;
    const snapshot = this.planModeSnapshot ?? this.createPlanModeSnapshot();
    const base = snapshot.baseSystemPrompt ?? snapshot.stateSystemPrompt ?? "";
    const prompts: string[] = [];
    if (this.planModeEnabled) prompts.push(this.planExecutionMode === "subagent" ? PLAN_MODE_SUBAGENT_SYSTEM_PROMPT : PLAN_MODE_SYSTEM_PROMPT);
    if (this.buddyMode !== "off" && this.buddyReviewerModel) prompts.push(buildBuddySystemPrompt(this.buddyMode, this.buddyReviewerModel));
    const next = `${base}\n\n${prompts.join("\n\n")}`.trim();
    inner._baseSystemPrompt = next;
    if (this.inner.agent.state) this.inner.agent.state.systemPrompt = next;
  }

  private restorePlanModeSnapshot(): void {
    const snapshot = this.planModeSnapshot;
    if (!snapshot) return;
    const inner = this.inner as AgentSessionPlanAccess;
    const allToolNames = this.inner.getAllTools().map((tool) => tool.name);
    this.inner.setActiveToolsByName(filterKnownToolNames(snapshot.activeToolNames, allToolNames));
    inner._baseSystemPrompt = snapshot.baseSystemPrompt;
    if (this.inner.agent.state) this.inner.agent.state.systemPrompt = snapshot.stateSystemPrompt ?? "";
  }

  private assertPlanSubagentsAvailable(): void {
    const status = this.getPlanModeStatus();
    if (status.subagentsAvailable) return;
    throw new Error([
      "Plan via Subagent is not available for this session.",
      status.missingTools.length ? `Missing tools: ${status.missingTools.join(", ")}` : "",
      `Install: ${status.installCommand}`,
    ].filter(Boolean).join("\n"));
  }

  private assertBuddyReviewer(reviewer: ModelRef): void {
    const model = this.inner.modelRegistry.find(reviewer.provider, reviewer.modelId);
    if (!model) throw new Error(`Buddy reviewer model not found: ${modelRefKey(reviewer)}`);
    const registry = this.inner.modelRegistry as typeof this.inner.modelRegistry & {
      getAvailable?: () => Array<{ provider: string; id: string }>;
    };
    const available = registry.getAvailable?.().some((candidate) => (
      candidate.provider === reviewer.provider && candidate.id === reviewer.modelId
    )) ?? true;
    if (!available) throw new Error(`Buddy reviewer model is not authenticated: ${modelRefKey(reviewer)}`);
    const main = this.inner.model;
    if (main && main.provider === reviewer.provider && main.id === reviewer.modelId) {
      throw new Error("Buddy writer and reviewer models must be different");
    }
  }

  private respondToExtensionUi(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    pending?.resolve(response);
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    signal?: AbortSignal,
  ): Promise<T> {
    const id = randomUUID();
    const timeout = typeof request.timeout === "number" && Number.isFinite(request.timeout)
      ? Math.max(0, request.timeout)
      : undefined;
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...(timeout !== undefined ? { expiresAt: Date.now() + timeout } : {}),
      ...request,
    } as ExtensionUiRequest;

    return new Promise<T>((resolve) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiResponses.delete(id);
      };
      const settle = (value: T) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const onAbort = () => settle(defaultValue);

      if (timeout !== undefined) timeoutId = setTimeout(() => settle(defaultValue), timeout);
      signal?.addEventListener("abort", onAbort, { once: true });

      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return 92;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return 92;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(40, Math.min(140, Math.round(width)))
      : 92;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [`Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const event = {
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    } satisfies ExtensionUiRequest;
    this.pendingUiRequests.set(id, event as AgentEvent);
    this.emit(event as AgentEvent);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    try {
      custom.component.dispose?.();
    } catch {
      // Extension UI cleanup should not prevent session cleanup.
    }
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } satisfies ExtensionUiRequest);
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(factory: unknown, options?: unknown): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve) => {
      const tui = {
        requestRender: () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
      };
      const done = (value: T) => this.closeCustomUi(id, value);

      Promise.resolve()
        .then(() => factory(tui, undefined, undefined, done))
        .then((component) => {
          if (!component || typeof component !== "object" || typeof (component as CustomUiComponent).render !== "function") {
            resolve(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => resolve(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          resolve(undefined as T);
        });
    });
  }

  private createExtensionUiContext(): ExtensionUIContext {
    const notify = (message: string, type: "info" | "warning" | "error" = "info") => {
      this.emit({
        type: "extension_ui_request",
        id: randomUUID(),
        method: "notify",
        message,
        notifyType: type,
      } satisfies ExtensionUiRequest);
    };

    return {
      select: (title: string, options: string[], opts?: ExtensionUIDialogOptions) => this.requestExtensionUi<string | undefined>(
        { method: "select", title, options, timeout: opts?.timeout },
        undefined,
        (response) => response.cancelled ? undefined : typeof response.value === "string" ? response.value : undefined,
        opts?.signal,
      ),
      confirm: (title: string, message: string, opts?: ExtensionUIDialogOptions) => this.requestExtensionUi<boolean>(
        { method: "confirm", title, message, timeout: opts?.timeout },
        false,
        (response) => response.cancelled ? false : response.confirmed === true,
        opts?.signal,
      ),
      input: (title: string, placeholder?: string, opts?: ExtensionUIDialogOptions) => this.requestExtensionUi<string | undefined>(
        { method: "input", title, ...(placeholder ? { placeholder } : {}), timeout: opts?.timeout },
        undefined,
        (response) => response.cancelled ? undefined : typeof response.value === "string" ? response.value : undefined,
        opts?.signal,
      ),
      notify,
      onTerminalInput: () => () => {},
      setStatus: (key: string, text: string | undefined) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, { key, text });
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          ...(text !== undefined ? { statusText: text } : {}),
        } satisfies ExtensionUiRequest);
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key: string, content: string[] | ((...args: unknown[]) => unknown) | undefined, options?: ExtensionWidgetOptions) => {
        if (Array.isArray(content) && content.length > 0) {
          this.extensionWidgets.set(key, { key, lines: content, placement: options?.placement });
        } else {
          this.extensionWidgets.delete(key);
        }
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          ...(Array.isArray(content) ? { widgetLines: content } : {}),
          ...(options?.placement ? { placement: options.placement } : {}),
        } satisfies ExtensionUiRequest);
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title: string) => this.emit({
        type: "extension_ui_request",
        id: randomUUID(),
        method: "setTitle",
        title,
      } satisfies ExtensionUiRequest),
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text: string) => this.emit({
        type: "extension_ui_request",
        id: randomUUID(),
        method: "set_editor_text",
        text,
      } satisfies ExtensionUiRequest),
      setEditorText: (text: string) => this.emit({
        type: "extension_ui_request",
        id: randomUUID(),
        method: "set_editor_text",
        text,
      } satisfies ExtensionUiRequest),
      getEditorText: () => "",
      editor: (title: string, prefill?: string) => this.requestExtensionUi<string | undefined>(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}) },
        undefined,
        (response) => response.cancelled ? undefined : typeof response.value === "string" ? response.value : undefined,
      ),
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      theme: undefined,
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Themes are not supported in Pi Web RPC sessions." }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    } as unknown as ExtensionUIContext;
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActions {
    return {
      waitForIdle: async () => {
        await this.inner.agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        await this.reloadExtensionsAware();
      },
    } as ExtensionCommandContextActions;
  }

  private async reloadExtensionsAware(): Promise<void> {
    await this.waitForExtensionsBound();
    this.extensionStatuses.clear();
    this.extensionWidgets.clear();
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();

    if (this.inner.reload) {
      await this.inner.reload({
        beforeSessionStart: () => {
          if (typeof this.inner.bindExtensions !== "function") {
            this.inner.extensionRunner?.setUIContext?.(this.createExtensionUiContext(), "rpc");
          }
        },
      });
    } else if (typeof this.inner.bindExtensions !== "function") {
      this.inner.extensionRunner?.setUIContext?.(this.createExtensionUiContext(), "rpc");
    }
    this.applyForcedEmptySystemPrompt();
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    this.pendingGuide = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribe?.();
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.inner.dispose?.();
    this.onDestroyCallback?.();
  }
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const cleanup = () => globalThis.__piSessions?.forEach((s) => s.destroy());
    process.once("exit", cleanup);
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  }
  return globalThis.__piSessions;
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * Pass toolNames to pre-configure active tools (empty array = all tools disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[]
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const starting = (async () => {
    const { SessionManager, getAgentDir } = await import("@earendil-works/pi-coding-agent");
    const agentDir = getAgentDir();

    const sessionManager = sessionFile
      ? SessionManager.open(sessionFile, undefined)
      : SessionManager.create(cwd, undefined);

    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      appendSystemPromptOverride: (base) => [...base, buildRuntimeSystemPrompt(cwd)],
    });
    await resourceLoader.reload();
    const extensionLoadErrors = resourceLoader.getExtensions().errors.map((error: unknown) => {
      if (isRecord(error)) {
        const path = typeof error.path === "string" ? error.path : "";
        const message = typeof error.error === "string" ? error.error : JSON.stringify(error);
        return path ? `${path}: ${message}` : message;
      }
      return String(error);
    });

    const savedActiveTools = toolNames === undefined ? readActiveTools(agentDir) : null;

    // Determine which tools to register separately from which tools are active.
    // Since v0.68.0, createAgentSession expects string[] tool names instead of Tool[] instances.
    // Keep extension tools registered so enabled packages such as pi-subagents are visible
    // even when the saved activeTools list disables some or all extension tools.
    const extensionToolNames = getLoadedExtensionToolNames(resourceLoader);
    const registeredToolNames = uniqueToolNames([...BUILTIN_CODING_TOOL_NAMES, ...extensionToolNames]);
    let toolsOption: string[] | undefined;
    if (toolNames !== undefined) {
      // Register tools even when the requested active set is empty, then clear it below.
      // Passing tools: [] makes pi create a session with no tool registry, so later
      // switching back to Low/High cannot restore tools without recreating the session.
      toolsOption = registeredToolNames;
    } else if (savedActiveTools !== null) {
      toolsOption = registeredToolNames;
    }

    const { session: inner } = await createAgentSession({
      cwd,
      agentDir,
      sessionManager,
      resourceLoader,
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
    });

    // Empty activeTools means all tools off, but available tools stay registered.
    let appliedActiveToolNames: string[] | undefined;
    if (toolNames !== undefined) {
      appliedActiveToolNames = includeExtensionTools(filterKnownToolNames(toolNames, registeredToolNames), extensionToolNames);
      inner.setActiveToolsByName(appliedActiveToolNames);
    } else if (savedActiveTools !== null) {
      appliedActiveToolNames = filterKnownToolNames(savedActiveTools, registeredToolNames);
      inner.setActiveToolsByName(appliedActiveToolNames);
    }

    // When all tools are disabled, clear the system prompt entirely.
    // pi's buildSystemPrompt always produces a non-empty prompt even with no tools;
    // keep this forced after extension resource discovery and reloads as well.
    const wrapper = new AgentSessionWrapper(inner, extensionLoadErrors);
    if (appliedActiveToolNames?.length === 0) {
      wrapper.setForceEmptySystemPrompt(true);
    }
    installToolGuards(inner, () => wrapper.getWorkflowGuardState(), () => wrapper.recordBuddyReviewCall());
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) {
      cacheSessionPath(realSessionId, realSessionFile);
      invalidateSessionListCache();
    }

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);
    wrapper.beginExtensionBinding({ forceEmptySystemPrompt: appliedActiveToolNames?.length === 0 });

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
