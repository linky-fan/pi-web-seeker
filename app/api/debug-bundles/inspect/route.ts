import { NextResponse } from "next/server";
import {
  DEBUG_BUNDLE_MAX_BYTES,
  inspectDebugBundle,
  isUploadedBundleFile,
} from "@/lib/debug-bundle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!isUploadedBundleFile(file)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "Debug bundle is empty" }, { status: 400 });
    }
    if (file.size > DEBUG_BUNDLE_MAX_BYTES) {
      return NextResponse.json({ error: "Debug bundle is too large" }, { status: 413 });
    }
    const data = Buffer.from(await file.arrayBuffer());
    const summary = inspectDebugBundle(data);
    return NextResponse.json({ ok: true, summary });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

