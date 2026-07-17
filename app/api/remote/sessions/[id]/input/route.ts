import { NextResponse } from "next/server";
import { getRemoteRuntime } from "@/pi-packages/pi-remote-exec/runtime";
import { remoteSessionErrorStatus, requireRemoteSession } from "@/lib/remote-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await requireRemoteSession((await params).id);
    const body = await req.json() as { data?: unknown; cols?: unknown; rows?: unknown };
    const runtimeInstance = getRemoteRuntime();
    if (typeof body.data === "string") runtimeInstance.writeInput(id, body.data);
    if (typeof body.cols === "number" && typeof body.rows === "number") runtimeInstance.resize(id, body.cols, body.rows);
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: remoteSessionErrorStatus(error) }); }
}
