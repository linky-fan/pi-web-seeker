import { NextResponse } from "next/server";
import type { BrowserPolicyMode } from "@/lib/browser-types";
import { getOpenCliRuntime } from "@/pi-packages/pi-opencli/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await req.json() as { mode?: unknown; origin?: unknown; trusted?: unknown };
    const mode = body.mode === "confirm-sensitive" || body.mode === "full-auto" ? body.mode as BrowserPolicyMode : undefined;
    const origin = typeof body.origin === "string" ? body.origin : undefined;
    const trusted = typeof body.trusted === "boolean" ? body.trusted : undefined;
    if (!mode && origin === undefined) return NextResponse.json({ error: "Policy update required" }, { status: 400 });
    const policy = getOpenCliRuntime().setPolicy(id, { mode, origin, trusted });
    return NextResponse.json({ ok: true, policy });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
