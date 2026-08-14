import type { AgentSessionWrapper } from "@/lib/rpc-manager";

type AgentEventSource = Pick<AgentSessionWrapper, "onEvent">;

export function createAgentEventStream(
  req: Request,
  session: AgentEventSource,
  sessionId: string,
  heartbeatMs = 30_000,
): ReadableStream<Uint8Array> {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let unsubscribe: (() => void) | null = null;

      cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        req.signal.removeEventListener("abort", cleanup);
        const stopListening = unsubscribe;
        unsubscribe = null;
        try { stopListening?.(); } catch { /* session cleanup is best effort */ }
        try { controller.close(); } catch { /* stream may already be closed */ }
      };

      const enqueue = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };
      const encode = (data: unknown) => enqueue(`data: ${JSON.stringify(data)}\n\n`);

      encode({ type: "connected", sessionId });
      if (closed) return;
      unsubscribe = session.onEvent((event) => encode(event));
      heartbeat = setInterval(() => enqueue(":\n\n"), heartbeatMs);
      req.signal.addEventListener("abort", cleanup, { once: true });
      if (req.signal.aborted) cleanup();
    },
    cancel() {
      cleanup();
    },
  });
  return stream;
}
