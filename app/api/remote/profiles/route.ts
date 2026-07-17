import { NextResponse } from "next/server";
import { deleteRemoteProfile, listRemoteProfiles, saveRemoteProfile } from "@/lib/remote-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ profiles: listRemoteProfiles() });
}

export async function POST(req: Request) {
  try { return NextResponse.json({ profile: saveRemoteProfile(await req.json()) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as { id?: unknown; profile?: unknown };
    if (typeof body.id !== "string") return NextResponse.json({ error: "Profile id is required" }, { status: 400 });
    return NextResponse.json({ profile: saveRemoteProfile(body.profile, body.id) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json() as { id?: unknown };
    if (typeof body.id !== "string") return NextResponse.json({ error: "Profile id is required" }, { status: 400 });
    if (!deleteRemoteProfile(body.id)) return NextResponse.json({ error: "Remote profile not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 }); }
}
