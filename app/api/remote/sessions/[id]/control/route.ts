import { NextResponse } from "next/server";
import { getRemoteRuntime } from "@/pi-packages/pi-remote-exec/runtime";
import { remoteSessionErrorStatus, requireRemoteSession } from "@/lib/remote-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await requireRemoteSession((await params).id);
    const body = await req.json() as { action?: unknown };
    const runtimeInstance = getRemoteRuntime();
    if (body.action === "takeover") return NextResponse.json({ ok: true, state: runtimeInstance.takeControl(id) });
    if (body.action === "resume") return NextResponse.json({ ok: true, state: runtimeInstance.resumeAgent(id) });
    if (body.action === "apply-detected-type") return NextResponse.json({ ok: true, state: runtimeInstance.acceptDetectedHostType(id) });
    if (body.action === "disconnect") { await runtimeInstance.close(id); return NextResponse.json({ ok: true, state: runtimeInstance.getSession(id) }); }
    return NextResponse.json({ error: "Unsupported control action" }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: remoteSessionErrorStatus(error) }); }
}
