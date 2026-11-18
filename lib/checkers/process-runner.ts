import { spawn } from "node:child_process";

export interface CheckerInvocation {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  outputTruncated: boolean;
  aborted: boolean;
  spawnError: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 1_000;
const CHECKER_ENVIRONMENT_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "CI",
  "ELECTRON_RUN_AS_NODE",
  "JAVA_HOME",
  "GOROOT",
  "GOPATH",
  "GOCACHE",
  "GOMODCACHE",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "SDKROOT",
  "DEVELOPER_DIR",
  "INCLUDE",
  "LIB",
  "LIBPATH",
  "CC",
  "CXX",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
] as const;

function checkerEnvironment(overrides?: Record<string, string>): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const name of CHECKER_ENVIRONMENT_ALLOWLIST) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return {
    ...env,
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    ...overrides,
  };
}

export function runCheckerProcess(
  invocation: CheckerInvocation,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({
        stdout: "",
        stderr: "",
        exitCode: null,
        timedOut: false,
        outputTruncated: false,
        aborted: true,
        spawnError: false,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let capturedBytes = 0;
    let timedOut = false;
    let outputTruncated = false;
    let aborted = false;
    let spawnError = false;
    let settled = false;
    let terminationStarted = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: checkerEnvironment(invocation.env),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const terminate = () => {
      if (terminationStarted) return;
      terminationStarted = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, KILL_GRACE_MS);
      killTimer.unref();
    };

    const append = (destination: "stdout" | "stderr", chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - capturedBytes;
      if (remaining <= 0) {
        outputTruncated = true;
        terminate();
        return;
      }
      const accepted = chunk.subarray(0, remaining);
      capturedBytes += accepted.byteLength;
      if (destination === "stdout") stdout += accepted.toString("utf8");
      else stderr += accepted.toString("utf8");
      if (accepted.byteLength < chunk.byteLength) {
        outputTruncated = true;
        terminate();
      }
    };

    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", () => {
      spawnError = true;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, invocation.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timeout.unref();

    const onAbort = () => {
      aborted = true;
      terminate();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      resolve({
        stdout,
        stderr,
        exitCode,
        timedOut,
        outputTruncated,
        aborted,
        spawnError,
      });
    });
  });
}
