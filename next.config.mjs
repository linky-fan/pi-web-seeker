import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const configDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { assertNetworkAccessConfigured } = require("./scripts/network-security.cjs");

function requestedHostname(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "-H" || args[i] === "--hostname") return args[i + 1];
    if (args[i].startsWith("--hostname=")) return args[i].slice("--hostname=".length);
  }
  return undefined;
}

const nextArgs = process.argv.slice(2);
const nextCommand = nextArgs.find((arg) => arg === "dev" || arg === "start");
if (nextCommand) {
  const hostname = requestedHostname(nextArgs) ?? process.env.PI_WEB_BIND_HOST ?? "localhost";
  assertNetworkAccessConfigured(hostname, process.env.PI_WEB_ACCESS_TOKEN);
}

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
  agentRules: false,
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    "ssh2",
    "telnet-client",
  ],
  devIndicators: false,
  outputFileTracingRoot: configDir,
  experimental: {
    proxyClientMaxBodySize: "250mb",
  },
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
