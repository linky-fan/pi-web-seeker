import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  BrowserActionResult,
  BrowserApproval,
  BrowserApprovalDecision,
  BrowserEvent,
  BrowserPolicy,
  BrowserPolicyMode,
  BrowserRuntimeStatus,
  BrowserSessionState,
} from "../../lib/browser-types";

const GLOBAL_KEY = "__piWebOpenCliRuntime";
const MAX_EVENTS = 80;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 60_000;
const APPROVAL_TIMEOUT_MS = 5 * 60_000;
const STATUS_CACHE_MS = 10_000;
const SNAPSHOT_INTERVAL_MS = 2_500;
const SENSITIVE_ACTION_PATTERN = /(?:submit|send|publish|post|delete|remove|purchase|buy|checkout|order|confirm|approve|download|pay|transfer|sign\s*up|unsubscribe|提交|发送|发布|删除|移除|购买|下单|确认|批准|下载|支付|转账|注册|退订)/i;
const CREDENTIAL_PATTERN = /(?:password|passwd|passcode|otp|one.?time|verification|captcha|cvv|cvc|card.?number|credit.?card|payment|密码|验证码|动态码|银行卡|卡号|支付)/i;

export interface OpenCliCommand {
  category: "navigate" | "observe" | "interact" | "session" | "ui";
  action: string;
  url?: string;
  target?: string;
  value?: string;
  source?: "dom" | "ax";
  direction?: "up" | "down";
  amount?: number;
  timeoutMs?: number;
  intent?: "safe" | "sensitive";
}

interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  foreground?: boolean;
  maxOutputBytes?: number;
  onSpawn?: (child: ChildProcess) => void;
}

interface RunResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface PendingApproval {
  approval: BrowserApproval;
  resolve: (allowed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface InternalSession {
  state: BrowserSessionState;
  previewPath?: string;
  listeners: Set<(event: BrowserEvent) => void>;
  pendingApprovals: Map<string, PendingApproval>;
  eventSequence: number;
  snapshotBusy: boolean;
  currentProcess?: ChildProcess;
}

interface PersistedPolicy {
  trustedOrigins?: unknown;
}

interface RuntimeGlobal {
  sessions: Map<string, InternalSession>;
  trustedOrigins: Set<string>;
  statusCache?: { at: number; value: BrowserRuntimeStatus };
}

declare global {
  // The runtime intentionally survives Next.js hot reloads.
  var __piWebOpenCliRuntime: RuntimeGlobal | undefined;
}

function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function policyPath(): string {
  return join(agentDir(), "browser-policy.json");
}

function exactOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function loadTrustedOrigins(): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(policyPath(), "utf8")) as PersistedPolicy;
    const values = Array.isArray(parsed.trustedOrigins) ? parsed.trustedOrigins : [];
    return new Set(values.filter((value): value is string => typeof value === "string" && exactOrigin(value) === value));
  } catch {
    return new Set();
  }
}

function runtimeGlobal(): RuntimeGlobal {
  if (!globalThis[GLOBAL_KEY]) {
    globalThis[GLOBAL_KEY] = {
      sessions: new Map(),
      trustedOrigins: loadTrustedOrigins(),
    };
  }
  return globalThis[GLOBAL_KEY];
}

function persistTrustedOrigins(values: Set<string>): void {
  const file = policyPath();
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ trustedOrigins: Array.from(values).sort() }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

function opencliBinary(): string {
  return process.env.PI_WEB_OPENCLI_BIN?.trim() || "opencli";
}

function opencliSessionName(agentSessionId: string): string {
  return `pi-web-${createHash("sha256").update(agentSessionId).digest("hex").slice(0, 16)}`;
}

function safeText(value: unknown, max = 160): string {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function parseOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        // Continue to the preceding line.
      }
    }
    return trimmed;
  }
}

function terminateChild(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 500);
  timer.unref?.();
}

function redactValue(message: string, value: string | undefined): string {
  if (!value || value.length < 2) return message;
  return message.split(value).join("[redacted]");
}

async function runOpenCli(args: string[], options: RunOptions = {}): Promise<RunResult> {
  const startedAt = Date.now();
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? COMMAND_TIMEOUT_MS, 500), 5 * 60_000);
  const maxOutputBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES;

  return new Promise<RunResult>((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    const child = spawn(opencliBinary(), args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NO_COLOR: "1",
        ...(options.foreground ? { OPENCLI_WINDOW: "foreground" } : {}),
      },
    });
    options.onSpawn?.(child);

    const finish = (error?: Error, code?: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      const result = {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - startedAt,
      };
      if (error) reject(error);
      else if (code !== 0) reject(new Error(result.stderr || result.stdout || `OpenCLI exited with code ${code}`));
      else resolve(result);
    };

    const append = (current: string, chunk: Buffer): string => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        terminateChild(child);
        finish(new Error(`OpenCLI output exceeded ${maxOutputBytes} bytes`));
      }
      return current + chunk.toString("utf8");
    };

    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(undefined, code));

    const onAbort = () => {
      terminateChild(child);
      finish(new Error("OpenCLI command aborted"));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const timeout = setTimeout(() => {
      terminateChild(child);
      finish(new Error(`OpenCLI command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timeout.unref?.();
  });
}

function publicPolicy(session: InternalSession): BrowserPolicy {
  return {
    mode: session.state.policy.mode,
    trustedOrigins: Array.from(runtimeGlobal().trustedOrigins).sort(),
  };
}

function createSession(agentSessionId: string): InternalSession {
  const state: BrowserSessionState = {
    agentSessionId,
    opencliSession: opencliSessionName(agentSessionId),
    status: "idle",
    url: "",
    title: "",
    previewRevision: 0,
    previewAvailable: false,
    policy: { mode: "confirm-sensitive", trustedOrigins: Array.from(runtimeGlobal().trustedOrigins).sort() },
    updatedAt: Date.now(),
    events: [],
  };
  return {
    state,
    listeners: new Set(),
    pendingApprovals: new Map(),
    eventSequence: 0,
    snapshotBusy: false,
  };
}

function internalSession(agentSessionId: string): InternalSession {
  const global = runtimeGlobal();
  let session = global.sessions.get(agentSessionId);
  if (!session) {
    session = createSession(agentSessionId);
    global.sessions.set(agentSessionId, session);
  }
  session.state.policy = publicPolicy(session);
  return session;
}

function emit(session: InternalSession, event: Omit<BrowserEvent, "id" | "timestamp">): BrowserEvent {
  const complete: BrowserEvent = {
    ...event,
    id: ++session.eventSequence,
    timestamp: Date.now(),
  };
  session.state.events = [...session.state.events, complete].slice(-MAX_EVENTS);
  session.state.updatedAt = complete.timestamp;
  for (const listener of session.listeners) listener(complete);
  return complete;
}

function cloneState(session: InternalSession): BrowserSessionState {
  return {
    ...session.state,
    policy: publicPolicy(session),
    events: [...session.state.events],
    pendingApproval: session.state.pendingApproval ? { ...session.state.pendingApproval } : undefined,
  };
}

function validateWebUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// browser URLs are allowed");
  }
  if (url.username || url.password) throw new Error("Credentials are not allowed in browser URLs");
  return url.toString();
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 10_000) throw new Error(`${label} is too long`);
  return normalized;
}

function boundedTimeout(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) throw new Error("timeoutMs must be a number");
  return Math.min(Math.max(Math.round(value), 500), 300_000);
}

function commandArgs(sessionName: string, command: OpenCliCommand): string[] {
  const base = ["browser", sessionName];
  switch (`${command.category}:${command.action}`) {
    case "navigate:open":
      return [...base, "open", validateWebUrl(required(command.url, "url"))];
    case "navigate:back":
      return [...base, "back"];
    case "navigate:tab_new":
      return command.url ? [...base, "tab", "new", validateWebUrl(command.url)] : [...base, "tab", "new"];
    case "navigate:tab_select":
      return [...base, "tab", "select", required(command.target, "target")];
    case "observe:state":
      return command.source === "ax" ? [...base, "state", "--source", "ax"] : [...base, "state"];
    case "observe:find":
      return [...base, "find", "--css", required(command.target, "target")];
    case "observe:extract":
      return command.target ? [...base, "extract", "--selector", command.target, "--chunk-size", "12000"] : [...base, "extract", "--chunk-size", "12000"];
    case "observe:get_title":
      return [...base, "get", "title"];
    case "observe:get_url":
      return [...base, "get", "url"];
    case "interact:click":
      return [...base, "click", required(command.target, "target")];
    case "interact:type":
      return [...base, "type", required(command.target, "target"), required(command.value, "value")];
    case "interact:fill":
      return [...base, "fill", required(command.target, "target"), required(command.value, "value")];
    case "interact:select":
      return [...base, "select", required(command.target, "target"), required(command.value, "value")];
    case "interact:keys":
      return [...base, "keys", required(command.value, "value")];
    case "interact:scroll": {
      const args = [...base, "scroll", command.direction === "up" ? "up" : "down"];
      if (command.amount !== undefined) args.push("--amount", String(Math.min(Math.max(Math.round(command.amount), 1), 10_000)));
      return args;
    }
    case "interact:wait_selector":
      return [...base, "wait", "selector", required(command.target, "target"), "--timeout", String(boundedTimeout(command.timeoutMs) ?? 10_000)];
    case "interact:wait_text":
      return [...base, "wait", "text", required(command.target, "target"), "--timeout", String(boundedTimeout(command.timeoutMs) ?? 10_000)];
    case "session:bind":
      return [...base, "bind"];
    case "session:unbind":
      return [...base, "unbind"];
    case "session:list":
      return [...base, "tab", "list"];
    case "session:close":
      return [...base, "close"];
    default:
      throw new Error(`Unsupported OpenCLI browser action: ${command.category}:${command.action}`);
  }
}

async function targetMetadata(session: InternalSession, target: string, signal?: AbortSignal): Promise<{ text: string; attributes: string }> {
  const base = ["browser", session.state.opencliSession];
  const [textResult, attrResult] = await Promise.allSettled([
    runOpenCli([...base, "get", "text", target], { signal, timeoutMs: 8_000, maxOutputBytes: 64 * 1024 }),
    runOpenCli([...base, "get", "attributes", target], { signal, timeoutMs: 8_000, maxOutputBytes: 64 * 1024 }),
  ]);
  return {
    text: textResult.status === "fulfilled" ? safeText(parseOutput(textResult.value.stdout), 500) : "",
    attributes: attrResult.status === "fulfilled" ? safeText(parseOutput(attrResult.value.stdout), 1000) : "",
  };
}

async function classifyCommand(session: InternalSession, command: OpenCliCommand, signal?: AbortSignal): Promise<{ sensitive: boolean; summary: string; origin: string }> {
  const origin = exactOrigin(session.state.url) || "";
  if (command.intent === "sensitive") {
    return { sensitive: true, summary: `${command.action} ${safeText(command.target)}`.trim(), origin };
  }
  if (command.category !== "interact") return { sensitive: false, summary: command.action, origin };

  if (command.action === "type" || command.action === "fill" || command.action === "select") {
    const target = required(command.target, "target");
    const metadata = await targetMetadata(session, target, signal);
    if (!metadata.text && !metadata.attributes) {
      throw new Error("OpenCLI could not inspect this form field; use manual browser takeover before entering text");
    }
    if (CREDENTIAL_PATTERN.test(`${target} ${metadata.text} ${metadata.attributes}`)) {
      throw new Error("Credentials, payment details, verification codes, and CAPTCHA input require manual browser takeover");
    }
    return { sensitive: false, summary: `${command.action} ${safeText(target)}`, origin };
  }

  if (command.action === "keys") {
    const key = required(command.value, "value");
    return { sensitive: /^enter$/i.test(key), summary: `press ${safeText(key)}`, origin };
  }

  if (command.action === "click") {
    const target = required(command.target, "target");
    const metadata = await targetMetadata(session, target, signal);
    const combined = `${target} ${metadata.text} ${metadata.attributes}`;
    const ambiguous = !metadata.text && !metadata.attributes;
    return {
      sensitive: ambiguous || SENSITIVE_ACTION_PATTERN.test(combined) || /type["':=\s]+submit/i.test(metadata.attributes),
      summary: `click ${safeText(metadata.text || target)}`,
      origin,
    };
  }

  return { sensitive: false, summary: command.action, origin };
}

async function requestApproval(session: InternalSession, action: string, origin: string, target: string | undefined, summary: string, signal?: AbortSignal): Promise<void> {
  const approval: BrowserApproval = {
    id: randomUUID(),
    action,
    origin: origin || "unknown",
    target,
    summary,
    createdAt: Date.now(),
  };
  session.state.status = "waiting-approval";
  session.state.pendingApproval = approval;
  emit(session, { type: "approval_required", action, target, summary, approval });

  const allowed = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      session.pendingApprovals.delete(approval.id);
      resolve(false);
    }, APPROVAL_TIMEOUT_MS);
    timer.unref?.();
    session.pendingApprovals.set(approval.id, { approval, resolve, timer });
    if (signal) {
      const onAbort = () => {
        const pending = session.pendingApprovals.get(approval.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        session.pendingApprovals.delete(approval.id);
        resolve(false);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });

  session.state.pendingApproval = undefined;
  session.state.status = "running";
  if (!allowed) throw new Error("Browser action was not approved");
}

async function refreshMetadata(session: InternalSession, signal?: AbortSignal): Promise<void> {
  const base = ["browser", session.state.opencliSession];
  const [urlResult, titleResult, tabsResult] = await Promise.allSettled([
    runOpenCli([...base, "get", "url"], { signal, timeoutMs: 8_000, maxOutputBytes: 64 * 1024 }),
    runOpenCli([...base, "get", "title"], { signal, timeoutMs: 8_000, maxOutputBytes: 64 * 1024 }),
    runOpenCli([...base, "tab", "list"], { signal, timeoutMs: 8_000, maxOutputBytes: 128 * 1024 }),
  ]);
  if (urlResult.status === "fulfilled") session.state.url = safeText(parseOutput(urlResult.value.stdout), 4096);
  if (titleResult.status === "fulfilled") session.state.title = safeText(parseOutput(titleResult.value.stdout), 512);
  if (tabsResult.status === "fulfilled") {
    const tabs = parseOutput(tabsResult.value.stdout);
    if (Array.isArray(tabs)) {
      const active = tabs.find((entry) => entry && typeof entry === "object" && (entry as { active?: unknown }).active === true) as { page?: unknown } | undefined;
      if (typeof active?.page === "string") session.state.targetId = active.page;
    }
  }
}

async function captureSnapshot(session: InternalSession, signal?: AbortSignal): Promise<void> {
  if (session.snapshotBusy || session.state.status === "closed") return;
  session.snapshotBusy = true;
  const dir = join(tmpdir(), "pi-web-opencli", session.state.opencliSession);
  const nextPath = join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}.png`);
  try {
    mkdirSync(dir, { recursive: true });
    await runOpenCli(["browser", session.state.opencliSession, "screenshot", nextPath], {
      signal,
      timeoutMs: 15_000,
      maxOutputBytes: 128 * 1024,
    });
    if (!existsSync(nextPath) || !statSync(nextPath).isFile()) throw new Error("OpenCLI did not create a screenshot");
    if (statSync(nextPath).size > MAX_SNAPSHOT_BYTES) {
      unlinkSync(nextPath);
      throw new Error(`OpenCLI screenshot exceeded ${MAX_SNAPSHOT_BYTES} bytes`);
    }
    const previous = session.previewPath;
    session.previewPath = nextPath;
    session.state.previewAvailable = true;
    session.state.previewRevision += 1;
    emit(session, { type: "snapshot", revision: session.state.previewRevision });
    if (previous && previous !== nextPath) {
      try { unlinkSync(previous); } catch { /* Ignore stale temporary files. */ }
    }
  } finally {
    session.snapshotBusy = false;
  }
}

function shouldBypassApproval(session: InternalSession, origin: string): boolean {
  return session.state.policy.mode === "full-auto" || (Boolean(origin) && runtimeGlobal().trustedOrigins.has(origin));
}

export class OpenCliRuntime {
  getSession(agentSessionId: string): BrowserSessionState {
    return cloneState(internalSession(agentSessionId));
  }

  getPreviewPath(agentSessionId: string): string | null {
    const session = internalSession(agentSessionId);
    return session.previewPath && existsSync(session.previewPath) ? session.previewPath : null;
  }

  subscribe(agentSessionId: string, listener: (event: BrowserEvent) => void): () => void {
    const session = internalSession(agentSessionId);
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  async status(force = false): Promise<BrowserRuntimeStatus> {
    const global = runtimeGlobal();
    if (!force && global.statusCache && Date.now() - global.statusCache.at < STATUS_CACHE_MS) return global.statusCache.value;
    const binary = opencliBinary();
    const docker = existsSync("/.dockerenv") || process.env.PI_WEB_SINGLE_WORKSPACE === "1";
    let value: BrowserRuntimeStatus;
    try {
      const version = await runOpenCli(["--version"], { timeoutMs: 5_000, maxOutputBytes: 32 * 1024 });
      try {
        const doctor = await runOpenCli(["doctor"], { timeoutMs: 15_000, maxOutputBytes: 256 * 1024 });
        let profileOk = true;
        let profileOutput = "";
        try {
          const profile = await runOpenCli(["profile", "list"], { timeoutMs: 10_000, maxOutputBytes: 128 * 1024 });
          profileOutput = safeText(profile.stdout || profile.stderr, 2000);
        } catch (error) {
          profileOk = false;
          profileOutput = error instanceof Error ? error.message : String(error);
        }
        value = {
          available: true,
          binary,
          version: safeText(version.stdout, 120),
          doctorOk: true,
          doctorOutput: safeText(doctor.stdout || doctor.stderr, 2000),
          profileOk,
          profileOutput,
          docker,
          localOnly: true,
          installCommand: "npm install -g @jackwener/opencli",
        };
      } catch (error) {
        value = {
          available: true,
          binary,
          version: safeText(version.stdout, 120),
          doctorOk: false,
          doctorOutput: error instanceof Error ? error.message : String(error),
          docker,
          localOnly: true,
          installCommand: "npm install -g @jackwener/opencli",
        };
      }
    } catch (error) {
      value = {
        available: false,
        binary,
        doctorOk: false,
        error: error instanceof Error ? error.message : String(error),
        docker,
        localOnly: true,
        installCommand: "npm install -g @jackwener/opencli",
      };
    }
    global.statusCache = { at: Date.now(), value };
    return value;
  }

  async execute(agentSessionId: string, command: OpenCliCommand, options: { signal?: AbortSignal; source?: "agent" | "ui" } = {}): Promise<BrowserActionResult> {
    const session = internalSession(agentSessionId);
    if (session.state.status === "paused" && !["resume", "close"].includes(command.action)) {
      throw new Error("Browser automation is paused for manual takeover");
    }
    if (
      session.state.status === "running" &&
      options.source === "ui" &&
      !(command.category === "ui" && (command.action === "pause" || command.action === "takeover"))
    ) {
      throw new Error("A browser action is already running");
    }

    if (command.category === "ui") {
      if (command.action === "refresh") {
        await refreshMetadata(session, options.signal);
        await captureSnapshot(session, options.signal);
        return { action: "refresh", ok: true, durationMs: 0, url: session.state.url, title: session.state.title };
      }
      if (command.action === "pause" || command.action === "takeover") {
        if (session.currentProcess) terminateChild(session.currentProcess);
        session.state.status = "paused";
        emit(session, { type: "paused", paused: true, summary: command.action === "takeover" ? "Manual takeover" : "Paused" });
        if (command.action === "takeover" && session.state.targetId) {
          await runOpenCli(["browser", session.state.opencliSession, "tab", "select", session.state.targetId], { foreground: true, timeoutMs: 10_000 }).catch(() => {});
        }
        return { action: command.action, ok: true, durationMs: 0 };
      }
      if (command.action === "resume") {
        session.state.status = "idle";
        emit(session, { type: "paused", paused: false, summary: "Resumed" });
        return { action: "resume", ok: true, durationMs: 0 };
      }
      throw new Error(`Unsupported browser UI action: ${command.action}`);
    }

    const actionName = `${command.category}:${command.action}`;
    const startedAt = Date.now();
    session.state.status = "running";
    session.state.lastError = undefined;
    emit(session, { type: "action_start", action: actionName, target: command.target, summary: actionName });

    let snapshotTimer: ReturnType<typeof setInterval> | undefined;
    try {
      const classification = await classifyCommand(session, command, options.signal);
      if (classification.sensitive && !shouldBypassApproval(session, classification.origin)) {
        await requestApproval(session, actionName, classification.origin, command.target, classification.summary, options.signal);
      }

      snapshotTimer = setInterval(() => {
        void captureSnapshot(session).catch(() => {});
      }, SNAPSHOT_INTERVAL_MS);
      snapshotTimer.unref?.();

      const args = commandArgs(session.state.opencliSession, command);
      const run = await runOpenCli(args, {
        signal: options.signal,
        timeoutMs: boundedTimeout(command.timeoutMs),
        onSpawn: (child) => { session.currentProcess = child; },
      });
      const output = parseOutput(run.stdout);
      await refreshMetadata(session, options.signal).catch(() => {});
      if (command.action !== "close") await captureSnapshot(session, options.signal).catch(() => {});
      const result: BrowserActionResult = {
        action: actionName,
        ok: true,
        output,
        durationMs: Date.now() - startedAt,
        url: session.state.url,
        title: session.state.title,
        targetId: session.state.targetId,
      };
      session.state.status = command.action === "close" ? "closed" : "idle";
      emit(session, {
        type: command.action === "close" ? "closed" : "action_done",
        action: actionName,
        target: command.target,
        summary: command.category === "interact" ? classification.summary : safeText(output) || actionName,
        durationMs: result.durationMs,
        result: { ...result, output: undefined },
      });
      if (command.action === "close") this.cleanupPreview(session);
      return result;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = command.category === "interact" ? redactValue(rawMessage, command.value) : rawMessage;
      session.state.status = (session.state.status as string) === "paused" ? "paused" : "error";
      session.state.lastError = message;
      const result: BrowserActionResult = { action: actionName, ok: false, error: message, durationMs: Date.now() - startedAt };
      emit(session, { type: "error", action: actionName, target: command.target, error: message, summary: message, result });
      throw error;
    } finally {
      if (snapshotTimer) clearInterval(snapshotTimer);
      session.currentProcess = undefined;
    }
  }

  resolveApproval(agentSessionId: string, approvalId: string, decision: BrowserApprovalDecision): boolean {
    const session = internalSession(agentSessionId);
    const pending = session.pendingApprovals.get(approvalId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    session.pendingApprovals.delete(approvalId);
    if (decision === "allow_origin") {
      const origin = exactOrigin(pending.approval.origin);
      if (origin) {
        runtimeGlobal().trustedOrigins.add(origin);
        persistTrustedOrigins(runtimeGlobal().trustedOrigins);
        session.state.policy = publicPolicy(session);
        emit(session, { type: "policy_changed", policy: publicPolicy(session), summary: `Trusted ${origin}` });
      }
    }
    pending.resolve(decision !== "deny");
    return true;
  }

  setPolicy(agentSessionId: string, update: { mode?: BrowserPolicyMode; origin?: string; trusted?: boolean }): BrowserPolicy {
    const session = internalSession(agentSessionId);
    if (update.mode) session.state.policy.mode = update.mode;
    if (update.origin !== undefined) {
      const origin = exactOrigin(update.origin);
      if (!origin || origin !== update.origin) throw new Error("A precise http(s) origin is required");
      if (update.trusted) runtimeGlobal().trustedOrigins.add(origin);
      else runtimeGlobal().trustedOrigins.delete(origin);
      persistTrustedOrigins(runtimeGlobal().trustedOrigins);
    }
    session.state.policy = publicPolicy(session);
    emit(session, { type: "policy_changed", policy: publicPolicy(session), summary: "Browser policy updated" });
    return publicPolicy(session);
  }

  async close(agentSessionId: string): Promise<void> {
    const session = internalSession(agentSessionId);
    if (session.currentProcess) terminateChild(session.currentProcess);
    try {
      await runOpenCli(["browser", session.state.opencliSession, "close"], { timeoutMs: 10_000, maxOutputBytes: 128 * 1024 });
    } catch {
      // Closing is idempotent; still clear local state if OpenCLI is unavailable.
    }
    for (const pending of session.pendingApprovals.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    session.pendingApprovals.clear();
    session.state.pendingApproval = undefined;
    session.state.policy.mode = "confirm-sensitive";
    session.state.status = "closed";
    this.cleanupPreview(session);
    emit(session, { type: "closed", summary: "Browser session closed" });
  }

  private cleanupPreview(session: InternalSession): void {
    if (session.previewPath) {
      try { unlinkSync(session.previewPath); } catch { /* Ignore missing temporary files. */ }
    }
    session.previewPath = undefined;
    session.state.previewAvailable = false;
  }
}

export function getOpenCliRuntime(): OpenCliRuntime {
  return new OpenCliRuntime();
}
