import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { Message } from "@earendil-works/pi-ai";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { createAppModelRegistry } from "@/lib/model-registry";
import {
  parseQuickChatMessages,
  parseQuickChatModel,
  QuickChatValidationError,
} from "@/lib/quick-chat";
import {
  QuickChatSearchError,
  quickChatSearchSystemPrompt,
  searchQuickChatWeb,
} from "@/lib/quick-chat-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 512 * 1024;
const QUICK_CHAT_TIMEOUT_MS = 120_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return Response.json({ error: "Request is too large" }, { status: 413 });
  }

  try {
    const body = await req.json() as unknown;
    const modelRef = parseQuickChatModel(body);
    const messages = parseQuickChatMessages((body as { messages?: unknown }).messages);
    const webSearchValue = (body as { webSearch?: unknown }).webSearch;
    if (webSearchValue !== undefined && typeof webSearchValue !== "boolean") {
      throw new QuickChatValidationError("webSearch must be a boolean");
    }
    const webSearch = webSearchValue === true;
    if (messages[messages.length - 1]?.role !== "user") {
      throw new QuickChatValidationError("The last message must be from the user");
    }

    const registry = createAppModelRegistry(AuthStorage.create());
    const model = registry.find(modelRef.provider, modelRef.modelId);
    if (!model) {
      return Response.json({ error: `Model not found: ${modelRef.provider}/${modelRef.modelId}` }, { status: 404 });
    }
    const auth = await registry.getApiKeyAndHeaders(model);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: 400 });
    if (!auth.apiKey) {
      return Response.json({ error: `No API key found for "${modelRef.provider}"` }, { status: 400 });
    }

    const encoder = new TextEncoder();
    let cancelRequest: (() => void) | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), QUICK_CHAT_TIMEOUT_MS);
        const onRequestAbort = () => abortController.abort();
        req.signal.addEventListener("abort", onRequestAbort, { once: true });

        const send = (event: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            closed = true;
          }
        };
        const finish = () => {
          clearTimeout(timeout);
          req.signal.removeEventListener("abort", onRequestAbort);
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // The consumer already cancelled the stream.
          }
        };
        cancelRequest = () => {
          abortController.abort();
          finish();
        };

        void (async () => {
          let stage: "search" | "model" = webSearch ? "search" : "model";
          try {
            send({ type: "start" });
            let systemPrompt: string | undefined;
            if (webSearch) {
              const query = messages[messages.length - 1]?.text ?? "";
              send({ type: "search_start", query });
              const sources = await searchQuickChatWeb(query, abortController.signal);
              send({ type: "search_results", query, sources });
              systemPrompt = quickChatSearchSystemPrompt(sources);
              stage = "model";
            }
            const contextMessages: Message[] = messages.map((message) => message.role === "user"
              ? { role: "user", content: message.text, timestamp: message.timestamp }
              : {
                  role: "assistant",
                  content: [{ type: "text", text: message.text }],
                  api: model.api,
                  provider: model.provider,
                  model: model.id,
                  usage: {
                    input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                  },
                  stopReason: "stop",
                  timestamp: message.timestamp,
                });

            const response = streamSimple(model, { messages: contextMessages, ...(systemPrompt ? { systemPrompt } : {}) }, {
              apiKey: auth.apiKey,
              headers: auth.headers,
              cacheRetention: "none",
              maxRetries: 0,
              timeoutMs: QUICK_CHAT_TIMEOUT_MS,
              signal: abortController.signal,
            });

            for await (const event of response) {
              if (event.type === "text_delta") send({ type: "delta", delta: event.delta });
              if (event.type === "done") send({ type: "done" });
              if (event.type === "error") {
                send({
                  type: "error",
                  stage: "model",
                  error: event.error.errorMessage ?? (abortController.signal.aborted ? "Request stopped" : "Model request failed"),
                });
              }
            }
          } catch (error) {
            const searchError = error instanceof QuickChatSearchError ? error : null;
            send({
              type: "error",
              stage,
              error: abortController.signal.aborted ? "Request stopped" : errorMessage(error),
              ...(searchError ? { code: searchError.code, source: searchError.source } : {}),
            });
          } finally {
            finish();
          }
        })();
      },
      cancel() {
        cancelRequest?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      { status: error instanceof QuickChatValidationError ? error.status : 400 },
    );
  }
}
