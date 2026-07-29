import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { assertPathAllowed } from "@/lib/allowed-roots";
import { createAppModelRuntime } from "@/lib/model-registry";
import {
  BUILTIN_CODING_TOOL_NAMES,
  DEFAULT_ACTIVE_TOOL_NAMES,
  filterKnownToolNames,
  getLoadedExtensionToolNames,
  readActiveTools,
  uniqueToolNames,
  writeActiveTools,
} from "@/lib/tool-settings";

export const dynamic = "force-dynamic";

interface ToolToggleEntry {
  name: string;
  description: string;
  active: boolean;
}

async function enumerateTools(cwd: string, agentDir: string): Promise<ToolToggleEntry[]> {
  if (!cwd || !existsSync(cwd)) return [];

  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
  await resourceLoader.reload();
  const extensionToolNames = getLoadedExtensionToolNames(resourceLoader);
  const registeredToolNames = uniqueToolNames([...BUILTIN_CODING_TOOL_NAMES, ...extensionToolNames]);
  const sessionManager = SessionManager.create(cwd, undefined);
  const modelRuntime = await createAppModelRuntime();
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    resourceLoader,
    modelRuntime,
    tools: registeredToolNames,
  });

  try {
    const toolEntries = session.getAllTools?.() ?? [];
    const allToolNames = toolEntries.map((tool) => tool.name);
    const savedActiveTools = readActiveTools(agentDir);
    const activeSet = new Set(
      savedActiveTools === null
        ? filterKnownToolNames(uniqueToolNames([...DEFAULT_ACTIVE_TOOL_NAMES, ...extensionToolNames]), allToolNames)
        : filterKnownToolNames(savedActiveTools, allToolNames)
    );

    return toolEntries.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      active: activeSet.has(tool.name),
    }));
  } finally {
    (session as { dispose?: () => void }).dispose?.();
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  const agentDir = getAgentDir();
  const activeTools = readActiveTools(agentDir);

  if (!cwd) return NextResponse.json({ config: { activeTools }, tools: [] });

  try {
    await assertPathAllowed(cwd);
  } catch {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const tools = await enumerateTools(cwd, agentDir);
    return NextResponse.json({ config: { activeTools }, tools });
  } catch (e) {
    return NextResponse.json({ error: String(e), config: { activeTools }, tools: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { activeTools?: unknown };
    if (!Array.isArray(body.activeTools)) {
      return NextResponse.json({ error: "activeTools must be an array" }, { status: 400 });
    }
    const activeTools = body.activeTools.filter((tool): tool is string => typeof tool === "string");
    writeActiveTools(getAgentDir(), activeTools);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
