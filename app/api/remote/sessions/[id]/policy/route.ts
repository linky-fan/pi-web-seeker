import { NextResponse } from "next/server";
import { getRemoteRuntime } from "@/pi-packages/pi-remote-exec/runtime";
import { remoteSessionErrorStatus, requireRemoteSession } from "@/lib/remote-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await requireRemoteSession((await params).id);
    const body = await req.json() as { mode?: unknown };
    if (body.mode !== "confirm-sensitive" && body.mode !== "full-auto") return NextResponse.json({ error: "Invalid policy mode" }, { status: 400 });
    return NextResponse.json({ ok: true, state: getRemoteRuntime().setPolicy(id, body.mode) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: remoteSessionErrorStatus(error) }); }
}
