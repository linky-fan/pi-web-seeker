import { NextResponse } from "next/server";
import { assertPathAllowed } from "@/lib/allowed-roots";
import { enableBrowserPackage, browserPackageStatus } from "@/lib/browser-package";
import { getRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; agentSessionId?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
    const agentSessionId = typeof body.agentSessionId === "string" ? body.agentSessionId.trim() : "";
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    await assertPathAllowed(cwd);
    const packagePath = await enableBrowserPackage(cwd);
    if (agentSessionId) {
      const session = getRpcSession(agentSessionId);
      if (session?.isAlive()) await session.send({ type: "reload" });
    }
    const status = await browserPackageStatus(cwd);
    return NextResponse.json({ ok: true, packagePath, ...status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 500 });
  }
}
