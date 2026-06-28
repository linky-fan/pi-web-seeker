import { execFile } from "child_process";
import { statSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { assertPathAllowed } from "@/lib/allowed-roots";

export const dynamic = "force-dynamic";

const COMMAND_TIMEOUT_MS = 1_500;
const COMMAND_MAX_BUFFER = 1024 * 1024;
const GH_STATUS_TTL_MS = 30_000;

let githubCliCache: { available: boolean; expiresAt: number } | null = null;

function execText(command: string, args: string[], timeout = COMMAND_TIMEOUT_MS): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: COMMAND_MAX_BUFFER,
      windowsHide: true,
    }, (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      resolve(String(stdout ?? "").trim());
    });
  });
}

async function assertWorkspaceCwd(cwd: string | null): Promise<string> {
  if (!cwd) throw new Error("cwd required");
  const resolved = path.resolve(cwd);
  await assertPathAllowed(resolved);
  try {
    if (!statSync(resolved).isDirectory()) throw new Error("cwd must be a directory");
  } catch (error) {
    if (error instanceof Error && error.message === "cwd must be a directory") throw error;
    throw new Error("cwd does not exist");
  }
  return resolved;
}

function summarizeNumstat(output: string): { insertions: number; deletions: number; binaryFiles: number } {
  let insertions = 0;
  let deletions = 0;
  let binaryFiles = 0;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [added, removed] = line.split("\t");
    if (added === "-" || removed === "-") {
      binaryFiles += 1;
      continue;
    }
    insertions += Number.parseInt(added, 10) || 0;
    deletions += Number.parseInt(removed, 10) || 0;
  }
  return { insertions, deletions, binaryFiles };
}

async function githubCliAvailable(): Promise<boolean> {
  const now = Date.now();
  if (githubCliCache && githubCliCache.expiresAt > now) return githubCliCache.available;
  const available = Boolean(await execText("gh", ["--version"], 1_000));
  githubCliCache = { available, expiresAt: now + GH_STATUS_TTL_MS };
  return available;
}

async function getGitStatus(cwd: string) {
  const root = await execText("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
  if (!root) {
    return {
      isRepo: false,
      root: null,
      branch: null,
      changedFiles: 0,
      insertions: 0,
      deletions: 0,
      binaryFiles: 0,
    };
  }

  const branch =
    await execText("git", ["-C", root, "branch", "--show-current"])
    ?? await execText("git", ["-C", root, "rev-parse", "--short", "HEAD"]);
  const status = await execText("git", ["-C", root, "status", "--porcelain=v1"], 2_000);
  const diff = await execText("git", ["-C", root, "diff", "--numstat", "HEAD", "--"], 2_500);
  const changedFiles = status ? status.split("\n").filter((line) => line.trim()).length : 0;
  const summary = summarizeNumstat(diff ?? "");

  return {
    isRepo: true,
    root,
    branch: branch || null,
    changedFiles,
    ...summary,
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  try {
    const cwd = await assertWorkspaceCwd(searchParams.get("cwd"));
    const [git, ghAvailable] = await Promise.all([
      getGitStatus(cwd),
      githubCliAvailable(),
    ]);

    return NextResponse.json({
      cwd,
      git,
      githubCli: { available: ghAvailable },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 400 });
  }
}
