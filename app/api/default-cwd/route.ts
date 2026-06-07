import { NextResponse } from "next/server";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const dynamic = "force-dynamic";

// POST /api/default-cwd
// Creates ~/pi-cwd-<YYYYMMDD> if it doesn't exist and returns the path.
export async function POST() {
  try {
    const dir = process.env.PI_WEB_DEFAULT_CWD || (() => {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      return join(homedir(), `pi-cwd-${date}`);
    })();
    mkdirSync(dir, { recursive: true });
    return NextResponse.json({ cwd: dir });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
