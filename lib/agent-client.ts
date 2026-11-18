import { apiPath } from "@/lib/api-path";

// Client-side helper for POST api/agent/[id].
//
// Every api/agent/[id] route returns one of:
//   { success: true, data: <result> }
//   { error: string }              (non-2xx)
//
// Call sites previously repeated the same 5-line fetch block 13× in
// hooks/useAgentSession.ts. This helper collapses that down to one line.

export const PROJECT_TRUST_REQUIRED = "PROJECT_TRUST_REQUIRED";

export class AgentCommandError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly cwd?: string;

  constructor(message: string, status: number, code?: string, cwd?: string) {
    super(message);
    this.name = "AgentCommandError";
    this.status = status;
    this.code = code;
    this.cwd = cwd;
  }
}

export function isProjectTrustRequiredError(error: unknown): error is AgentCommandError & { cwd: string } {
  return error instanceof AgentCommandError && error.code === PROJECT_TRUST_REQUIRED && typeof error.cwd === "string";
}

export async function sendAgentCommand<T = unknown>(
  sessionId: string,
  command: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(apiPath(`agent/${encodeURIComponent(sessionId)}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
    code?: string;
    cwd?: string;
  };
  if (!res.ok || body.error) {
    throw new AgentCommandError(body.error ?? `HTTP ${res.status}`, res.status, body.code, body.cwd);
  }
  return body.data as T;
}