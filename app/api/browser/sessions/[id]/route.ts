import { NextResponse } from "next/server";
import { getOpenCliRuntime } from "@/pi-packages/pi-opencli/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(getOpenCliRuntime().getSession(id));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getOpenCliRuntime().close(id);
  return NextResponse.json({ ok: true });
}
