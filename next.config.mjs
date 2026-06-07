import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const configDir = dirname(fileURLToPath(import.meta.url));

const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8"));
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = JSON.parse(readFileSync(piPkgPath, "utf8")).version;
} catch {
  // package not found, use default
}

const protectedWindowsProfileJunctions = [
  "**/Application Data",
  "**/Application Data/**",
  "**/ApplicationData",
  "**/ApplicationData/**",
  "**/Cookies",
  "**/Cookies/**",
  "**/Local Settings",
  "**/Local Settings/**",
  "**/My Documents",
  "**/My Documents/**",
  "**/NetHood",
  "**/NetHood/**",
  "**/PrintHood",
  "**/PrintHood/**",
  "**/Recent",
  "**/Recent/**",
  "**/SendTo",
  "**/SendTo/**",
  "**/Start Menu",
  "**/Start Menu/**",
  "**/Templates",
  "**/Templates/**",
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
  outputFileTracingRoot: configDir,
  turbopack: {
    root: configDir,
  },
  outputFileTracingExcludes: {
    "*": protectedWindowsProfileJunctions,
  },
  webpack: (config) => {
    config.watchOptions = {
      ...(config.watchOptions ?? {}),
      ignored: protectedWindowsProfileJunctions,
    };
    return config;
  },
  allowedDevOrigins: [
    "127.*.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
    "192.168.*.*",
  ],
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
