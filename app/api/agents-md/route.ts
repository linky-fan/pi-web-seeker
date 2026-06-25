import { execFile } from "child_process";
import { existsSync, statSync } from "fs";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { assertPathAllowed } from "@/lib/allowed-roots";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "agents-md.mjs");

type AgentsCommand = "init" | "check" | "detect" | "draft";

function agentsPath(cwd: string): string {
  return path.join(cwd, "AGENTS.md");
}

async function runAgentsTool(args: string[]) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: process.cwd(),
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  const output = stdout.trim();
  let json: unknown = null;
  if (output) {
    try {
      json = JSON.parse(output);
    } catch {
      json = null;
    }
  }
  return { json, output, stderr: stderr.trim() };
}

async function assertCwd(cwd: unknown): Promise<string> {
  if (!cwd || typeof cwd !== "string") {
    throw new Error("cwd required");
  }
  await assertPathAllowed(cwd);
  try {
    if (!statSync(cwd).isDirectory()) {
      throw new Error("cwd must be a directory");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "cwd must be a directory") throw error;
    throw new Error("cwd does not exist");
  }
  return cwd;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    const cwd = await assertCwd(searchParams.get("cwd"));
    const filePath = agentsPath(cwd);
    return NextResponse.json({
      cwd,
      filePath,
      exists: existsSync(filePath),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string; action?: AgentsCommand; template?: string; strict?: boolean; force?: boolean };
    const cwd = await assertCwd(body.cwd);
    const action = body.action;
    if (action !== "init" && action !== "check" && action !== "detect" && action !== "draft") {
      return NextResponse.json({ error: "action must be init, check, detect, or draft" }, { status: 400 });
    }

    const filePath = agentsPath(cwd);
    const args =
      action === "init"
        ? ["init", "--template", body.template ?? "auto", "--dir", cwd, ...(body.force ? ["--force"] : [])]
        : action === "check"
          ? ["check", "--path", filePath, ...(body.strict ? ["--strict"] : [])]
          : [action, "--dir", cwd];

    try {
      const result = await runAgentsTool(args);
      return NextResponse.json({
        ok: true,
        action,
        cwd,
        filePath,
        exists: existsSync(filePath),
        result: result.json,
        output: result.output,
        stderr: result.stderr,
      });
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string; code?: number };
      const stdout = (err.stdout ?? "").trim();
      const errorMessage = (err.stderr ?? "").trim() || err.message || String(error);
      let result: unknown = null;
      if (stdout) {
        try {
          result = JSON.parse(stdout);
        } catch {
          result = null;
        }
      }
      return NextResponse.json({
        ok: false,
        action,
        cwd,
        filePath,
        exists: existsSync(filePath),
        result,
        output: stdout,
        stderr: (err.stderr ?? "").trim(),
        error: errorMessage,
      }, { status: errorMessage.includes("already exists") ? 409 : 500 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}
