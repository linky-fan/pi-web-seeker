import { execFile } from "child_process";
import { existsSync, statSync } from "fs";
import path from "path";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { registerWorkspaceRoot } from "@/lib/workspace-roots";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

function isDockerRuntime(): boolean {
  return existsSync("/.dockerenv") || process.env.PI_WEB_SINGLE_WORKSPACE === "1";
}

function isDirectory(dirPath: string): boolean {
  try {
    return statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

async function pickDirectoryWithFinder(): Promise<string | null> {
  const script = [
    'set selectedFolder to choose folder with prompt "Choose a project directory for Pi Web Seeker"',
    "POSIX path of selectedFolder",
  ].join("\n");
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", script], {
    timeout: 10 * 60_000,
    maxBuffer: 1024 * 1024,
  });
  const selected = stdout.trim();
  return selected || null;
}

async function pickDirectoryWithExplorer(): Promise<string | null> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    '$dialog.Description = "Choose a project directory for Pi Web Seeker"',
    "$dialog.ShowNewFolderButton = $true",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "  Write-Output $dialog.SelectedPath",
    "}",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    timeout: 10 * 60_000,
    maxBuffer: 1024 * 1024,
    windowsHide: false,
  });
  const selected = stdout.trim();
  return selected || null;
}

export async function POST() {
  try {
    if (isDockerRuntime()) {
      return NextResponse.json({ error: "Native directory picker is not available in Docker" }, { status: 400 });
    }

    const selected = process.platform === "darwin"
      ? await pickDirectoryWithFinder()
      : process.platform === "win32"
        ? await pickDirectoryWithExplorer()
        : null;

    if (!selected) {
      return NextResponse.json({ cancelled: true });
    }

    const cwd = path.resolve(selected);
    if (!isDirectory(cwd)) {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }

    const allowedRoots = await getAllowedRoots();
    allowedRoots.add(cwd);
    if (!isPathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    registerWorkspaceRoot(cwd);
    globalThis.__piAllowedRootsCache?.roots.add(cwd);
    return NextResponse.json({ cwd });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("User canceled") || message.includes("cancelled")) {
      return NextResponse.json({ cancelled: true });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
