import { existsSync } from "node:fs";
import { join } from "node:path";
import { DefaultResourceLoader, SettingsManager, getAgentDir, type PackageSource } from "@earendil-works/pi-coding-agent";

const PACKAGE_ID = "pi-remote-exec";
const PACKAGE_RELATIVE_PATH = "pi-packages/pi-remote-exec";
const TOOL_PREFIX = "remote_";

export function remotePackagePath(): string {
  return join(process.env.PI_WEB_APP_ROOT || process.cwd(), PACKAGE_RELATIVE_PATH);
}

function sourceValue(source: PackageSource): string {
  return typeof source === "string" ? source : source.source;
}

function isRemoteSource(value: string): boolean {
  return value.includes(PACKAGE_ID) || value.includes(PACKAGE_RELATIVE_PATH) || value.includes("pi-web-remote-exec");
}

export async function remotePackageStatus(cwd: string): Promise<{ configured: boolean; loaded: boolean; packageExists: boolean; errors: string[] }> {
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(cwd, agentDir);
  const configured = settings.getPackages().some((entry) => isRemoteSource(sourceValue(entry)));
  const loader = new DefaultResourceLoader({ cwd, agentDir });
  await loader.reload();
  const extensions = loader.getExtensions();
  const loaded = extensions.extensions.some((extension) => Array.from(extension.tools.keys()).some((name) => name.startsWith(TOOL_PREFIX)));
  const errors = extensions.errors.filter((error) => isRemoteSource(error.path) || isRemoteSource(error.error)).map((error) => `${error.path}: ${error.error}`);
  return { configured, loaded, packageExists: existsSync(remotePackagePath()), errors };
}

export async function enableRemotePackage(cwd: string): Promise<string> {
  const source = remotePackagePath();
  if (!existsSync(source)) throw new Error(`Built-in remote package not found: ${source}`);
  const settings = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: true });
  const packages = settings.getPackages();
  if (!packages.some((entry) => isRemoteSource(sourceValue(entry)))) {
    settings.setProjectPackages([...(settings.getProjectSettings().packages ?? []), source]);
    await settings.flush();
  }
  return source;
}
