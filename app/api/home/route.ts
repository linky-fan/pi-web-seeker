import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { homedir } from "os";

export const dynamic = "force-dynamic";

function isDockerRuntime(): boolean {
  return existsSync("/.dockerenv") || process.env.PI_WEB_SINGLE_WORKSPACE === "1";
}

export async function GET() {
  const docker = isDockerRuntime();
  const platform = process.platform;
  return NextResponse.json({
    home: process.env.PI_WEB_HOME || homedir(),
    defaultCwd: process.env.PI_WEB_DEFAULT_CWD || null,
    singleWorkspace: process.env.PI_WEB_SINGLE_WORKSPACE === "1",
    platform,
    docker,
    nativeDirectoryPicker: !docker && (platform === "darwin" || platform === "win32"),
  });
}
