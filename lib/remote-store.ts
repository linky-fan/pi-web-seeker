import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { RemoteDeviceMode, RemoteProfile, RemotePromptPreset } from "./remote-types";

const PROFILE_FILE = "remote-targets.json";
const HOST_KEY_FILE = "remote-known-hosts.json";
const MAX_LITERAL_LENGTH = 256;
const SAFE_HOST_RE = /^(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9._:-]+)$/;
const DEVICE_MODES = new Set<RemoteDeviceMode>(["auto", "cisco", "freebsd", "linux", "windows", "network-generic", "custom"]);
const PROMPT_PRESETS = new Set<RemotePromptPreset>(["unix", "windows", "cisco", "network"]);
const LEGACY_UNIX_PROMPT = "(?:^|\\n)[^\\r\\n]*[$#]\\s*$";
const LEGACY_NETWORK_PROMPT = "(?:^|\\n)[^\\r\\n]*[>#]\\s*$";
const LEGACY_PAGER = "(?:--More--|---- More ----|<--- More --->)";
const LEGACY_LOGIN = "(?:login|username)[: ]*$";
const LEGACY_PASSWORD = "password[: ]*$";

interface StoredProfiles { profiles: RemoteProfile[] }
interface StoredHostKeys { hosts: Record<string, string> }

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temp, path);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}

export function remoteProfilesPath(): string {
  return join(getAgentDir(), PROFILE_FILE);
}

export function remoteKnownHostsPath(): string {
  return join(getAgentDir(), HOST_KEY_FILE);
}

export function listRemoteProfiles(): RemoteProfile[] {
  return readJson<StoredProfiles>(remoteProfilesPath(), { profiles: [] }).profiles
    .filter((profile) => profile && typeof profile.id === "string")
    .map(normalizeStoredProfile)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function deviceMode(value: unknown): RemoteDeviceMode {
  return typeof value === "string" && DEVICE_MODES.has(value as RemoteDeviceMode) ? value as RemoteDeviceMode : "linux";
}

function defaultPromptPreset(mode: RemoteDeviceMode): RemotePromptPreset {
  if (mode === "windows") return "windows";
  if (mode === "cisco") return "cisco";
  if (mode === "network-generic" || mode === "custom") return "network";
  return "unix";
}

function legacyPromptPreset(value: unknown, mode: RemoteDeviceMode): { preset: RemotePromptPreset; rejected: boolean } {
  if (typeof value !== "string" || !value.trim()) return { preset: defaultPromptPreset(mode), rejected: false };
  const trimmed = value.trim();
  if (trimmed === LEGACY_UNIX_PROMPT) return { preset: "unix", rejected: false };
  if (trimmed === LEGACY_NETWORK_PROMPT) return { preset: mode === "cisco" ? "cisco" : "network", rejected: false };
  return { preset: defaultPromptPreset(mode), rejected: true };
}

function literal(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`Invalid ${name}`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_LITERAL_LENGTH || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmed)) throw new Error(`Invalid ${name}`);
  return trimmed;
}

function legacyLiteral(value: unknown, defaultValue: string, name: string): { value?: string; rejected: boolean } {
  if (value === undefined || value === null || value === "") return { rejected: false };
  if (value === defaultValue) return { rejected: false };
  const text = literal(value, name);
  // Earlier versions accepted JavaScript regular expressions. They must never
  // be compiled after migration; users can replace them with literal text.
  if (typeof value === "string" && /[\\()[\]{}|*+?^$]/.test(value)) return { rejected: true };
  return { value: text, rejected: false };
}

function keyPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const expanded = value.trim().startsWith("~/") ? join(homedir(), value.trim().slice(2)) : resolve(value.trim());
  const sshRoot = resolve(homedir(), ".ssh");
  if (expanded !== sshRoot && !expanded.startsWith(`${sshRoot}${sep}`)) throw new Error("SSH keys must be located under ~/.ssh");
  // Saving a target before a key has been provisioned is allowed. When the
  // file exists, resolve every symlink now; connect revalidates it again.
  if (!existsSync(expanded)) return expanded;
  const realRoot = realpathSync(sshRoot);
  const realKey = realpathSync(expanded);
  if (realKey !== realRoot && !realKey.startsWith(`${realRoot}${sep}`)) throw new Error("SSH key symlinks must stay under ~/.ssh");
  return realKey;
}

export function resolveRemoteKeyPath(value: unknown): string | undefined {
  return keyPath(value);
}

function normalizeStoredProfile(value: RemoteProfile): RemoteProfile {
  const raw = value as unknown as Record<string, unknown>;
  const protocol = raw.protocol === "telnet" ? "telnet" : "ssh";
  const mode = deviceMode(raw.deviceMode);
  const legacyPrompt = legacyPromptPreset(raw.promptPattern, mode);
  const explicitPreset = typeof raw.promptPreset === "string" && PROMPT_PRESETS.has(raw.promptPreset as RemotePromptPreset)
    ? raw.promptPreset as RemotePromptPreset
    : legacyPrompt.preset;
  const login = legacyLiteral(raw.loginPrompt, LEGACY_LOGIN, "login prompt");
  const password = legacyLiteral(raw.passwordPrompt, LEGACY_PASSWORD, "password prompt");
  const pager = raw.pagerText !== undefined
    ? { value: literal(raw.pagerText, "pager text"), rejected: false }
    : legacyLiteral(raw.pagerPattern, LEGACY_PAGER, "pager text");
  return {
    ...value,
    protocol,
    authMethod: protocol === "telnet" ? "password" : value.authMethod === "password" || value.authMethod === "agent" ? value.authMethod : "key",
    deviceMode: mode,
    commandMode: protocol === "telnet" || ["cisco", "windows", "network-generic", "custom"].includes(mode) || value.commandMode === "shell" ? "shell" : "exec",
    promptPreset: explicitPreset,
    promptText: literal(raw.promptText, "prompt text"),
    pagerText: pager.value,
    loginPrompt: login.value,
    passwordPrompt: password.value,
    promptPattern: undefined,
    pagerPattern: undefined,
    legacyPatternRejected: raw.legacyPatternRejected === true || legacyPrompt.rejected || login.rejected || password.rejected || pager.rejected,
  };
}

export function normalizeRemoteProfile(value: unknown, existing?: RemoteProfile): RemoteProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid remote profile");
  const raw = value as Record<string, unknown>;
  const protocol = raw.protocol === "telnet" ? "telnet" : "ssh";
  const host = typeof raw.host === "string" ? raw.host.trim() : "";
  if (!host || host.length > 255 || !SAFE_HOST_RE.test(host)) throw new Error("Invalid remote host");
  const port = Number(raw.port ?? (protocol === "ssh" ? 22 : 23));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid remote port");
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 80) throw new Error("Profile name is required");
  const username = typeof raw.username === "string" ? raw.username.trim() : "";
  if (!username || username.length > 128 || /[\r\n\0]/.test(username)) throw new Error("Username is required");
  const selectedMode = deviceMode(raw.deviceMode);
  const authMethod = raw.authMethod === "password" || raw.authMethod === "agent" ? raw.authMethod : "key";
  const now = Date.now();
  const legacyPrompt = legacyPromptPreset(raw.promptPattern, selectedMode);
  const promptPreset = typeof raw.promptPreset === "string" && PROMPT_PRESETS.has(raw.promptPreset as RemotePromptPreset)
    ? raw.promptPreset as RemotePromptPreset
    : legacyPrompt.preset;
  const login = legacyLiteral(raw.loginPrompt, LEGACY_LOGIN, "login prompt");
  const password = legacyLiteral(raw.passwordPrompt, LEGACY_PASSWORD, "password prompt");
  const pager = raw.pagerText !== undefined
    ? { value: literal(raw.pagerText, "pager text"), rejected: false }
    : legacyLiteral(raw.pagerPattern, LEGACY_PAGER, "pager text");
  const timeoutMs = Math.max(1_000, Math.min(300_000, Number(raw.timeoutMs) || 30_000));
  const normalized: RemoteProfile = {
    id: existing?.id ?? randomUUID(),
    name,
    protocol,
    host,
    port,
    username,
    authMethod: protocol === "telnet" ? "password" : authMethod,
    keyPath: protocol === "ssh" && authMethod === "key" ? keyPath(raw.keyPath) : undefined,
    deviceMode: selectedMode,
    commandMode: protocol === "telnet" || ["cisco", "windows", "network-generic", "custom"].includes(selectedMode) || raw.commandMode === "shell" ? "shell" : "exec",
    promptPreset,
    promptText: literal(raw.promptText, "prompt text"),
    pagerText: pager.value,
    legacyPatternRejected: raw.legacyPatternRejected === true || legacyPrompt.rejected || login.rejected || password.rejected || pager.rejected,
    loginPrompt: protocol === "telnet" ? login.value : undefined,
    passwordPrompt: protocol === "telnet" ? password.value : undefined,
    promptPattern: undefined,
    pagerPattern: undefined,
    pagerContinue: typeof raw.pagerContinue === "string" && raw.pagerContinue.length <= 8 ? raw.pagerContinue : " ",
    encoding: raw.encoding === "latin1" || raw.encoding === "gb18030" ? raw.encoding : "utf8",
    lineEnding: raw.lineEnding === "lf" ? "lf" : raw.lineEnding === "crlf" ? "crlf" : protocol === "telnet" ? "crlf" : "lf",
    timeoutMs,
    telnetEnabled: protocol === "telnet" && raw.telnetEnabled === true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (normalized.protocol === "telnet" && !normalized.telnetEnabled) throw new Error("Telnet must be explicitly enabled");
  if (normalized.authMethod === "key" && !normalized.keyPath) throw new Error("SSH key path is required");
  return normalized;
}

export function saveRemoteProfile(value: unknown, id?: string): RemoteProfile {
  const profiles = listRemoteProfiles();
  const existing = id ? profiles.find((profile) => profile.id === id) : undefined;
  if (id && !existing) throw new Error("Remote profile not found");
  const profile = normalizeRemoteProfile(value, existing);
  if (profiles.some((candidate) => candidate.id !== profile.id && candidate.name.toLowerCase() === profile.name.toLowerCase())) throw new Error("Profile name already exists");
  const next = existing ? profiles.map((candidate) => candidate.id === profile.id ? profile : candidate) : [...profiles, profile];
  atomicJson(remoteProfilesPath(), { profiles: next });
  return profile;
}

export function deleteRemoteProfile(id: string): boolean {
  const profiles = listRemoteProfiles();
  const next = profiles.filter((profile) => profile.id !== id);
  if (next.length === profiles.length) return false;
  atomicJson(remoteProfilesPath(), { profiles: next });
  return true;
}

export function findRemoteProfile(id: string): RemoteProfile | undefined {
  return listRemoteProfiles().find((profile) => profile.id === id);
}

function hostKeyId(profile: RemoteProfile): string {
  return `${profile.host.toLowerCase()}:${profile.port}`;
}

export function getKnownHostFingerprint(profile: RemoteProfile): string | undefined {
  return readJson<StoredHostKeys>(remoteKnownHostsPath(), { hosts: {} }).hosts[hostKeyId(profile)];
}

export function trustHostFingerprint(profile: RemoteProfile, fingerprint: string): void {
  const current = readJson<StoredHostKeys>(remoteKnownHostsPath(), { hosts: {} });
  current.hosts[hostKeyId(profile)] = fingerprint;
  atomicJson(remoteKnownHostsPath(), current);
}
