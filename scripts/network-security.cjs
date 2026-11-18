"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isIP } = require("node:net");

function isLoopbackHost(host) {
  const normalized = String(host ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized === "::1") return true;
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  return false;
}

function assertNetworkAccessConfigured(host, accessToken) {
  if (isLoopbackHost(host) || String(accessToken ?? "").trim()) return;

  throw new Error(
    `PI_WEB_ACCESS_TOKEN is required when binding to non-loopback host "${host}". ` +
    "Use localhost for local-only access or configure a long random token."
  );
}

function browserLaunchUrl(host, port, accessToken) {
  const normalizedHost = String(host ?? "").trim().replace(/^\[|\]$/g, "");
  const openHost = normalizedHost === [0, 0, 0, 0].join(".") || normalizedHost === "::" ? "localhost" : normalizedHost;
  const browserHost = openHost.includes(":") ? `[${openHost}]` : openHost;
  const token = String(accessToken ?? "").trim();
  return `http://${browserHost}:${port}${token ? `/?token=${encodeURIComponent(token)}` : ""}`;
}

module.exports = { assertNetworkAccessConfigured, browserLaunchUrl, isLoopbackHost };
