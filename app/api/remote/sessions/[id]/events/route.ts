import { getRemoteRuntime } from "@/pi-packages/pi-remote-exec/runtime";
import { NextResponse } from "next/server";
import { remoteSessionErrorStatus, requireRemoteSession } from "@/lib/remote-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  let id: string;
  try {
    id = (await requireRemoteSession((await params).id)).id;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: remoteSessionErrorStatus(error) });
  }
  const runtimeInstance = getRemoteRuntime();
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
      push({ type: "ready", state: runtimeInstance.getSession(id) });
      unsubscribe = runtimeInstance.subscribe(id, push);
      heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(": heartbeat\n\n")); } catch { /* Closed. */ } }, 15_000);
      heartbeat.unref?.();
    },
    cancel() { unsubscribe?.(); if (heartbeat) clearInterval(heartbeat); },
  });
  req.signal.addEventListener("abort", () => { unsubscribe?.(); if (heartbeat) clearInterval(heartbeat); }, { once: true });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
