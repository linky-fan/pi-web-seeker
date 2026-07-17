import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Client, type ClientChannel, type ConnectConfig, type HostVerifier } from "ssh2";
import { Telnet } from "telnet-client";
import iconv from "iconv-lite";
import { findRemoteProfile, getKnownHostFingerprint, listRemoteProfiles, resolveRemoteKeyPath, trustHostFingerprint } from "../../lib/remote-store";
import { exportRemoteCapture, inspectRemoteCaptureExport, listRemoteCaptures, readRemoteCapture, saveRemoteCapture, searchRemoteCapture } from "../../lib/remote-captures";
import { detectRemoteHostType, isSensitiveRemoteCommand, sanitizeRemoteTerminalOutput, stripTerminalControls } from "../../lib/remote-security";
import type {
  RemoteApproval,
  RemoteApprovalDecision,
  RemoteCaptureSummary,
  RemoteCommandResult,
  RemoteConnectionState,
  RemoteCredentials,
  RemoteEvent,
  RemoteHostType,
  RemotePolicyMode,
  RemoteProfile,
} from "../../lib/remote-types";

const GLOBAL_KEY = "__piWebRemoteRuntime";
const APPROVAL_TIMEOUT_MS = 5 * 60_000;
const MAX_TERMINAL_EVENT_BYTES = 128 * 1024;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const SHELL_TAIL_CHARS = 8_192;

type CommandOutput = { output: string; exitCode?: number; byteCount: number; truncated: boolean };

interface PendingApproval {
  approval: RemoteApproval;
  resolve: (decision: RemoteApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
  abort?: () => void;
}

interface PendingShellCommand {
  command: string;
  output: BoundedOutputCollector;
  rawTail: string;
  pagerWaiting: boolean;
  startedAt: number;
  resolve: (value: CommandOutput) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  prompt: RegExp;
  pager?: RegExp;
}

interface InternalSession {
  state: RemoteConnectionState;
  listeners: Set<(event: RemoteEvent) => void>;
  eventSequence: number;
  pendingApprovals: Map<string, PendingApproval>;
  ssh?: Client;
  shell?: ClientChannel;
  telnet?: Telnet;
  profile?: RemoteProfile;
  pendingShell?: PendingShellCommand;
  abortController?: AbortController;
  activeControllers: Set<AbortController>;
  generation: number;
  secretRedactor?: SecretRedactor;
  suppressTerminalOutput?: boolean;
}

interface RuntimeGlobal { sessions: Map<string, InternalSession>; exitHookInstalled: boolean }

declare global {
  var __piWebRemoteRuntime: RuntimeGlobal | undefined;
}

function runtimeGlobal(): RuntimeGlobal {
  if (!globalThis[GLOBAL_KEY]) globalThis[GLOBAL_KEY] = { sessions: new Map(), exitHookInstalled: false };
  const runtime = globalThis[GLOBAL_KEY];
  if (!runtime.exitHookInstalled) {
    runtime.exitHookInstalled = true;
    const cleanup = () => {
      for (const session of runtime.sessions.values()) {
        abortActiveOperations(session);
        finishShellCommand(session, new Error("Remote service is shutting down"));
        denyPendingApprovals(session);
        try { session.shell?.destroy(); } catch { /* Process is already exiting. */ }
        try { session.ssh?.destroy(); } catch { /* Process is already exiting. */ }
        try { void session.telnet?.destroy(); } catch { /* Process is already exiting. */ }
      }
      runtime.sessions.clear();
    };
    process.once("exit", cleanup);
  }
  return runtime;
}

function publicState(session: InternalSession): RemoteConnectionState {
  return { ...session.state, captures: [...session.state.captures] };
}

function idleState(agentSessionId: string): RemoteConnectionState {
  return {
    agentSessionId,
    status: "idle",
    controlMode: "agent",
    policyMode: "confirm-sensitive",
    updatedAt: Date.now(),
    captures: listRemoteCaptures(agentSessionId),
  };
}

function internalSession(agentSessionId: string): InternalSession {
  let session = runtimeGlobal().sessions.get(agentSessionId);
  if (!session) {
    session = {
      state: idleState(agentSessionId),
      listeners: new Set(),
      eventSequence: 0,
      pendingApprovals: new Map(),
      activeControllers: new Set(),
      generation: 0,
    };
    runtimeGlobal().sessions.set(agentSessionId, session);
  }
  return session;
}

function emit(session: InternalSession, value: Omit<RemoteEvent, "id" | "timestamp">): void {
  const event: RemoteEvent = { ...value, id: ++session.eventSequence, timestamp: Date.now() };
  session.state.updatedAt = Date.now();
  for (const listener of session.listeners) listener(event);
}

function emitState(session: InternalSession, summary?: string): void {
  emit(session, { type: "state", summary, state: publicState(session) });
}

function redactSecrets(value: string, secrets: readonly string[] = []): string {
  let safe = value;
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    safe = safe.split(secret).join("[redacted]");
  }
  return safe;
}

class SecretRedactor {
  private carry = "";
  private readonly secrets: string[];

  constructor(secrets: readonly string[]) {
    this.secrets = Array.from(new Set(secrets.filter((secret) => secret.length > 0))).sort((a, b) => b.length - a.length);
  }

  redact(chunk: string): string {
    if (!this.secrets.length || !chunk) return chunk;
    const combined = `${this.carry}${chunk}`;
    let offset = 0;
    let output = "";
    while (offset < combined.length) {
      const match = this.secrets.find((secret) => combined.startsWith(secret, offset));
      if (match) {
        output += "[redacted]";
        offset += match.length;
        continue;
      }
      const remainder = combined.slice(offset);
      if (this.secrets.some((secret) => secret.startsWith(remainder))) break;
      output += combined[offset];
      offset += 1;
    }
    this.carry = combined.slice(offset);
    return output;
  }

  flush(): string {
    // Do not disclose an unfinished suffix that could be part of a password
    // echoed by a legacy Telnet device just before it disconnects.
    const result = this.carry ? "[redacted]" : "";
    this.carry = "";
    return result;
  }
}

/** Pure helper used by offline regression tests for chunk-boundary redaction. */
export function redactRemoteTextChunks(chunks: readonly string[], secrets: readonly string[]): string {
  const redactor = new SecretRedactor(secrets);
  return `${chunks.map((chunk) => redactor.redact(chunk)).join("")}${redactor.flush()}`;
}

function safeError(error: unknown, secrets: readonly string[] = []): string {
  const message = redactSecrets(error instanceof Error ? error.message : String(error), secrets);
  if (/authentication|all configured authentication methods failed/i.test(message)) return "Remote authentication failed";
  if (/timed?\s*out|timeout/i.test(message)) return "Remote connection timed out";
  if (/ECONNREFUSED/i.test(message)) return "Remote connection was refused";
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return "Remote host could not be resolved";
  return message.replace(/password|passphrase/gi, "credential").slice(0, 500);
}

function isCurrentGeneration(session: InternalSession, generation: number): boolean {
  return session.generation === generation;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function promptPattern(profile: RemoteProfile): RegExp {
  if (profile.promptText) return new RegExp(`(?:^|\\n)[^\\r\\n]*${escapeRegex(profile.promptText)}\\s*$`, "m");
  if (profile.promptPreset === "windows") return /(?:^|\n)[^\r\n]*>\s*$/m;
  if (profile.promptPreset === "cisco" || profile.promptPreset === "network") return /(?:^|\n)[^\r\n]*[>#]\s*$/m;
  return /(?:^|\n)[^\r\n]*[$#]\s*$/m;
}

function pagerPattern(profile: RemoteProfile): RegExp | undefined {
  if (profile.pagerText) return new RegExp(escapeRegex(profile.pagerText), "m");
  if (profile.promptPreset === "cisco" || profile.promptPreset === "network") return /(?:--More--|---- More ----|<--- More --->)/m;
  return undefined;
}

function telnetPromptPattern(value: string | undefined, fallback: RegExp): RegExp {
  return value ? new RegExp(`${escapeRegex(value)}\\s*$`, "mi") : fallback;
}

function denyPendingApprovals(session: InternalSession): void {
  for (const pending of session.pendingApprovals.values()) {
    clearTimeout(pending.timer);
    pending.abort?.();
    pending.resolve("deny");
  }
  session.pendingApprovals.clear();
  session.state.pendingApproval = undefined;
}

function abortActiveOperations(session: InternalSession): void {
  for (const controller of session.activeControllers) controller.abort();
  session.abortController?.abort();
}

function abortError(): Error {
  return new Error("Remote operation aborted");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function utf8Prefix(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) low = middle;
    else high = middle - 1;
  }
  if (low > 0 && /[\uD800-\uDBFF]/.test(value[low - 1])) low -= 1;
  return value.slice(0, low);
}

class BoundedOutputCollector {
  private chunks: string[] = [];
  private storedBytes = 0;
  byteCount = 0;
  truncated = false;

  append(text: string, receivedBytes = Buffer.byteLength(text, "utf8")): void {
    this.byteCount += receivedBytes;
    const remaining = MAX_COMMAND_OUTPUT_BYTES - this.storedBytes;
    if (remaining <= 0) {
      if (text) this.truncated = true;
      return;
    }
    const prefix = utf8Prefix(text, remaining);
    if (prefix) {
      this.chunks.push(prefix);
      this.storedBytes += Buffer.byteLength(prefix, "utf8");
    }
    if (prefix.length !== text.length) this.truncated = true;
  }

  result(exitCode?: number): CommandOutput {
    return { output: this.chunks.join(""), exitCode, byteCount: this.byteCount, truncated: this.truncated };
  }
}

function lineEnding(profile: RemoteProfile): string {
  return profile.lineEnding === "crlf" ? "\r\n" : "\n";
}

function terminalOutput(session: InternalSession, text: string, receivedBytes?: number, generation?: number): string {
  if (generation !== undefined && !isCurrentGeneration(session, generation)) return "";
  const redacted = session.secretRedactor?.redact(text) ?? text;
  if (session.suppressTerminalOutput) return "";
  const safeTerminalText = sanitizeRemoteTerminalOutput(redacted);
  const eventText = Buffer.byteLength(safeTerminalText, "utf8") > MAX_TERMINAL_EVENT_BYTES
    ? utf8Prefix(safeTerminalText, MAX_TERMINAL_EVENT_BYTES)
    : safeTerminalText;
  emit(session, { type: "output", text: eventText });
  const pending = session.pendingShell;
  if (!pending) return redacted;
  pending.output.append(redacted, receivedBytes);
  pending.rawTail = `${pending.rawTail}${redacted}`.slice(-SHELL_TAIL_CHARS);
  const cleanTail = stripTerminalControls(pending.rawTail);
  if (pending.pager && pending.pager.test(cleanTail)) {
    pending.pager.lastIndex = 0;
    if (!pending.pagerWaiting) {
      pending.pagerWaiting = true;
      session.shell?.write(session.profile?.pagerContinue || " ");
      pending.rawTail = "";
    }
  } else {
    pending.pagerWaiting = false;
  }
  pending.prompt.lastIndex = 0;
  if (pending.prompt.test(cleanTail)) finishShellCommand(session, undefined);
  return redacted;
}

function finishShellCommand(session: InternalSession, error?: Error): void {
  const pending = session.pendingShell;
  if (!pending) return;
  clearTimeout(pending.timer);
  session.pendingShell = undefined;
  if (error) pending.reject(error);
  else pending.resolve(pending.output.result());
}

function requestApproval(
  session: InternalSession,
  approval: Omit<RemoteApproval, "id" | "createdAt">,
  signal?: AbortSignal,
  resumeStatus: RemoteConnectionState["status"] = session.profile ? "connected" : "idle",
): Promise<RemoteApprovalDecision> {
  throwIfAborted(signal);
  if (session.pendingApprovals.size) throw new Error("Another remote approval is already pending");
  const full: RemoteApproval = { ...approval, id: randomUUID(), createdAt: Date.now() };
  session.state.pendingApproval = full;
  session.state.status = "waiting-approval";
  emit(session, { type: "approval_required", approval: full, summary: full.summary });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (decision: RemoteApprovalDecision) => {
      if (settled) return;
      settled = true;
      const pending = session.pendingApprovals.get(full.id);
      if (pending) clearTimeout(pending.timer);
      session.pendingApprovals.delete(full.id);
      signal?.removeEventListener("abort", abort);
      if (session.state.pendingApproval?.id === full.id) session.state.pendingApproval = undefined;
      if (session.state.status === "waiting-approval") session.state.status = resumeStatus;
      resolve(decision);
      emitState(session, decision === "deny" ? "Remote approval closed" : "Remote approval granted");
    };
    const abort = () => finish("deny");
    const timer = setTimeout(() => {
      finish("deny");
    }, APPROVAL_TIMEOUT_MS);
    timer.unref?.();
    session.pendingApprovals.set(full.id, { approval: full, resolve: finish, timer, abort });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function verifyHostKey(session: InternalSession, profile: RemoteProfile, key: Buffer, generation: number, signal?: AbortSignal): Promise<boolean> {
  if (!isCurrentGeneration(session, generation)) return false;
  const fingerprint = `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
  const known = getKnownHostFingerprint(profile);
  if (known && known !== fingerprint) {
    session.state.lastError = "SSH host key changed; connection blocked";
    emit(session, { type: "error", summary: session.state.lastError });
    return false;
  }
  if (known === fingerprint) return true;
  const decision = await requestApproval(session, {
    kind: "host-key",
    title: "Trust SSH host key",
    summary: `${profile.name} (${profile.host}:${profile.port}) presented ${fingerprint}`,
    fingerprint,
  }, signal, "connecting");
  throwIfAborted(signal);
  if (!isCurrentGeneration(session, generation)) return false;
  if (decision === "trust") trustHostFingerprint(profile, fingerprint);
  return decision === "trust" || decision === "allow_once";
}

function sshConfig(session: InternalSession, profile: RemoteProfile, credentials: RemoteCredentials, generation: number, signal?: AbortSignal): ConnectConfig {
  const config: ConnectConfig = {
    host: profile.host.replace(/^\[|\]$/g, ""),
    port: profile.port,
    username: profile.username,
    readyTimeout: profile.timeoutMs,
    keepaliveInterval: 15_000,
    keepaliveCountMax: 3,
    hostVerifier: ((key, callback) => { void verifyHostKey(session, profile, key, generation, signal).then(callback, () => callback(false)); }) satisfies HostVerifier,
  };
  if (profile.authMethod === "password") {
    if (!credentials.password) throw new Error("Password must be entered in the Remote panel");
    config.password = credentials.password;
  } else if (profile.authMethod === "agent") {
    if (!process.env.SSH_AUTH_SOCK) throw new Error("SSH agent is unavailable");
    config.agent = process.env.SSH_AUTH_SOCK;
  } else {
    const keyPath = profile.keyPath ? resolveRemoteKeyPath(profile.keyPath) : undefined;
    if (!keyPath || !existsSync(keyPath)) throw new Error("SSH private key was not found");
    try { config.privateKey = readFileSync(keyPath); }
    catch { throw new Error("SSH private key could not be read"); }
    if (credentials.passphrase) config.passphrase = credentials.passphrase;
  }
  return config;
}

async function connectSsh(session: InternalSession, profile: RemoteProfile, credentials: RemoteCredentials, generation: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  const client = new Client();
  session.ssh = client;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error); else resolve();
    };
    const abort = () => {
      try { client.destroy(); } catch { /* Best effort cancellation. */ }
      finish(abortError());
    };
    client.once("ready", () => finish());
    client.on("error", (error) => {
      if (!settled) {
        finish(error);
        return;
      }
      if (!isCurrentGeneration(session, generation) || session.state.status === "closed" || session.state.status === "error") return;
      session.state.status = "error";
      session.state.lastError = session.state.lastError === "SSH host key changed; connection blocked" ? session.state.lastError : safeError(error, session.secretRedactor ? credentials.password ? [credentials.password] : credentials.passphrase ? [credentials.passphrase] : [] : []);
      emit(session, { type: "error", summary: session.state.lastError });
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    client.connect(sshConfig(session, profile, credentials, generation, signal));
  });
  throwIfAborted(signal);
  const shell = await new Promise<ClientChannel>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, channel?: ClientChannel) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(channel!);
    };
    const abort = () => {
      try { client.destroy(); } catch { /* Best effort cancellation. */ }
      finish(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    client.shell({ term: "xterm-256color", cols: 120, rows: 32 }, (error, channel) => error ? finish(error) : finish(undefined, channel));
  });
  session.shell = shell;
  const shellDecoder = iconv.getDecoder(profile.encoding);
  const shellErrorDecoder = iconv.getDecoder(profile.encoding);
  shell.on("data", (data: Buffer) => terminalOutput(session, shellDecoder.write(data), data.length, generation));
  shell.stderr.on("data", (data: Buffer) => terminalOutput(session, shellErrorDecoder.write(data), data.length, generation));
  shell.on("close", () => {
    if (!isCurrentGeneration(session, generation)) return;
    const stdoutTail = shellDecoder.end();
    const stderrTail = shellErrorDecoder.end();
    if (stdoutTail) terminalOutput(session, stdoutTail, 0, generation);
    if (stderrTail) terminalOutput(session, stderrTail, 0, generation);
    const secretTail = session.secretRedactor?.flush() ?? "";
    if (secretTail) terminalOutput(session, secretTail, 0, generation);
    finishShellCommand(session, new Error("Remote shell closed"));
    if (session.state.status !== "closed" && session.state.status !== "error") {
      session.state.status = "closed";
      emit(session, { type: "closed", summary: "Remote shell closed" });
    }
  });
}

async function connectTelnet(session: InternalSession, profile: RemoteProfile, credentials: RemoteCredentials, generation: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (!credentials.password) throw new Error("Password must be entered in the Remote panel");
  const decision = await requestApproval(session, {
    kind: "telnet",
    title: "Connect with Telnet",
    summary: `Telnet sends credentials and commands without encryption to ${profile.host}:${profile.port}`,
  }, signal, "connecting");
  throwIfAborted(signal);
  if (decision === "deny") throw new Error("Telnet connection denied");
  const connection = new Telnet();
  session.telnet = connection;
  session.suppressTerminalOutput = true;
  const decoder = iconv.getDecoder(profile.encoding);
  connection.on("data", (data: Buffer | string) => {
    if (!isCurrentGeneration(session, generation)) return;
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(data, "latin1");
    terminalOutput(session, decoder.write(raw), raw.length, generation);
  });
  const pager = pagerPattern(profile);
  if (pager && profile.pagerContinue !== " ") {
    let pagerWaiting = false;
    connection.once("connect", () => {
      connection.getSocket()?.on("data", (data: Buffer) => {
        if (!isCurrentGeneration(session, generation)) return;
        const tail = stripTerminalControls(iconv.decode(data, profile.encoding)).slice(-2_000);
        pager.lastIndex = 0;
        const matched = pager.test(tail);
        if (matched && !pagerWaiting) {
          pagerWaiting = true;
          connection.getSocket()?.write(profile.pagerContinue || " ");
        } else if (!matched) pagerWaiting = false;
      });
    });
  }
  connection.on("close", () => {
    if (!isCurrentGeneration(session, generation)) return;
    const tail = decoder.end();
    if (tail) terminalOutput(session, tail, 0, generation);
    const secretTail = session.secretRedactor?.flush() ?? "";
    if (secretTail) terminalOutput(session, secretTail, 0, generation);
    if (session.state.status !== "closed" && session.state.status !== "error") {
      session.state.status = "closed";
      emit(session, { type: "closed", summary: "Telnet connection closed" });
    }
  });
  connection.on("timeout", () => {
    if (isCurrentGeneration(session, generation)) emit(session, { type: "error", summary: "Telnet connection timed out" });
  });
  connection.on("error", (error: Error) => {
    if (!isCurrentGeneration(session, generation) || session.state.status === "closed" || session.state.status === "error") return;
    session.state.status = "error";
    session.state.lastError = safeError(error, credentials.password ? [credentials.password] : []);
    emit(session, { type: "error", summary: session.state.lastError });
  });
  const abort = () => { void connection.destroy().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    throwIfAborted(signal);
    await connection.connect({
    host: profile.host.replace(/^\[|\]$/g, ""),
    port: profile.port,
    username: profile.username,
    password: credentials.password,
    loginPrompt: telnetPromptPattern(profile.loginPrompt, /(?:login|username)[: ]*$/mi),
    passwordPrompt: telnetPromptPattern(profile.passwordPrompt, /password[: ]*$/mi),
    shellPrompt: promptPattern(profile),
    pageSeparator: profile.pagerContinue === " " ? pager : "__PI_WEB_CUSTOM_PAGER__",
    timeout: profile.timeoutMs,
    execTimeout: profile.timeoutMs,
    sendTimeout: profile.timeoutMs,
    maxBufferLength: 16 * 1024 * 1024,
    terminalWidth: 120,
    terminalHeight: 32,
    ors: lineEnding(profile),
    irs: lineEnding(profile),
      encoding: "latin1",
    });
    throwIfAborted(signal);
    if (!isCurrentGeneration(session, generation)) throw abortError();
    session.suppressTerminalOutput = false;
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

async function execSsh(session: InternalSession, command: string, timeoutMs: number, generation: number, signal?: AbortSignal): Promise<CommandOutput> {
  if (!session.ssh) throw new Error("SSH connection is not available");
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const output = new BoundedOutputCollector();
    let exitCode: number | undefined;
    let settled = false;
    let activeStream: ClientChannel | undefined;
    const stdoutDecoder = iconv.getDecoder(session.profile!.encoding);
    const stderrDecoder = iconv.getDecoder(session.profile!.encoding);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (!error) {
        const stdoutTail = stdoutDecoder.end();
        const stderrTail = stderrDecoder.end();
        if (stdoutTail) output.append(terminalOutput(session, stdoutTail, 0, generation), 0);
        if (stderrTail) output.append(terminalOutput(session, stderrTail, 0, generation), 0);
      }
      if (error) reject(error); else resolve(output.result(exitCode));
    };
    const abort = () => {
      activeStream?.close();
      finish(new Error("Remote command aborted"));
    };
    const timer = setTimeout(() => {
      activeStream?.close();
      finish(new Error("Remote command timed out"));
    }, timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    session.ssh!.exec(command, (error, stream) => {
      if (error) return finish(error);
      activeStream = stream;
      stream.on("data", (data: Buffer) => { const text = stdoutDecoder.write(data); output.append(terminalOutput(session, text, data.length, generation), data.length); });
      stream.stderr.on("data", (data: Buffer) => { const text = stderrDecoder.write(data); output.append(terminalOutput(session, text, data.length, generation), data.length); });
      stream.on("exit", (code?: number) => { exitCode = code; });
      stream.on("close", () => finish());
    });
  });
}

async function execShell(session: InternalSession, command: string, timeoutMs: number, generation: number, signal?: AbortSignal): Promise<CommandOutput> {
  const profile = session.profile!;
  throwIfAborted(signal);
  if (profile.protocol === "telnet") {
    if (!session.telnet) throw new Error("Telnet connection is not available");
    let aborted = signal?.aborted === true;
    const abort = () => { aborted = true; void session.telnet?.write("\x03").catch(() => {}); };
    signal?.addEventListener("abort", abort, { once: true });
    if (aborted) abort();
    try {
      const output = await session.telnet.exec(command, {
        shellPrompt: promptPattern(profile),
        execTimeout: timeoutMs,
        maxBufferLength: 16 * 1024 * 1024,
        ors: lineEnding(profile),
      });
      if (aborted) throw new Error("Remote command aborted");
      const rawOutput = String(output ?? "");
      const raw = Buffer.from(rawOutput, "latin1");
      const text = session.secretRedactor?.redact(iconv.decode(raw, profile.encoding)) ?? iconv.decode(raw, profile.encoding);
      const collected = new BoundedOutputCollector();
      collected.append(text, raw.length);
      return collected.result();
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  const shell = session.shell;
  if (!shell) throw new Error("Remote shell is not available");
  return new Promise((resolve, reject) => {
    const pending: PendingShellCommand = {
      command,
      output: new BoundedOutputCollector(),
      rawTail: "",
      pagerWaiting: false,
      startedAt: Date.now(),
      resolve,
      reject,
      prompt: promptPattern(profile),
      pager: pagerPattern(profile),
      timer: setTimeout(() => {
        session.shell?.write("\x03");
        finishShellCommand(session, new Error("Remote command timed out"));
      }, timeoutMs),
    };
    session.pendingShell = pending;
    const abort = () => {
      session.shell?.write("\x03");
      finishShellCommand(session, new Error("Remote command aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    const originalResolve = pending.resolve;
    const originalReject = pending.reject;
    pending.resolve = (value) => { signal?.removeEventListener("abort", abort); originalResolve(value); };
    pending.reject = (error) => { signal?.removeEventListener("abort", abort); originalReject(error); };
    if (signal?.aborted) return abort();
    shell.write(`${command}${lineEnding(profile)}`);
  });
}

async function runSshProbe(session: InternalSession, command: string, generation: number, signal?: AbortSignal): Promise<string> {
  const client = session.ssh;
  if (!client || !isCurrentGeneration(session, generation)) throw abortError();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let stream: ClientChannel | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(iconv.decode(Buffer.concat(chunks), session.profile?.encoding ?? "utf8"));
    };
    const append = (data: Buffer) => {
      if (bytes >= 4 * 1024) return;
      const prefix = data.subarray(0, (4 * 1024) - bytes);
      chunks.push(prefix);
      bytes += prefix.length;
    };
    const abort = () => { stream?.close(); finish(abortError()); };
    const timer = setTimeout(() => { stream?.close(); finish(new Error("Remote detection probe timed out")); }, 3_000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    client.exec(command, (error, channel) => {
      if (error) return finish(error);
      stream = channel;
      channel.on("data", append);
      channel.stderr.on("data", append);
      channel.on("close", () => finish());
    });
  });
}

async function runTelnetProbe(session: InternalSession, command: string, generation: number, signal?: AbortSignal): Promise<string> {
  const connection = session.telnet;
  const profile = session.profile;
  if (!connection || !profile || !isCurrentGeneration(session, generation)) throw abortError();
  throwIfAborted(signal);
  const previousSuppression = session.suppressTerminalOutput;
  session.suppressTerminalOutput = true;
  const abort = () => { void connection.write("\x03").catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const result = await connection.exec(command, {
      shellPrompt: promptPattern(profile),
      execTimeout: 3_000,
      maxBufferLength: 4 * 1024,
      ors: lineEnding(profile),
    });
    throwIfAborted(signal);
    if (!isCurrentGeneration(session, generation)) throw abortError();
    return iconv.decode(Buffer.from(String(result ?? ""), "latin1").subarray(0, 4 * 1024), profile.encoding);
  } finally {
    signal?.removeEventListener("abort", abort);
    if (isCurrentGeneration(session, generation)) session.suppressTerminalOutput = previousSuppression;
  }
}

async function detectConnectedHostType(session: InternalSession, generation: number, signal?: AbortSignal): Promise<RemoteHostType> {
  const detected = new Set<RemoteHostType>();
  for (const command of ["uname -s", "cmd /d /c ver", "show version"]) {
    throwIfAborted(signal);
    try {
      const output = session.profile?.protocol === "ssh"
        ? await runSshProbe(session, command, generation, signal)
        : await runTelnetProbe(session, command, generation, signal);
      const hostType = detectRemoteHostType(output);
      if (hostType !== "unknown") detected.add(hostType);
    } catch {
      if (signal?.aborted || !isCurrentGeneration(session, generation)) throw abortError();
      // Probes are advisory only. Unsupported commands and short device-side
      // timeouts leave the policy at unknown rather than failing a connection.
    }
  }
  return detected.size === 1 ? [...detected][0] : "unknown";
}

export class RemoteRuntime {
  getSession(agentSessionId: string): RemoteConnectionState {
    const session = runtimeGlobal().sessions.get(agentSessionId);
    if (!session) return idleState(agentSessionId);
    session.state.captures = listRemoteCaptures(agentSessionId);
    return publicState(session);
  }

  listProfiles(): RemoteProfile[] { return listRemoteProfiles(); }

  subscribe(agentSessionId: string, listener: (event: RemoteEvent) => void): () => void {
    const session = internalSession(agentSessionId);
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
      this.deleteIfUnused(agentSessionId, session);
    };
  }

  async connect(agentSessionId: string, profileId: string, credentials: RemoteCredentials = {}, options: { signal?: AbortSignal } = {}): Promise<RemoteConnectionState> {
    const profile = findRemoteProfile(profileId);
    if (!profile) throw new Error("Remote profile not found");
    if (profile.legacyPatternRejected) throw new Error("This target has legacy regular-expression prompts. Replace them with a preset or literal text before connecting.");
    if ((credentials.password?.length ?? 0) > 4_096 || (credentials.passphrase?.length ?? 0) > 4_096) throw new Error("Remote credential is too long");
    if (profile.authMethod === "password" && (!credentials.password || credentials.passphrase)) throw new Error("A temporary password is required for this target");
    if (profile.authMethod === "key" && credentials.password) throw new Error("This target accepts only an optional key passphrase");
    if (profile.authMethod === "agent" && (credentials.password || credentials.passphrase)) throw new Error("This target uses ssh-agent and does not accept credentials");
    throwIfAborted(options.signal);
    await this.close(agentSessionId, false);
    const session = internalSession(agentSessionId);
    const generation = ++session.generation;
    const configuredHostType = profile.deviceMode === "auto" ? undefined : profile.deviceMode as RemoteHostType;
    session.profile = profile;
    session.secretRedactor = new SecretRedactor([credentials.password ?? "", credentials.passphrase ?? ""]);
    session.suppressTerminalOutput = false;
    session.state = {
      agentSessionId,
      profileId: profile.id,
      profileName: profile.name,
      protocol: profile.protocol,
      hostType: configuredHostType,
      hostTypeSource: configuredHostType ? "configured" : "fallback",
      effectiveHostType: configuredHostType ?? "unknown",
      status: "connecting",
      controlMode: "agent",
      policyMode: "confirm-sensitive",
      updatedAt: Date.now(),
      captures: listRemoteCaptures(agentSessionId),
    };
    emitState(session, `Connecting to ${profile.name}`);
    const controller = new AbortController();
    session.abortController = controller;
    session.activeControllers.add(controller);
    const relayAbort = () => controller.abort();
    options.signal?.addEventListener("abort", relayAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    try {
      if (profile.protocol === "ssh") await connectSsh(session, profile, credentials, generation, controller.signal);
      else await connectTelnet(session, profile, credentials, generation, controller.signal);
      throwIfAborted(controller.signal);
      if (!isCurrentGeneration(session, generation)) throw abortError();
      if (profile.deviceMode === "auto") {
        const detected = await detectConnectedHostType(session, generation, controller.signal);
        if (!isCurrentGeneration(session, generation)) throw abortError();
        session.state.hostType = detected;
        session.state.hostTypeSource = detected === "unknown" ? "fallback" : "detected";
        // Detection is intentionally not authority. Commands stay in the
        // unknown policy until a person accepts this result in the Remote UI.
        session.state.effectiveHostType = "unknown";
      }
      session.state.pendingApproval = undefined;
      session.state.status = "connected";
      session.state.connectedAt = Date.now();
      emitState(session, `Connected to ${profile.name}`);
      return publicState(session);
    } catch (error) {
      if (!isCurrentGeneration(session, generation)) throw abortError();
      if (controller.signal.aborted) {
        denyPendingApprovals(session);
        await this.closeTransport(session);
        session.profile = undefined;
        session.secretRedactor = undefined;
        session.suppressTerminalOutput = false;
        session.state.pendingApproval = undefined;
        session.state.status = "closed";
        emitState(session, "Remote connection cancelled");
        this.deleteIfUnused(agentSessionId, session);
        throw abortError();
      }
      const message = session.state.lastError === "SSH host key changed; connection blocked" ? session.state.lastError : safeError(error, [credentials.password ?? "", credentials.passphrase ?? ""]);
      session.state.pendingApproval = undefined;
      session.state.status = "error";
      session.state.lastError = message;
      emit(session, { type: "error", summary: message });
      denyPendingApprovals(session);
      await this.closeTransport(session);
      session.profile = undefined;
      session.secretRedactor = undefined;
      session.suppressTerminalOutput = false;
      this.deleteIfUnused(agentSessionId, session);
      throw new Error(message);
    } finally {
      options.signal?.removeEventListener("abort", relayAbort);
      session.activeControllers.delete(controller);
      if (session.abortController === controller) session.abortController = undefined;
      this.deleteIfUnused(agentSessionId, session);
    }
  }

  async execute(agentSessionId: string, command: string, options: { intent?: "observe" | "change"; timeoutMs?: number; source?: "agent" | "command-bar"; signal?: AbortSignal } = {}): Promise<RemoteCommandResult> {
    const session = runtimeGlobal().sessions.get(agentSessionId);
    if (!session) throw new Error("Remote device is not connected");
    if (session.state.activeCommand) throw new Error("Another remote command is already running");
    const profile = session.profile;
    if (!profile || !["connected", "paused"].includes(session.state.status)) throw new Error("Remote device is not connected");
    if (session.state.controlMode === "manual") throw new Error("Remote terminal is under manual control");
    const trimmed = command.trim();
    if (!trimmed || trimmed.length > 8_192 || /\0/.test(trimmed)) throw new Error("Invalid remote command");
    const controller = new AbortController();
    const generation = session.generation;
    session.abortController = controller;
    session.activeControllers.add(controller);
    const relayAbort = () => controller.abort();
    options.signal?.addEventListener("abort", relayAbort, { once: true });
    session.state.activeCommand = trimmed;
    if (options.signal?.aborted) controller.abort();
    try {
      const sensitive = isSensitiveRemoteCommand(trimmed, options.intent, session.state.effectiveHostType ?? "unknown");
      if (sensitive && session.state.policyMode !== "full-auto") {
        const decision = await requestApproval(session, { kind: "command", title: "Approve remote command", summary: trimmed.slice(0, 500), command: trimmed }, controller.signal, "connected");
        throwIfAborted(controller.signal);
        if (!isCurrentGeneration(session, generation)) throw abortError();
        if (decision === "deny") {
          session.state.activeCommand = undefined;
          session.state.status = "connected";
          emitState(session, "Remote command denied");
          throw new Error("Remote command denied");
        }
      }
      throwIfAborted(controller.signal);
      if (!isCurrentGeneration(session, generation)) throw abortError();
      const timeoutMs = Math.max(1_000, Math.min(300_000, options.timeoutMs ?? profile.timeoutMs));
      session.state.pendingApproval = undefined;
      session.state.status = "running";
      emit(session, { type: "command_start", summary: trimmed });
      const startedAt = Date.now();
      const result = profile.protocol === "ssh" && profile.commandMode === "exec"
        ? await execSsh(session, trimmed, timeoutMs, generation, controller.signal)
        : await execShell(session, trimmed, timeoutMs, generation, controller.signal);
      if (!isCurrentGeneration(session, generation)) throw abortError();
      const capture = saveRemoteCapture({ agentSessionId, profileId: profile.id, command: trimmed, output: result.output, exitCode: result.exitCode, durationMs: Date.now() - startedAt, byteCount: result.byteCount, truncated: result.truncated });
      session.state.captures = listRemoteCaptures(agentSessionId);
      session.state.status = (session.state.controlMode as RemoteConnectionState["controlMode"]) === "manual" ? "paused" : "connected";
      session.state.activeCommand = undefined;
      emit(session, { type: "command_done", summary: trimmed, result: capture });
      return capture;
    } catch (error) {
      if (!isCurrentGeneration(session, generation)) throw abortError();
      const message = safeError(error);
      session.state.status = (session.state.controlMode as RemoteConnectionState["controlMode"]) === "manual" ? "paused" : "connected";
      session.state.activeCommand = undefined;
      if (controller.signal.aborted) emitState(session, "Remote command aborted");
      else emit(session, { type: "error", summary: message });
      throw new Error(message);
    } finally {
      options.signal?.removeEventListener("abort", relayAbort);
      session.activeControllers.delete(controller);
      if (session.abortController === controller) session.abortController = undefined;
    }
  }

  writeInput(agentSessionId: string, data: string): void {
    const session = runtimeGlobal().sessions.get(agentSessionId);
    if (!session) throw new Error("Remote device is not connected");
    if (session.state.controlMode !== "manual") throw new Error("Take manual control before sending terminal input");
    if (!data || data.length > 8_192) throw new Error("Invalid terminal input");
    if (session.profile?.protocol === "telnet") void session.telnet?.write(data).catch(() => {});
    else session.shell?.write(data);
  }

  resize(agentSessionId: string, cols: number, rows: number): void {
    const session = runtimeGlobal().sessions.get(agentSessionId);
    if (!session) return;
    const safeCols = Math.max(20, Math.min(400, Math.floor(cols)));
    const safeRows = Math.max(5, Math.min(200, Math.floor(rows)));
    session.shell?.setWindow(safeRows, safeCols, 0, 0);
  }

  takeControl(agentSessionId: string): RemoteConnectionState {
    const session = runtimeGlobal().sessions.get(agentSessionId);
    if (!session?.profile) throw new Error("Remote device is not connected");
    denyPendingApprovals(session);
    abortActiveOperations(session);
    session.state.controlMode = "manual";
    session.state.status = "paused";
    emit(session, { type: "control_changed", summary: "Manual control", state: publicState(session) });
    return publicState(session);
  }

  resumeAgent(agentSessionId: string): RemoteConnectionState {
    const session = runtimeGlobal().sessions.get(agentSessionId);
    if (!session?.profile) throw new Error("Remote device is not connected");
    session.state.controlMode = "agent";
    session.state.status = session.profile ? "connected" : "idle";
    emit(session, { type: "control_changed", summary: "Agent control", state: publicState(session) });
    return publicState(session);
  }

  acceptDetectedHostType(agentSessionId: string): RemoteConnectionState {
    const session = runtimeGlobal().sessions.get(agentSessionId);
    const detected = session?.state.hostType;
    if (!session?.profile || session.profile.deviceMode !== "auto" || session.state.hostTypeSource !== "detected" || !detected || detected === "unknown") {
      throw new Error("No detected host policy is available to apply");
    }
    session.state.effectiveHostType = detected;
    session.profile = {
      ...session.profile,
      commandMode: ["cisco", "windows", "network-generic", "custom"].includes(detected) ? "shell" : "exec",
    };
    emitState(session, `Applied ${detected} command policy for this connection`);
    return publicState(session);
  }

  setPolicy(agentSessionId: string, mode: RemotePolicyMode): RemoteConnectionState {
    const session = runtimeGlobal().sessions.get(agentSessionId);
    if (!session?.profile) throw new Error("Remote device is not connected");
    session.state.policyMode = mode;
    emitState(session, mode === "full-auto" ? "Full-auto enabled for this connection" : "Sensitive commands require approval");
    return publicState(session);
  }

  resolveApproval(agentSessionId: string, approvalId: string, decision: RemoteApprovalDecision): boolean {
    const session = runtimeGlobal().sessions.get(agentSessionId);
    if (!session) return false;
    const pending = session.pendingApprovals.get(approvalId);
    if (!pending) return false;
    if (decision === "trust" && pending.approval.kind !== "host-key") return false;
    clearTimeout(pending.timer);
    session.pendingApprovals.delete(approvalId);
    if (session.state.pendingApproval?.id === approvalId) session.state.pendingApproval = undefined;
    pending.resolve(decision);
    return true;
  }

  abort(agentSessionId: string): void {
    const session = runtimeGlobal().sessions.get(agentSessionId);
    if (session) abortActiveOperations(session);
  }

  listCaptures(agentSessionId: string): RemoteCaptureSummary[] { return listRemoteCaptures(agentSessionId); }
  readCapture(agentSessionId: string, captureId: string, offset?: number, limit?: number) { return readRemoteCapture(agentSessionId, captureId, offset, limit); }
  searchCapture(agentSessionId: string, captureId: string, query: string) { return searchRemoteCapture(agentSessionId, captureId, query); }
  async exportCapture(agentSessionId: string, captureId: string, cwd: string, destination: string, overwrite = false, options: { signal?: AbortSignal } = {}): Promise<string> {
    const inspection = await inspectRemoteCaptureExport(agentSessionId, captureId, cwd, destination);
    throwIfAborted(options.signal);
    const session = internalSession(agentSessionId);
    const generation = session.generation;
    const controller = new AbortController();
    session.abortController = controller;
    session.activeControllers.add(controller);
    const relayAbort = () => controller.abort();
    options.signal?.addEventListener("abort", relayAbort, { once: true });
    if (options.signal?.aborted) controller.abort();
    try {
      const resumeStatus = session.state.status;
      const decision = await requestApproval(session, {
        kind: "export",
        title: "Export remote capture",
        summary: `${inspection.summary.command.slice(0, 200)} → ${inspection.target}${overwrite ? " (overwrite allowed)" : " (new file only)"}`,
        command: inspection.summary.command.slice(0, 500),
      }, controller.signal, resumeStatus);
      throwIfAborted(controller.signal);
      if (!isCurrentGeneration(session, generation)) throw abortError();
      if (decision === "deny") throw new Error("Remote capture export denied");
      const rechecked = await inspectRemoteCaptureExport(agentSessionId, captureId, cwd, destination);
      if (rechecked.target !== inspection.target) throw new Error("Destination changed during export approval");
      throwIfAborted(controller.signal);
      if (!isCurrentGeneration(session, generation)) throw abortError();
      return await exportRemoteCapture(agentSessionId, captureId, cwd, destination, overwrite);
    } finally {
      options.signal?.removeEventListener("abort", relayAbort);
      session.activeControllers.delete(controller);
      if (session.abortController === controller) session.abortController = undefined;
      this.deleteIfUnused(agentSessionId, session);
    }
  }

  async close(agentSessionId: string, emitClosed = true): Promise<void> {
    const session = runtimeGlobal().sessions.get(agentSessionId);
    if (!session) return;
    const wasActive = Boolean(session.profile || session.ssh || session.telnet || session.shell || session.state.status === "connecting" || session.state.status === "running" || session.state.status === "paused" || session.state.status === "waiting-approval");
    abortActiveOperations(session);
    finishShellCommand(session, new Error("Remote connection closed"));
    denyPendingApprovals(session);
    await this.closeTransport(session);
    session.profile = undefined;
    session.state.pendingApproval = undefined;
    session.state.activeCommand = undefined;
    session.state.policyMode = "confirm-sensitive";
    session.state.controlMode = "agent";
    session.state.status = "closed";
    session.secretRedactor = undefined;
    session.suppressTerminalOutput = false;
    if (emitClosed && wasActive) emit(session, { type: "closed", summary: "Remote connection closed" });
    this.deleteIfUnused(agentSessionId, session);
  }

  private async closeTransport(session: InternalSession): Promise<void> {
    const shell = session.shell;
    const ssh = session.ssh;
    const telnet = session.telnet;
    // Invalidate all callbacks before closing transports. A delayed close/data
    // callback from an old connection must never mutate a newer connection.
    session.generation += 1;
    session.shell = undefined;
    session.ssh = undefined;
    session.telnet = undefined;
    session.suppressTerminalOutput = false;
    try { shell?.end(); } catch { /* Ignore idempotent close errors. */ }
    try { ssh?.end(); } catch { /* Ignore idempotent close errors. */ }
    try { await telnet?.end(); } catch { /* Ignore idempotent close errors. */ }
  }

  private deleteIfUnused(agentSessionId: string, session: InternalSession): void {
    if (!session.listeners.size && !session.profile && !session.ssh && !session.telnet && !session.shell && !session.pendingApprovals.size && !session.activeControllers.size && !session.state.activeCommand) {
      runtimeGlobal().sessions.delete(agentSessionId);
    }
  }
}

export function getRemoteRuntime(): RemoteRuntime {
  return new RemoteRuntime();
}
