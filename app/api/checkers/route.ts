import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { assertPathAllowed } from "@/lib/allowed-roots";
import { getCheckerInventory, prepareCheckerRun, validateCheckerIds } from "@/lib/checkers";

export const dynamic = "force-dynamic";

async function getWorkspaceRoot(value: unknown): Promise<string> {
  if (typeof value !== "string" || !value.trim() || !path.isAbsolute(value)) {
    throw new Error("cwd required");
  }
  const resolved = path.resolve(value);
  await assertPathAllowed(resolved);
  let realPath: string;
  try {
    realPath = fs.realpathSync.native(resolved);
    if (!fs.statSync(realPath).isDirectory()) throw new Error("cwd must be a directory");
  } catch {
    throw new Error("cwd does not exist");
  }
  await assertPathAllowed(realPath);
  return realPath;
}

function errorResponse(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "";
  if (message === "Access denied") {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  if (message === "cwd required" || message === "cwd does not exist" || message === "cwd must be a directory") {
    return NextResponse.json({ error: message }, { status: 400 });
  }
  return NextResponse.json({ error: "Unable to inspect this workspace." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const cwd = await getWorkspaceRoot(new URL(request.url).searchParams.get("cwd"));
    return NextResponse.json(getCheckerInventory(cwd), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const body = payload as {
      cwd?: unknown;
      checkerIds?: unknown;
      confirmed?: unknown;
    };
    if (body.confirmed !== true) {
      return NextResponse.json({ error: "Explicit confirmation is required." }, { status: 400 });
    }
    const selected = validateCheckerIds(body.checkerIds);
    if (!selected) {
      return NextResponse.json({ error: "Invalid checker selection." }, { status: 400 });
    }
    const cwd = await getWorkspaceRoot(body.cwd);
    const checkerRun = prepareCheckerRun(cwd);
    const inventory = checkerRun.inventory;
    const byId = new Map(inventory.targets.map((target) => [target.id, target]));
    if (selected.some((id) => !byId.has(id))) {
      return NextResponse.json({ error: "Checker selection is stale. Refresh the list and retry." }, { status: 409 });
    }
    if (selected.some((id) => !byId.get(id)?.available)) {
      return NextResponse.json({ error: "One or more selected checkers are unavailable." }, { status: 409 });
    }

    const results = await checkerRun.runSelected(selected, request.signal);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
