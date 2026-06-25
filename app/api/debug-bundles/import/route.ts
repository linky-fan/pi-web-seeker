import { NextResponse } from "next/server";
import {
  DEBUG_BUNDLE_MAX_BYTES,
  importDebugBundle,
  isUploadedBundleFile,
} from "@/lib/debug-bundle";
import {
  cacheSessionPath,
  getSessionListIndex,
  invalidateSessionFileCache,
  invalidateSessionListCache,
} from "@/lib/session-reader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const confirmed = form.get("confirm") === "1";
    if (!confirmed) {
      return NextResponse.json({ error: "confirm is required" }, { status: 400 });
    }
    if (!isUploadedBundleFile(file)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Debug bundle is empty" }, { status: 400 });
    }
    if (file.size > DEBUG_BUNDLE_MAX_BYTES) {
      return NextResponse.json({ error: "Debug bundle is too large" }, { status: 413 });
    }

    const index = await getSessionListIndex({ force: true });
    const existingIds = new Set(index.sessions.map((session) => session.id));
    const data = Buffer.from(await file.arrayBuffer());
    const imported = importDebugBundle(data, existingIds);

    invalidateSessionFileCache(imported.sessionFilePath);
    invalidateSessionListCache();
    cacheSessionPath(imported.session.id, imported.sessionFilePath);

    return NextResponse.json({
      ok: true,
      session: imported.session,
      targetCwd: imported.targetCwd,
      restoredFiles: imported.restoredFiles,
      restoredBytes: imported.restoredBytes,
      warnings: imported.warnings,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

