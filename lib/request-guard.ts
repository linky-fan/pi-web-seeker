export interface LocalRequestMetadata {
  method: string;
  url: string;
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  accessTokenConfigured: boolean;
}

export type LocalRequestRejection = "invalid-host" | "cross-origin" | "cross-site";

function normalizedHost(value: string): { authority: string; hostname: string } | null {
  if (!value || /[\s/@?#]/.test(value)) return null;
  try {
    const url = new URL(`http://${value}`);
    if (url.pathname !== "/" || url.search || url.hash) return null;
    return { authority: url.host.toLowerCase(), hostname: url.hostname.toLowerCase() };
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  const octets = hostname.split(".");
  return octets.length === 4
    && Number(octets[0]) === 127
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255);
}

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Returns a rejection reason for unauthenticated loopback requests, or null for trusted local traffic. */
export function localRequestRejection(metadata: LocalRequestMetadata): LocalRequestRejection | null {
  if (metadata.accessTokenConfigured) return null;

  let requestUrl: URL;
  try {
    requestUrl = new URL(metadata.url);
  } catch {
    return "invalid-host";
  }

  const requestHost = normalizedHost(metadata.host ?? "");
  if (!requestHost || !isLoopbackHostname(requestHost.hostname)) return "invalid-host";

  if (!requestUrl.pathname.startsWith("/api/") || !MUTATING_METHODS.has(metadata.method.toUpperCase())) return null;

  const fetchSite = metadata.secFetchSite?.trim().toLowerCase();
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) return "cross-site";

  const origin = metadata.origin?.trim();
  if (!origin) return null;
  if (origin === "null") return "cross-origin";

  try {
    const originUrl = new URL(origin);
    if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:") return "cross-origin";
    // Compare against the Host header: Next rewrites req.url's host to localhost, so
    // req.url.origin cannot distinguish a 127.0.0.1 page from a localhost one.
    const originHost = normalizedHost(originUrl.host);
    if (!originHost || originHost.authority !== requestHost.authority) return "cross-origin";
    return null;
  } catch {
    return "cross-origin";
  }
}