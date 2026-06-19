import { NextResponse } from "next/server";
import {
  getCachedSessionContext,
  getCachedSessionFile,
  getSessionParentId,
  resolveSessionPath,
} from "@/lib/session-reader";
import {
  buildJsonSessionExport,
  buildMarkdownSessionExport,
  sessionExportFilename,
} from "@/lib/session-export";

export const dynamic = "force-dynamic";

type ExportFormat = "markdown" | "json";

function exportFormat(value: string | null): ExportFormat {
  return value === "json" ? "json" : "markdown";
}

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
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

    const url = new URL(req.url);
    const format = exportFormat(url.searchParams.get("format"));
    const download = url.searchParams.get("download") !== "0";
    const requestedLeafId = url.searchParams.get("leafId");
    const snapshot = getCachedSessionFile(filePath);
    const leafId = requestedLeafId || snapshot.leafId;
    const context = getCachedSessionContext(snapshot, leafId);
    const modified = new Date(snapshot.mtimeMs).toISOString();
    const parentSessionId = await getSessionParentId(id);
    const header = snapshot.header;
    const info = header ? {
      id: header.id,
      cwd: header.cwd ?? "",
      name: snapshot.sessionName,
      created: header.timestamp,
      modified,
      messageCount: context.messages.length,
      firstMessage: context.messages.find((message) => message.role === "user")
        ? (() => {
            const message = context.messages.find((item) => item.role === "user")!;
            const content = message.content;
            return typeof content === "string"
              ? content
              : (content.find((block) => block.type === "text") as { text: string } | undefined)?.text ?? "";
          })() || "(no messages)"
        : "(no messages)",
      parentSessionId,
    } : null;

    const data = {
      sessionId: id,
      info,
      header,
      leafId,
      context,
      entries: snapshot.entries,
      exportedAt: new Date().toISOString(),
    };
    const extension = format === "json" ? "json" : "md";
    const body = format === "json" ? buildJsonSessionExport(data) : buildMarkdownSessionExport(data);

    const headers: Record<string, string> = {
      "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/markdown; charset=utf-8",
      "Cache-Control": "no-store",
    };
    if (download) {
      headers["Content-Disposition"] = contentDisposition(sessionExportFilename(data, extension));
    }

    return new NextResponse(body, {
      headers,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
