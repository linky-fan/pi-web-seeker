import { NextResponse } from "next/server";
import { getOpenCliRuntime, type OpenCliCommand } from "@/pi-packages/pi-opencli/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UI_ACTIONS = new Set(["navigate", "refresh", "pause", "resume", "takeover", "close"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json() as { action?: unknown; url?: unknown };
    const action = typeof body.action === "string" ? body.action : "";
    if (!UI_ACTIONS.has(action)) return NextResponse.json({ error: "Unsupported browser UI action" }, { status: 400 });
    const runtimeInstance = getOpenCliRuntime();
    if (action === "close") {
      await runtimeInstance.close(id);
      return NextResponse.json({ ok: true });
    }
    const command: OpenCliCommand = action === "navigate"
      ? { category: "navigate", action: "open", url: typeof body.url === "string" ? body.url : undefined }
      : { category: "ui", action };
    const result = await runtimeInstance.execute(id, command, { signal: req.signal, source: "ui" });
    return NextResponse.json({ ok: true, result, state: runtimeInstance.getSession(id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
