import { NextResponse } from "next/server";
import { assertPathAllowed } from "@/lib/allowed-roots";
import { browserPackageStatus } from "@/lib/browser-package";
import { getOpenCliRuntime } from "@/pi-packages/pi-opencli/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  try {
    const status = await getOpenCliRuntime().status(searchParams.get("refresh") === "1");
    if (!cwd) return NextResponse.json(status);
    await assertPathAllowed(cwd);
    const packageStatus = await browserPackageStatus(cwd);
    return NextResponse.json({
      ...status,
      packageConfigured: packageStatus.configured,
      packageLoaded: packageStatus.loaded,
      packageExists: packageStatus.packageExists,
      packageErrors: packageStatus.errors,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: message === "Access denied" ? 403 : 500 });
  }
}
