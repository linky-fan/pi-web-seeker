import { NextResponse } from "next/server";
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  resolveSessionPath,
  invalidateSessionPathCache,
  invalidateSessionFileCache,
  getCachedSessionContext,
  getCachedSessionFile,
  listAllSessions,
} from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { areSameFilePath, isWindowsStylePath } from "@/lib/path-identity";
import { compressSessionTree } from "@/lib/session-tree";

function getPathModule(filePath: string): typeof path.win32 | typeof path.posix {
  return isWindowsStylePath(filePath) ? path.win32 : path.posix;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const snapshot = getCachedSessionFile(filePath);
    const { leafId, header } = snapshot;
    const tree = compressSessionTree(snapshot.tree);
    const context = getCachedSessionContext(snapshot, leafId);

    const modified = new Date(snapshot.mtimeMs).toISOString();
    const allSessions = await listAllSessions();
    const parentSessionId = allSessions.find((s) => s.id === id)?.parentSessionId;
    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: snapshot.sessionName,
      created: header.timestamp,
      modified,
      messageCount: context.messages.length,
      firstMessage: context.messages.find((m) => m.role === "user")
        ? (() => {
            const msg = context.messages.find((m) => m.role === "user")!;
            const c = (msg as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
    } : null;

    const url = new URL(req.url);
    let agentState: { running: boolean; state?: unknown } | undefined;
    if (url.searchParams.has("includeState")) {
      const rpc = getRpcSession(id);
      if (rpc?.isAlive()) {
        const state = await rpc.send({ type: "get_state" });
        agentState = { running: true, state };
      } else {
        agentState = { running: false };
      }
    }

    return NextResponse.json({
      sessionId: id,
      filePath,
      info,
      tree,
      leafId,
      context,
      ...(agentState !== undefined ? { agentState } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(name.trim());
    invalidateSessionFileCache(filePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read header before deleting to get parentSession path
    const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
    let parentSessionPath: string | undefined;
    try {
      const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
      if (header.type === "session") parentSessionPath = header.parentSession;
    } catch { /* ignore */ }

    // Re-attach all direct children to this session's parent (cascade re-parent)
    // Scan sibling files in the same directory
    const pathModule = getPathModule(filePath);
    const dir = pathModule.dirname(filePath);
    try {
      const files = readdirSync(dir).filter((f) => {
        if (!f.endsWith(".jsonl")) return false;
        return !areSameFilePath(pathModule.join(dir, f), filePath);
      });
      for (const file of files) {
        const childPath = pathModule.join(dir, file);
        try {
          const content = readFileSync(childPath, "utf8");
          const lines = content.split("\n");
          const header = JSON.parse(lines[0]) as { type?: string; parentSession?: string };
          if (header.type === "session" && header.parentSession && areSameFilePath(header.parentSession, filePath)) {
            // Rewrite header with new parentSession
            header.parentSession = parentSessionPath;
            lines[0] = JSON.stringify(header);
            writeFileSync(childPath, lines.join("\n"));
            invalidateSessionFileCache(childPath);
          }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip if dir unreadable */ }

    getRpcSession(id)?.destroy();
    unlinkSync(filePath);
    invalidateSessionPathCache(id);
    invalidateSessionFileCache(filePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
