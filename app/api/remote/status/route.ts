import { NextResponse } from "next/server";
import { assertPathAllowed } from "@/lib/allowed-roots";
import { listRemoteProfiles } from "@/lib/remote-store";
import { remotePackageStatus } from "@/lib/remote-package";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd")?.trim() || "";
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    await assertPathAllowed(cwd);
    return NextResponse.json({ ...(await remotePackageStatus(cwd)), profileCount: listRemoteProfiles().length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 500 });
  }
}
