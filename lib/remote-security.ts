import type { RemoteDeviceMode, RemoteHostType } from "./remote-types";

// The automatic policy is deliberately a grammar whitelist.  A command may be
// perfectly legitimate yet still require approval; this is safer than trying
// to enumerate every dangerous shell or platform-specific option.
const SHELL_OR_CONTROL_RE = /[\x00-\x1f\x7f]|[;&|><`'"$\\(){}\[\]*?~]/;
const SENSITIVE_TOKEN_RE = /(?:^|\s)(?:sudo|su|enable|configure|conf\s+t|write|copy\s+run|commit|save|delete|erase|format|reload|reboot|restart|shutdown|poweroff|halt|rm|mv|chmod|chown|kill|pkill|systemctl|service|apt|yum|dnf|apk|npm|pnpm|yarn|pip)(?:\s|$)/i;
const SAFE_READ_TOKEN_RE = /^[A-Za-z0-9_./:@%+=,-]+$/;

const LINUX_SIMPLE_READ = new Set([
  "uname", "uptime", "who", "whoami", "id", "df", "du", "free", "ps", "ss", "netstat",
  "cat", "head", "tail", "grep", "ls", "pwd", "stat", "wc", "ping", "traceroute", "tracert",
]);
const FREEBSD_SIMPLE_READ = new Set([
  "uname", "freebsd-version", "uptime", "who", "whoami", "id", "df", "du", "ps", "top",
  "sockstat", "netstat", "dmesg", "cat", "head", "tail", "grep", "ls", "pwd", "stat", "wc",
  "ping", "traceroute", "drill", "host",
]);
const WINDOWS_SIMPLE_READ = new Set([
  "ver", "whoami", "hostname", "systeminfo", "netstat", "tasklist", "driverquery",
  "get-computerinfo", "get-ciminstance", "get-process", "get-service", "get-childitem", "get-item",
  "get-netadapter", "get-netipaddress", "get-netroute", "get-nettcpconnection",
  "get-winevent", "test-path", "test-connection", "resolve-dnsname",
]);
const NETWORK_READ_ENTRIES = new Set(["show", "display", "get", "ping", "traceroute", "tracert"]);
const HOSTNAME_READ_FLAGS = new Set(["-a", "--alias", "-A", "--all-fqdns", "-d", "--domain", "-f", "--fqdn", "--long", "-i", "--ip-address", "-I", "--all-ip-addresses", "-s", "--short", "-y", "--yp", "--nis"]);

function readArgs(tokens: string[]): boolean {
  return tokens.every((token) => SAFE_READ_TOKEN_RE.test(token));
}

function executable(tokens: string[]): string {
  return (tokens[0] ?? "").toLowerCase().replace(/\.exe$/, "");
}

function isReadOnlyLinuxCommand(tokens: string[]): boolean {
  const command = executable(tokens);
  const args = tokens.slice(1);
  if (LINUX_SIMPLE_READ.has(command)) return readArgs(args);
  if (command === "date") {
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg.startsWith("+") || ["-u", "--utc", "-R", "--rfc-email"].includes(arg) || arg.startsWith("-I") || arg.startsWith("--iso-8601") || arg.startsWith("--date=") || arg.startsWith("--reference=") || arg.startsWith("--rfc-3339=")) continue;
      if (["-d", "--date", "-r", "--reference"].includes(arg) && index + 1 < args.length && SAFE_READ_TOKEN_RE.test(args[index + 1])) { index += 1; continue; }
      return false;
    }
    return true;
  }
  if (command === "hostname") return args.every((arg) => HOSTNAME_READ_FLAGS.has(arg));
  if (command !== "ip") return false;
  let cursor = 1;
  while (["-4", "-6", "-br", "-brief", "-c", "-color", "-o", "-oneline"].includes(args[cursor - 1] ?? "")) cursor += 1;
  const object = args[cursor - 1]?.toLowerCase();
  const verb = args[cursor]?.toLowerCase();
  if (!object || !verb || !["addr", "address", "link", "route", "neigh", "neighbor"].includes(object) || !["show", "list"].includes(verb)) return false;
  return readArgs(args.slice(cursor + 1));
}

function isReadOnlyFreeBsdCommand(tokens: string[]): boolean {
  const command = executable(tokens);
  const args = tokens.slice(1);
  if (FREEBSD_SIMPLE_READ.has(command)) return readArgs(args);
  if (command === "ifconfig") return args.length <= 1 && (args.length === 0 || /^[A-Za-z0-9_.:-]+$/.test(args[0]));
  if (command === "sysctl") return (args.length === 1 && (args[0] === "-a" || (/^[A-Za-z0-9_.:-]+$/.test(args[0]) && !args[0].includes("="))));
  if (command === "pkg") return ["info", "version"].includes(args[0]?.toLowerCase() ?? "") && readArgs(args.slice(1));
  return false;
}

function isReadOnlyWindowsCommand(tokens: string[]): boolean {
  const command = executable(tokens);
  const args = tokens.slice(1);
  if (WINDOWS_SIMPLE_READ.has(command)) return readArgs(args);
  if (command === "ipconfig") return args.length === 0 || (args.length === 1 && ["/all", "/displaydns", "/?"].includes(args[0].toLowerCase()));
  if (command === "sc") return ["query", "queryex", "qc", "qdescription", "qfailure"].includes(args[0]?.toLowerCase() ?? "") && readArgs(args.slice(1));
  return false;
}

function isReadOnlyCiscoCommand(tokens: string[]): boolean {
  const command = executable(tokens);
  const args = tokens.slice(1);
  if (command === "ping" || command === "traceroute") return readArgs(args);
  if (command !== "show") return false;
  const subject = args[0]?.toLowerCase();
  if (subject && ["running", "startup", "tech"].some((sensitive) => sensitive.startsWith(subject) || subject.startsWith(sensitive))) return false;
  return readArgs(args);
}

function isReadOnlyNetworkCommand(tokens: string[]): boolean {
  return NETWORK_READ_ENTRIES.has(executable(tokens)) && readArgs(tokens.slice(1));
}

/**
 * Returns a conservative type only when the banner has one coherent identity.
 * Cisco NX-OS banners commonly include the word Linux, which is product
 * information rather than a conflicting command policy.
 */
export function detectRemoteHostType(output: string): RemoteHostType {
  const value = output.slice(0, 4 * 1024);
  const cisco = /\bCisco\b|Cisco IOS|IOS[- ]XE|NX-OS|Adaptive Security Appliance/i.test(value);
  const freebsd = /\bFreeBSD\b/i.test(value);
  const linux = /\bLinux\b/i.test(value);
  const windows = /Microsoft Windows|Windows (?:Server|NT)|\bMicrosoft Corporation\b/i.test(value);
  if (cisco) return freebsd || windows ? "unknown" : "cisco";
  const matches = [freebsd && "freebsd", linux && "linux", windows && "windows"].filter(Boolean) as RemoteHostType[];
  return matches.length === 1 ? matches[0] : "unknown";
}

export function isSensitiveRemoteCommand(
  command: string,
  intent: "observe" | "change" = "observe",
  deviceMode: RemoteDeviceMode | RemoteHostType = "linux",
): boolean {
  if (!command.trim() || intent === "change" || SHELL_OR_CONTROL_RE.test(command)) return true;
  const normalized = command.trim().replace(/\s+/g, " ");
  if (SENSITIVE_TOKEN_RE.test(normalized)) return true;
  const tokens = normalized.split(" ");
  if (!readArgs(tokens)) return true;
  if (deviceMode === "linux") return !isReadOnlyLinuxCommand(tokens);
  if (deviceMode === "freebsd") return !isReadOnlyFreeBsdCommand(tokens);
  if (deviceMode === "windows") return !isReadOnlyWindowsCommand(tokens);
  if (deviceMode === "cisco") return !isReadOnlyCiscoCommand(tokens);
  if (deviceMode === "network-generic" || deviceMode === "custom") return !isReadOnlyNetworkCommand(tokens);
  return true;
}

export function stripTerminalControls(value: string): string {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B[@-Z\\-_]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export function sanitizeRemoteTerminalOutput(value: string): string {
  return value.replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "");
}
