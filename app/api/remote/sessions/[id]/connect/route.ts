import { NextResponse } from "next/server";
import { getRemoteRuntime } from "@/pi-packages/pi-remote-exec/runtime";
import { findRemoteProfile } from "@/lib/remote-store";
import { remoteSessionErrorStatus, requireRemoteSession } from "@/lib/remote-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await requireRemoteSession((await params).id);
    const body = await req.json() as { profileId?: unknown; password?: unknown; passphrase?: unknown };
    if (typeof body.profileId !== "string") return NextResponse.json({ error: "profileId is required" }, { status: 400 });
    const profile = findRemoteProfile(body.profileId);
    if (!profile) return NextResponse.json({ error: "Remote profile not found" }, { status: 404 });
    const hasPassword = body.password !== undefined;
    const hasPassphrase = body.passphrase !== undefined;
    const validSecret = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 4_096;
    if (profile.authMethod === "password") {
      if (!validSecret(body.password) || hasPassphrase) return NextResponse.json({ error: "A temporary password is required for this target" }, { status: 400 });
    } else if (profile.authMethod === "key") {
      if (hasPassword || (hasPassphrase && !validSecret(body.passphrase))) return NextResponse.json({ error: "Only an optional key passphrase may be sent for this target" }, { status: 400 });
    } else if (hasPassword || hasPassphrase) {
      return NextResponse.json({ error: "This target uses ssh-agent and does not accept credentials" }, { status: 400 });
    }
    const state = await getRemoteRuntime().connect(id, body.profileId, {
      password: profile.authMethod === "password" ? body.password as string : undefined,
      passphrase: profile.authMethod === "key" && typeof body.passphrase === "string" ? body.passphrase : undefined,
    }, { signal: req.signal });
    return NextResponse.json({ ok: true, state });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: remoteSessionErrorStatus(error) }); }
}
