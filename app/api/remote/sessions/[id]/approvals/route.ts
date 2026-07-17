import { NextResponse } from "next/server";
import type { RemoteApprovalDecision } from "@/lib/remote-types";
import { getRemoteRuntime } from "@/pi-packages/pi-remote-exec/runtime";
import { remoteSessionErrorStatus, requireRemoteSession } from "@/lib/remote-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const DECISIONS = new Set<RemoteApprovalDecision>(["allow_once", "trust", "deny"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await requireRemoteSession((await params).id);
    const body = await req.json() as { approvalId?: unknown; decision?: unknown };
    const approvalId = typeof body.approvalId === "string" ? body.approvalId : "";
    const decision = typeof body.decision === "string" ? body.decision as RemoteApprovalDecision : "deny";
    if (!approvalId || !DECISIONS.has(decision)) return NextResponse.json({ error: "Invalid approval response" }, { status: 400 });
    if (!getRemoteRuntime().resolveApproval(id, approvalId, decision)) return NextResponse.json({ error: "Approval is no longer pending" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: remoteSessionErrorStatus(error) }); }
}
