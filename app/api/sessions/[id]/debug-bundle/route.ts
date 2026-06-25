import { readFileSync } from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { buildDebugBundle } from "@/lib/debug-bundle";
import { getCachedSessionFile, resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function packageVersion(packagePath: string): string {
  try {
    return JSON.parse(readFileSync(packagePath, "utf8")).version as string;
  } catch {
    return "unknown";
  }
}

function firstMessage(snapshot: ReturnType<typeof getCachedSessionFile>): string | undefined {
  for (const entry of snapshot.entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const content = entry.message.content;
    if (typeof content === "string") return content;
    const text = content.find((block) => block.type === "text");
    return text?.text;
  }
  return undefined;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const snapshot = getCachedSessionFile(filePath);
    const header = snapshot.header;
    if (!header) {
      return NextResponse.json({ error: "Session has no valid header" }, { status: 400 });
    }

    const allowedRoots = await getAllowedRoots();
    if (header.cwd && !isPathAllowed(header.cwd, allowedRoots)) {
      return NextResponse.json({ error: "Session workspace is outside allowed roots" }, { status: 403 });
    }

    const root = process.cwd();
    const appVersion = packageVersion(path.join(root, "package.json"));
    const piVersion = packageVersion(path.join(root, "node_modules/@earendil-works/pi-coding-agent/package.json"));
    const bundle = buildDebugBundle({
      sessionId: id,
      header,
      entries: snapshot.entries,
      sessionName: snapshot.sessionName,
      firstMessage: firstMessage(snapshot),
      appVersion,
      piVersion,
    });

    return new NextResponse(new Uint8Array(bundle.data), {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(bundle.data.length),
        "Cache-Control": "no-store",
        "Content-Disposition": contentDisposition(bundle.filename),
        "X-Debug-Bundle-Schema": String(bundle.manifest.schemaVersion),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
