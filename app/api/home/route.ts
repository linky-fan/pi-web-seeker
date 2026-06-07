import { NextResponse } from "next/server";
import { homedir } from "os";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    home: process.env.PI_WEB_HOME || homedir(),
    defaultCwd: process.env.PI_WEB_DEFAULT_CWD || null,
    singleWorkspace: process.env.PI_WEB_SINGLE_WORKSPACE === "1",
  });
}
