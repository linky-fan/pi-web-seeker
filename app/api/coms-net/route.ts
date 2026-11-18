import { NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync, chmodSync } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { DefaultResourceLoader, getAgentDir, type PackageSource } from "@earendil-works/pi-coding-agent";
import { assertPathAllowed } from "@/lib/allowed-roots";
import { ComsNetInputError, comsNetProjectDir } from "@/lib/coms-net-project";
import { createScanCache } from "@/lib/scan-cache";
import { isProjectTrustedForLoad, createTrustAwareSettingsManager, reloadResourceLoaderWithTrust } from "@/lib/project-trust";

export const dynamic = "force-dynamic";

const PACKAGE_ID = "pi-coms-net";
const PACKAGE_RELATIVE_PATH = "pi-packages/pi-coms-net";
const COMS_NET_TOOLS = new Set(["coms_net_list", "coms_net_send", "coms_net_get", "coms_net_await", "query_experts"]);
const EXTENSION_SCAN_TTL_MS = 5_000;

interface ComsNetExtensionScan {
  extensions: Array<{ path: string; resolvedPath: string; tools: string[]; commands: string[] }>;
  errors: Array<{ path: string; error: string }>;
  cwd: string;
}

declare global {
  // Reloading the resource loader re-resolves every package, so cache the scan briefly.
  var __piComsNetExtensionCache: ReturnType<typeof createComsNetScanCache> | undefined;
}

function createComsNetScanCache() {
  return createScanCache<ComsNetExtensionScan>(EXTENSION_SCAN_TTL_MS);
}

function extensionScanCache() {
  if (!globalThis.__piComsNetExtensionCache) globalThis.__piComsNetExtensionCache = createComsNetScanCache();
  return globalThis.__piComsNetExtensionCache;
}

interface ServerRegistry {
  project?: string;
  local_url?: string;
  public_url?: string;
  started_at?: string;
  pid?: number;
}

function packagePath() {
  return join(process.env.PI_WEB_APP_ROOT || process.cwd(), PACKAGE_RELATIVE_PATH);
}

function installCommands() {
  const localPath = packagePath();
  return [
    { label: "This pi-web server", command: `./node_modules/.bin/pi install "${localPath}"` },
    { label: "Global pi on server", command: `pi install "${localPath}"` },
    { label: "Docker Compose", command: `docker compose exec pi-web-seeker node_modules/.bin/pi install /app/${PACKAGE_RELATIVE_PATH}` },
  ];
}

function packageSourceValue(source: PackageSource): string {
  return typeof source === "string" ? source : source.source;
}

function packageAlreadyEnabled(source: string, packages: PackageSource[]) {
  return packages.some((entry) => {
    const value = packageSourceValue(entry);
    return value === source || isComsNetSource(value);
  });
}

async function enableBuiltInPackage(cwd: string, agentDir: string, confirmGlobal: boolean) {
  const source = packagePath();
  if (!existsSync(source)) throw new Error(`Built-in package not found: ${source}`);
  // Writes global settings only, so it does not create project resources that need trust.
  const settings = createTrustAwareSettingsManager(cwd, agentDir);
  const packages = settings.getPackages();
  if (!packageAlreadyEnabled(source, packages)) {
    if (!confirmGlobal) {
      // Enabling changes every workspace on this server, so require an explicit acknowledgement.
      throw new GlobalActionConfirmationError();
    }
    settings.setPackages([...packages, source]);
    await settings.flush();
  }
  return source;
}

class GlobalActionConfirmationError extends Error {
  readonly code = "GLOBAL_CONFIRMATION_REQUIRED";

  constructor() {
    super("Enabling coms-net updates global settings for every workspace on this server");
    this.name = "GlobalActionConfirmationError";
  }
}

function hubCommands() {
  return [
    { label: "Local test", command: "npm run coms-net:server" },
    {
      label: "LAN hub",
      command: "PI_COMS_NET_HOST=0.0.0.0 PI_COMS_NET_PORT=52965 PI_COMS_NET_PUBLIC_URL=http://<LAN-IP>:52965 PI_COMS_NET_AUTH_TOKEN=<long-random-token> npm run coms-net:server",
    },
    {
      label: "Remote agent",
      command: "PI_COMS_NET_SERVER_URL=http://<LAN-IP>:52965 PI_COMS_NET_AUTH_TOKEN=<long-random-token> pi --cname planner --purpose \"planning and code review\"",
    },
  ];
}

function readConfiguredPackages(agentDir: string, cwd: string): string[] {
  const files = [join(agentDir, "settings.json")];
  if (isProjectTrustedForLoad(cwd)) files.push(join(cwd, ".pi", "agent", "settings.json"));
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
      // Ignore malformed settings here; extension loader reports load errors.
    }
  }

  return packages;
}

function isComsNetSource(value: string): boolean {
  return value.includes(PACKAGE_ID) || value.includes(PACKAGE_RELATIVE_PATH) || value.includes("coms-net");
}

function projectsRoot(): string {
  return join(homedir(), ".pi", "coms-net", "projects");
}

function readRegistry(project = "default"): ServerRegistry | null {
  const file = join(comsNetProjectDir(projectsRoot(), project), "server.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as ServerRegistry;
  } catch {
    return null;
  }
}

function readClient(project = "default"): { server_url?: string } | null {
  const file = join(comsNetProjectDir(projectsRoot(), project), "client.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as { server_url?: string };
  } catch {
    return null;
  }
}

async function assertWorkspaceCwd(cwd: string): Promise<string> {
  const resolved = resolve(cwd);
  if (!existsSync(resolved)) throw new ComsNetInputError("cwd does not exist");
  if (!statSync(resolved).isDirectory()) throw new ComsNetInputError("cwd is not a directory");
  try {
    await assertPathAllowed(resolved);
  } catch {
    throw new ComsNetInputError("Access denied");
  }
  return resolved;
}

function writeJsonAtomic(filePath: string, data: unknown, mode: number) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode });
  renameSync(tmp, filePath);
  chmodSync(filePath, mode);
}

function saveClientConfig(project: string, serverUrl: string, authToken: string) {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new ComsNetInputError("Hub URL is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ComsNetInputError("Hub URL must start with http:// or https://");
  if (!authToken.trim()) throw new ComsNetInputError("Auth token is required");
  const dir = comsNetProjectDir(projectsRoot(), project);
  writeJsonAtomic(join(dir, "client.json"), { project, server_url: url.toString().replace(/\/$/, "") }, 0o644);
  writeJsonAtomic(join(dir, "client.secret.json"), { token: authToken.trim() }, 0o600);
}

async function checkHub(registry: ServerRegistry | null) {
  const url = registry?.public_url || registry?.local_url;
  if (!url) return { running: false, url: null as string | null, error: null as string | null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(new URL("/health", url), { signal: controller.signal });
    const body = await res.json().catch(() => null) as { ok?: boolean; server_id?: string } | null;
    return {
      running: res.ok && body?.ok === true,
      url,
      serverId: body?.server_id,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (error) {
    return { running: false, url, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Cache key covers everything the scan depends on, including the trust decision. */
function extensionScanKey(cwd: string, agentDir: string): string {
  return extensionScanCache().key([agentDir, cwd, isProjectTrustedForLoad(cwd)]);
}

/** Drops cached scans for one workspace, or every workspace when cwd is omitted. */
export function forgetComsNetExtensionScan(cwd?: string): void {
  extensionScanCache().forget(cwd);
}

async function scanComsNetExtensions(cwd: string, agentDir: string, force = false): Promise<ComsNetExtensionScan> {
  const cache = extensionScanCache();
  const key = extensionScanKey(cwd, agentDir);
  if (!force) {
    const cached = cache.get(key);
    if (cached) return cached;
  }

  const loader = new DefaultResourceLoader({ cwd, agentDir });
  await reloadResourceLoaderWithTrust(loader, cwd);
  const extensions = loader.getExtensions();
  const scan: ComsNetExtensionScan = {
    extensions: extensions.extensions
      .filter((extension) => isComsNetSource(extension.path) || isComsNetSource(extension.resolvedPath) || Array.from(extension.tools.keys()).some((tool) => COMS_NET_TOOLS.has(tool)))
      .map((extension) => ({
        path: extension.path,
        resolvedPath: extension.resolvedPath,
        tools: Array.from(extension.tools.keys()),
        commands: Array.from(extension.commands.keys()),
      })),
    errors: extensions.errors.filter((error) => isComsNetSource(error.path) || isComsNetSource(error.error)),
    cwd,
  };
  extensionScanCache().set(key, scan);
  return scan;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawCwd = searchParams.get("cwd");
  if (!rawCwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const cwd = await assertWorkspaceCwd(rawCwd);
    const project = searchParams.get("project") || "default";
    const agentDir = getAgentDir();
    const configuredPackages = readConfiguredPackages(agentDir, cwd);
    const { extensions: comsNetExtensions, errors: comsNetErrors } = await scanComsNetExtensions(cwd, agentDir, searchParams.has("refresh"));
    const configured = configuredPackages.some(isComsNetSource);
    const registry = readRegistry(project);
    const client = readClient(project);
    const hub = await checkHub(client?.server_url ? { local_url: client.server_url } : registry);

    return NextResponse.json({
      packageName: PACKAGE_ID,
      packagePath: packagePath(),
      packageExists: existsSync(packagePath()),
      configured,
      installed: configured || comsNetExtensions.length > 0,
      loaded: comsNetExtensions.length > 0,
      configuredPackages,
      extensions: comsNetExtensions,
      errors: comsNetErrors,
      hub: {
        project,
        registry,
        client,
        ...hub,
      },
      installCommands: installCommands(),
      hubCommands: hubCommands(),
      runtime: {
        cwd,
        agentDir,
        docker: existsSync("/.dockerenv") || process.env.PI_WEB_SINGLE_WORKSPACE === "1",
      },
    });
  } catch (e) {
    if (e instanceof ComsNetInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(e), installCommands: installCommands(), hubCommands: hubCommands() }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { action?: string; cwd?: string; project?: string; serverUrl?: string; authToken?: string; confirmGlobal?: boolean };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    const cwd = await assertWorkspaceCwd(body.cwd);
    const agentDir = getAgentDir();
    const confirmGlobal = body.confirmGlobal === true;

    if (body.action === "enable") {
      const source = await enableBuiltInPackage(cwd, agentDir, confirmGlobal);
      // Settings changed, so the cached scan no longer reflects what would load.
      forgetComsNetExtensionScan(cwd);
      return NextResponse.json({ ok: true, packagePath: source });
    }

    if (body.action === "connect") {
      const project = body.project?.trim() || "default";
      if (!body.serverUrl) return NextResponse.json({ error: "serverUrl required" }, { status: 400 });
      // Enable first so a missing global acknowledgement writes no hub credentials.
      await enableBuiltInPackage(cwd, agentDir, confirmGlobal);
      forgetComsNetExtensionScan(cwd);
      saveClientConfig(project, body.serverUrl, body.authToken ?? "");
      return NextResponse.json({ ok: true, project });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    if (e instanceof GlobalActionConfirmationError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 409 });
    }
    if (e instanceof ComsNetInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
