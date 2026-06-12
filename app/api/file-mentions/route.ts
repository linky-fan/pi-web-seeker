import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { getPathRelativeToRoot, normalizeFilePathSlashes } from "@/lib/path-identity";

export const dynamic = "force-dynamic";

const MAX_RESULTS = 40;
const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store", ".pi-web-data",
]);

interface MentionEntry {
  name: string;
  path: string;
  isDir: boolean;
  modified: string;
}

function shouldIgnoreName(name: string): boolean {
  return IGNORED_NAMES.has(name);
}

function resolveMentionDirectory(cwd: string, query: string): { dirPath: string; baseQuery: string; prefix: string } {
  const normalizedQuery = normalizeFilePathSlashes(query).replace(/^\/+/, "");
  const lastSlash = normalizedQuery.lastIndexOf("/");
  const prefix = lastSlash >= 0 ? normalizedQuery.slice(0, lastSlash + 1) : "";
  const baseQuery = lastSlash >= 0 ? normalizedQuery.slice(lastSlash + 1) : normalizedQuery;
  const dirPath = path.resolve(cwd, prefix || ".");
  return { dirPath, baseQuery, prefix };
}

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd");
    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const query = request.nextUrl.searchParams.get("q") ?? "";
    const { dirPath, baseQuery } = resolveMentionDirectory(cwd, query);
    if (!isPathAllowed(dirPath, new Set([cwd]))) {
      return NextResponse.json({ entries: [] });
    }

    const dirStat = fs.statSync(dirPath);
    if (!dirStat.isDirectory()) return NextResponse.json({ entries: [] });

    const needle = baseQuery.trim().toLowerCase();
    const entries: MentionEntry[] = fs.readdirSync(dirPath)
      .filter((name) => !shouldIgnoreName(name))
      .map((name) => {
        const fullPath = path.join(dirPath, name);
        try {
          const stat = fs.statSync(fullPath);
          const relativePath = getPathRelativeToRoot(fullPath, cwd);
          if (relativePath === null) return null;
          return {
            name,
            path: normalizeFilePathSlashes(relativePath),
            isDir: stat.isDirectory(),
            modified: stat.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is MentionEntry => {
        if (!entry) return false;
        return !needle || entry.name.toLowerCase().includes(needle);
      })
      .sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, MAX_RESULTS);

    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
