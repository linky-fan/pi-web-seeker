import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import { getOpenCliRuntime } from "@/pi-packages/pi-opencli/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const previewPath = getOpenCliRuntime().getPreviewPath(id);
  if (!previewPath) return NextResponse.json({ error: "Browser preview is not available" }, { status: 404 });
  try {
    return new Response(readFileSync(previewPath), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Browser preview is not available" }, { status: 404 });
  }
}
