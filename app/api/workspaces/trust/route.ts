import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { assertPathAllowed } from "@/lib/allowed-roots";
import {
  canonicalWorkspacePath,
  projectTrustState,
  recordProjectTrust,
  requiresProjectTrust,
} from "@/lib/project-trust";

export const dynamic = "force-dynamic";

function trustPayload(cwd: string) {
  return {
    cwd: canonicalWorkspacePath(cwd),
    required: requiresProjectTrust(cwd),
    state: projectTrustState(cwd),
  };
}

// GET /api/workspaces/trust?cwd=<path>
// Reports whether this workspace gates project resources and the remembered decision.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
  if (!existsSync(cwd)) return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });

  try {
    await assertPathAllowed(cwd);
  } catch {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    return NextResponse.json(trustPayload(cwd));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/workspaces/trust  body: { cwd: string; trusted: boolean }
// Allow is remembered for the workspace; deny lasts until the server restarts.
export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: unknown; trusted?: unknown };
    if (typeof body.cwd !== "string" || !body.cwd) {
      return NextResponse.json({ error: "cwd required" }, { status: 400 });
    }
    if (typeof body.trusted !== "boolean") {
      return NextResponse.json({ error: "trusted must be a boolean" }, { status: 400 });
    }
    if (!existsSync(body.cwd)) {
      return NextResponse.json({ error: `Directory does not exist: ${body.cwd}` }, { status: 400 });
    }
    try {
      await assertPathAllowed(body.cwd);
    } catch {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    recordProjectTrust(body.cwd, body.trusted);
    return NextResponse.json(trustPayload(body.cwd));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}