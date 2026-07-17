import { NextResponse } from "next/server";
import { assertPathAllowed } from "@/lib/allowed-roots";
import { enableRemotePackage, remotePackageStatus } from "@/lib/remote-package";
import { getRpcSession } from "@/lib/rpc-manager";
import { remoteSessionErrorStatus, requireRemoteSession } from "@/lib/remote-session";
import { getRemoteRuntime } from "@/pi-packages/pi-remote-exec/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; agentSessionId?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const agentSessionId = typeof body.agentSessionId === "string" ? body.agentSessionId.trim() : "";
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    const formalSession = agentSessionId ? await requireRemoteSession(agentSessionId, cwd) : undefined;
    const trustedCwd = formalSession?.cwd ?? cwd;
    await assertPathAllowed(trustedCwd);
    const packagePath = await enableRemotePackage(trustedCwd);
    const session = agentSessionId ? getRpcSession(agentSessionId) : undefined;
    if (session?.isAlive()) {
      await getRemoteRuntime().close(agentSessionId, false);
      await session.send({ type: "reload" });
    }
    return NextResponse.json({ ok: true, packagePath, ...(await remotePackageStatus(trustedCwd)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : remoteSessionErrorStatus(error) === 404 ? 404 : 500 });
  }
}
