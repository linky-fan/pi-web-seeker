import { NextResponse } from "next/server";
import type { BrowserApprovalDecision } from "@/lib/browser-types";
import { getOpenCliRuntime } from "@/pi-packages/pi-opencli/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DECISIONS = new Set<BrowserApprovalDecision>(["allow_once", "allow_origin", "deny"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json() as { approvalId?: unknown; decision?: unknown };
    const approvalId = typeof body.approvalId === "string" ? body.approvalId : "";
    const decision = typeof body.decision === "string" ? body.decision as BrowserApprovalDecision : "deny";
    if (!approvalId || !DECISIONS.has(decision)) return NextResponse.json({ error: "Invalid approval response" }, { status: 400 });
    const resolved = getOpenCliRuntime().resolveApproval(id, approvalId, decision);
    if (!resolved) return NextResponse.json({ error: "Approval is no longer pending" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
