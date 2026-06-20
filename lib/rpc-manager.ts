import { existsSync } from "fs";
import { join } from "path";
import { createAgentSession, DefaultResourceLoader, SessionManager } from "@earendil-works/pi-coding-agent";
import { cacheSessionPath, invalidateSessionListCache } from "./session-reader";
import type { AgentSessionLike, ToolInfo } from "./pi-types";
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

const MAX_FOREGROUND_TIMEOUT_SECONDS = 300;
const LONG_TASK_TIMEOUT_SECONDS = 120;

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

function installLongRunningToolGuard(session: AgentSessionLike): void {
  const agent = session.agent as AgentWithToolHooks;
  const existingBeforeToolCall = agent.beforeToolCall?.bind(agent);
  agent.beforeToolCall = async (context, signal) => {
    const existingResult = await existingBeforeToolCall?.(context, signal);
    if (existingResult?.block) return existingResult;
    if (context.toolCall.name !== "bash" || !isRecord(context.args)) return existingResult;

    const command = typeof context.args.command === "string" ? context.args.command : "";
    if (!command.trim()) return existingResult;

    const timeout = numberFromUnknown(context.args.timeout);
    const reason = longRunningToolBlockReason(command, timeout);
    if (!reason) return existingResult;

    return { block: true, reason };
  };
}

function includeExtensionTools(requestedToolNames: string[], extensionToolNames: string[]): string[] {
  return requestedToolNames.length === 0 ? [] : uniqueToolNames([...requestedToolNames, ...extensionToolNames]);
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  private listeners: EventListener[] = [];
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private pendingGuide: PendingGuide | null = null;
  private _alive = true;

  constructor(public readonly inner: AgentSessionLike) {}

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  isAlive(): boolean {
    return this._alive;
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
    this.idleTimer = setTimeout(() => this.destroy(), 10 * 60 * 1000);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.push(listener);
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

    switch (type) {
      case "prompt": {
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
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        const registry = this.inner.modelRegistry;
        const model = registry.find(provider, modelId);
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
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
        if (exact) {
          this.inner.setActiveToolsByName(knownRequestedToolNames);
          if (knownRequestedToolNames.length === 0 && this.inner.agent.state) this.inner.agent.state.systemPrompt = "";
          return null;
        }
        const extensionToolNames = this.inner
          .getAllTools()
          .map((tool) => tool.name)
          .filter((name) => !BUILTIN_CODING_TOOL_SET.has(name));
        this.inner.setActiveToolsByName(includeExtensionTools(knownRequestedToolNames, extensionToolNames));
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

      default:
        throw new Error(`Unsupported command: ${type}`);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    this.pendingGuide = null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.unsubscribe?.();
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
    // the only way to truly clear it is to call agent.setSystemPrompt directly.
    if (appliedActiveToolNames?.length === 0) {
      inner.agent.state.systemPrompt = "";
    }

    await inner.bindExtensions?.({ mode: "rpc" });
    installLongRunningToolGuard(inner);

    const wrapper = new AgentSessionWrapper(inner);
    wrapper.start();

    const realSessionId = inner.sessionId as string;
    const realSessionFile = inner.sessionFile as string | undefined;
    if (realSessionFile) {
      cacheSessionPath(realSessionId, realSessionFile);
      invalidateSessionListCache();
    }

    wrapper.onDestroy(() => registry.delete(realSessionId));
    registry.set(realSessionId, wrapper);

    return { session: wrapper, realSessionId };
  })().finally(() => locks.delete(sessionId));

  locks.set(sessionId, starting);
  return starting;
}
