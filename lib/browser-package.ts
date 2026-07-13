import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  DefaultResourceLoader,
  SettingsManager,
  getAgentDir,
  type PackageSource,
} from "@earendil-works/pi-coding-agent";

const PACKAGE_ID = "pi-opencli";
const PACKAGE_RELATIVE_PATH = "pi-packages/pi-opencli";
const TOOL_PREFIX = "opencli_browser_";

export function browserPackagePath(): string {
  return join(process.env.PI_WEB_APP_ROOT || process.cwd(), PACKAGE_RELATIVE_PATH);
}

function packageSourceValue(source: PackageSource): string {
  return typeof source === "string" ? source : source.source;
}

function isBrowserPackageSource(value: string): boolean {
  return value.includes(PACKAGE_ID) || value.includes(PACKAGE_RELATIVE_PATH) || value.includes("pi-web-opencli");
}

export async function browserPackageStatus(cwd: string): Promise<{ configured: boolean; loaded: boolean; packageExists: boolean; errors: string[] }> {
  const agentDir = getAgentDir();
  const settings = SettingsManager.create(cwd, agentDir);
  const configured = settings.getPackages().some((entry) => isBrowserPackageSource(packageSourceValue(entry)));
  const loader = new DefaultResourceLoader({ cwd, agentDir });
  await loader.reload();
  const extensions = loader.getExtensions();
  const loaded = extensions.extensions.some((extension) => Array.from(extension.tools.keys()).some((name) => name.startsWith(TOOL_PREFIX)));
  const errors = extensions.errors
    .filter((error) => isBrowserPackageSource(error.path) || isBrowserPackageSource(error.error))
    .map((error) => `${error.path}: ${error.error}`);
  return { configured, loaded, packageExists: existsSync(browserPackagePath()), errors };
}

export async function enableBrowserPackage(cwd: string): Promise<string> {
  const source = browserPackagePath();
  if (!existsSync(source)) throw new Error(`Built-in browser package not found: ${source}`);
  const settings = SettingsManager.create(cwd, getAgentDir(), { projectTrusted: true });
  const packages = settings.getPackages();
  if (!packages.some((entry) => isBrowserPackageSource(packageSourceValue(entry)))) {
    const projectPackages = settings.getProjectSettings().packages ?? [];
    settings.setProjectPackages([...projectPackages, source]);
    await settings.flush();
  }
  return source;
}
