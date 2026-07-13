import { getOpenCliRuntime } from "@/pi-packages/pi-opencli/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runtimeInstance = getOpenCliRuntime();
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      push({ type: "ready", state: runtimeInstance.getSession(id) });
      unsubscribe = runtimeInstance.subscribe(id, push);
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { /* Stream already closed. */ }
      }, 15_000);
      heartbeat.unref?.();
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  req.signal.addEventListener("abort", () => {
    unsubscribe?.();
    if (heartbeat) clearInterval(heartbeat);
  }, { once: true });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
