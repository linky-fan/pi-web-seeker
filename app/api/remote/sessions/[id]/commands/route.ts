import { NextResponse } from "next/server";
import { getRemoteRuntime } from "@/pi-packages/pi-remote-exec/runtime";
import { remoteSessionErrorStatus, requireRemoteSession } from "@/lib/remote-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await requireRemoteSession((await params).id);
    const body = await req.json() as { command?: unknown; intent?: unknown; timeoutMs?: unknown };
    if (typeof body.command !== "string") return NextResponse.json({ error: "command is required" }, { status: 400 });
    const result = await getRemoteRuntime().execute(id, body.command, {
      intent: body.intent === "change" ? "change" : "observe",
      timeoutMs: typeof body.timeoutMs === "number" ? body.timeoutMs : undefined,
      source: "command-bar",
      signal: req.signal,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: remoteSessionErrorStatus(error) }); }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await requireRemoteSession((await params).id);
    getRemoteRuntime().abort(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: remoteSessionErrorStatus(error) });
  }
}
