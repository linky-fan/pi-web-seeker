import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { createAppModelRuntime } from "@/lib/model-registry";

export const dynamic = "force-dynamic";

// In-memory registry: loginToken -> resolve/reject for the manualCodeInput promise
declare global {
  var __piLoginCallbacks: Map<string, { resolve: (v: string) => void; reject: (e: Error) => void }> | undefined;
}

function getCallbackRegistry() {
  if (!globalThis.__piLoginCallbacks) globalThis.__piLoginCallbacks = new Map();
  return globalThis.__piLoginCallbacks;
}

// POST /api/auth/login/[provider] — frontend sends redirect URL or auth code
export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  const { token, code } = (await req.json()) as { token?: string; code?: string };

  if (!token || !code) {
    return Response.json({ error: "token and code required" }, { status: 400 });
  }

  const registry = getCallbackRegistry();
  const callbacks = registry.get(token);
  if (!callbacks) {
    return Response.json({ error: "No pending login for token" }, { status: 404 });
  }
  // Verify token belongs to this provider (token format: "<provider>-<ts>-<random>")
  if (!token.startsWith(`${provider}-`)) {
    return Response.json({ error: "Token does not match provider" }, { status: 400 });
  }

  callbacks.resolve(code);
  registry.delete(token);
  return Response.json({ ok: true, provider });
}

// GET /api/auth/login/[provider] — SSE stream for OAuth flow
export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, data: unknown) => {
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    } catch {
      abort.abort();
    }
  };

  const close = (controller: ReadableStreamDefaultController) => {
    try {
      controller.close();
    } catch {
      // The client may have already closed the EventSource.
    }
  };

  // AbortController propagates client disconnect into ModelRuntime.login().
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      const runtime = await createAppModelRuntime();
      if (!runtime.getProvider(provider)?.auth.oauth) {
        send(controller, { type: "error", message: `Unknown provider: ${provider}` });
        close(controller);
        return;
      }

      const registry = getCallbackRegistry();
      const activeTokens = new Set<string>();
      let pendingManualRequest: { token: string; promise: Promise<string> } | undefined;
      let manualInputAnnounced = false;

      const createClientInputRequest = () => {
        const token = `${provider}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        activeTokens.add(token);

        const promise = new Promise<string>((resolve, reject) => {
          registry.set(token, {
            resolve: (value) => {
              activeTokens.delete(token);
              registry.delete(token);
              resolve(value);
            },
            reject: (error) => {
              activeTokens.delete(token);
              registry.delete(token);
              reject(error);
            },
          });
        });

        return { token, promise };
      };

      const getManualInputRequest = () => {
        if (!pendingManualRequest) {
          pendingManualRequest = createClientInputRequest();
          pendingManualRequest.promise
            .finally(() => {
              pendingManualRequest = undefined;
              manualInputAnnounced = false;
            })
            .catch(() => {});
        }
        return pendingManualRequest;
      };

      // Cleanup: remove pending token and abort any waiting promise
      const cleanup = () => {
        for (const token of activeTokens) {
          registry.get(token)?.reject(new Error("Login cancelled"));
          registry.delete(token);
        }
        activeTokens.clear();
      };

      // Also cancel on client disconnect
      abort.signal.addEventListener("abort", cleanup);

      try {
        const prompt = async (authPrompt: AuthPrompt): Promise<string> => {
          if (authPrompt.type === "select") {
            const request = createClientInputRequest();
            send(controller, {
              type: "select_request",
              message: authPrompt.message,
              options: authPrompt.options,
              token: request.token,
            });
            return request.promise;
          }

          const request = getManualInputRequest();
          if (authPrompt.type !== "manual_code" || !manualInputAnnounced) {
            send(controller, {
              type: "prompt_request",
              message: authPrompt.message,
              placeholder: authPrompt.placeholder ?? null,
              token: request.token,
            });
          }
          return request.promise;
        };

        const notify = (event: AuthEvent) => {
          if (event.type === "auth_url") {
            const request = getManualInputRequest();
            manualInputAnnounced = true;
            send(controller, {
              type: "auth",
              url: event.url,
              instructions: event.instructions ?? null,
              token: request.token,
            });
          } else if (event.type === "device_code") {
            send(controller, {
              type: "device_code",
              userCode: event.userCode,
              verificationUri: event.verificationUri,
              intervalSeconds: event.intervalSeconds ?? null,
              expiresInSeconds: event.expiresInSeconds ?? null,
            });
          } else {
            send(controller, { type: "progress", message: event.message });
          }
        };

        await runtime.login(provider, "oauth", {
          prompt,
          notify,
          signal: abort.signal,
        });

        send(controller, { type: "success" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== "Login cancelled") {
          send(controller, { type: "error", message: msg });
        } else {
          send(controller, { type: "cancelled" });
        }
      } finally {
        cleanup();
        close(controller);
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
