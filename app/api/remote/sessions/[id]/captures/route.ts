import { NextResponse } from "next/server";
import { getRemoteRuntime } from "@/pi-packages/pi-remote-exec/runtime";
import { remoteSessionErrorStatus, requireRemoteSession } from "@/lib/remote-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await requireRemoteSession((await params).id);
    const query = new URL(req.url).searchParams;
    const captureId = query.get("captureId");
    const action = query.get("action") || "list";
    const runtimeInstance = getRemoteRuntime();
    if (action === "list") return NextResponse.json({ captures: runtimeInstance.listCaptures(id) });
    if (!captureId) return NextResponse.json({ error: "captureId is required" }, { status: 400 });
    if (action === "search") return NextResponse.json(runtimeInstance.searchCapture(id, captureId, query.get("q") || ""));
    return NextResponse.json(runtimeInstance.readCapture(id, captureId, Number(query.get("offset")) || 0, Number(query.get("limit")) || undefined));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: remoteSessionErrorStatus(error) }); }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const routeId = (await params).id;
    const baseSession = await requireRemoteSession(routeId);
    const body = await req.json() as { captureId?: unknown; cwd?: unknown; destination?: unknown; overwrite?: unknown };
    const requestedCwd = typeof body.cwd === "string" ? body.cwd : undefined;
    const session = requestedCwd === undefined ? baseSession : await requireRemoteSession(routeId, requestedCwd);
    if (typeof body.captureId !== "string" || typeof body.destination !== "string") return NextResponse.json({ error: "captureId and destination are required" }, { status: 400 });
    const path = await getRemoteRuntime().exportCapture(session.id, body.captureId, session.cwd, body.destination, body.overwrite === true, { signal: req.signal });
    return NextResponse.json({ ok: true, path });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : remoteSessionErrorStatus(error) });
  }
}
