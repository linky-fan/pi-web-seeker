import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

const PACKAGE_NAME = "@tintinweb/pi-subagents";
const INSTALL_COMMAND = "npx --no-install pi install npm:@tintinweb/pi-subagents";

function installCommands() {
  return [
    { label: "Local checkout", command: INSTALL_COMMAND },
    { label: "Direct bin", command: "node_modules/.bin/pi install npm:@tintinweb/pi-subagents" },
    { label: "Docker Compose", command: "docker compose exec pi-web node_modules/.bin/pi install npm:@tintinweb/pi-subagents" },
  ];
}

function readConfiguredPackages(agentDir: string, cwd: string): string[] {
  const files = [
    join(agentDir, "settings.json"),
    join(cwd, ".pi", "agent", "settings.json"),
  ];
  const packages: string[] = [];

  for (const file of files) {
    if (!existsSync(file)) continue;
    try {
      const settings = JSON.parse(readFileSync(file, "utf8")) as { packages?: unknown[] };
      for (const entry of settings.packages ?? []) {
        if (typeof entry === "string") packages.push(entry);
        else if (entry && typeof entry === "object" && "source" in entry) {
          const source = (entry as { source?: unknown }).source;
          if (typeof source === "string") packages.push(source);
        }
      }
    } catch {
      // Ignore malformed settings here; the resource loader reports load errors separately.
    }
  }

  return packages;
}

function isSubagentSource(value: string): boolean {
  return value.includes("pi-subagents") || value.includes(PACKAGE_NAME);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const agentDir = getAgentDir();
    const configuredPackages = readConfiguredPackages(agentDir, cwd);
    const loader = new DefaultResourceLoader({ cwd, agentDir });
    await loader.reload();
    const extensions = loader.getExtensions();
    const subagentExtensions = extensions.extensions
      .filter((extension) => isSubagentSource(extension.path) || isSubagentSource(extension.resolvedPath))
      .map((extension) => ({
        path: extension.path,
        resolvedPath: extension.resolvedPath,
        tools: Array.from(extension.tools.keys()),
        commands: Array.from(extension.commands.keys()),
        messageRenderers: Array.from(extension.messageRenderers.keys()),
      }));
    const subagentErrors = extensions.errors.filter((error) => isSubagentSource(error.path) || isSubagentSource(error.error));
    const configured = configuredPackages.some(isSubagentSource);

    return NextResponse.json({
      packageName: PACKAGE_NAME,
      installCommand: INSTALL_COMMAND,
      installCommands: installCommands(),
      configured,
      installed: configured || subagentExtensions.length > 0,
      loaded: subagentExtensions.length > 0,
      configuredPackages,
      extensions: subagentExtensions,
      errors: subagentErrors,
      runtime: {
        cwd,
        agentDir,
        docker: existsSync("/.dockerenv") || process.env.PI_WEB_SINGLE_WORKSPACE === "1",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e), installCommand: INSTALL_COMMAND, installCommands: installCommands() }, { status: 500 });
  }
}
