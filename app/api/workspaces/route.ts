import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { homedir } from "os";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { getSessionCwdRoots } from "@/lib/session-reader";
import { registerWorkspaceRoot, getRegisteredWorkspaceRoots } from "@/lib/workspace-roots";

export const dynamic = "force-dynamic";

const IGNORED_DIRECTORY_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", ".cache", ".turbo",
  "application data", "applicationdata", "cookies", "local settings",
  "my documents", "nethood", "printhood", "recent", "sendto",
  "start menu", "templates",
]);

interface DirectoryEntry {
  name: string;
  path: string;
}

function homeRoot(): string {
  return process.env.PI_WEB_HOME || homedir();
}

function pathExistsAsDirectory(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

async function getWorkspaceBrowseRoots(): Promise<Set<string>> {
  const roots = new Set<string>();
  roots.add(homeRoot());
  if (process.env.PI_WEB_DEFAULT_CWD) roots.add(process.env.PI_WEB_DEFAULT_CWD);
  for (const root of await getAllowedRoots()) roots.add(root);
  for (const cwd of await getSessionCwdRoots()) roots.add(cwd);
  for (const cwd of getRegisteredWorkspaceRoots()) roots.add(cwd);
  return roots;
}

function parentWithinRoots(dirPath: string, roots: Set<string>): string | null {
  const parent = path.dirname(dirPath);
  if (!parent || parent === dirPath) return null;
  return isPathAllowed(parent, roots) ? parent : null;
}

function listDirectories(dirPath: string): DirectoryEntry[] {
  return fs.readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !IGNORED_DIRECTORY_NAMES.has(entry.name.toLowerCase()))
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const roots = await getWorkspaceBrowseRoots();
    const requested = searchParams.get("path") || homeRoot();
    const dirPath = path.resolve(requested);

    if (!isPathAllowed(dirPath, roots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (!pathExistsAsDirectory(dirPath)) {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    return NextResponse.json({
      path: dirPath,
      parent: parentWithinRoots(dirPath, roots),
      roots: [...roots].filter(pathExistsAsDirectory),
      entries: listDirectories(dirPath),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { cwd?: string };
    const cwd = body.cwd?.trim();
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

    const dirPath = path.resolve(cwd);
    if (!pathExistsAsDirectory(dirPath)) {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    const roots = await getWorkspaceBrowseRoots();
    if (!isPathAllowed(dirPath, roots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    registerWorkspaceRoot(dirPath);
    globalThis.__piAllowedRootsCache?.roots.add(dirPath);
    return NextResponse.json({ cwd: dirPath });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
