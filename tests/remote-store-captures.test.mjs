import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const fixtureRoot = mkdtempSync(join(tmpdir(), "pi-web-remote-store-"));
const agentDir = join(fixtureRoot, "agent");
const workspace = join(fixtureRoot, "workspace");
const outside = join(fixtureRoot, "outside");
mkdirSync(agentDir, { recursive: true });
mkdirSync(workspace, { recursive: true });
mkdirSync(outside, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_WEB_ALLOWED_ROOTS = workspace;
process.env.PI_WEB_SINGLE_WORKSPACE = "1";
process.env.PI_WEB_APP_ROOT = fileURLToPath(new URL("..", import.meta.url));

const security = await import("../lib/remote-security.ts");
const store = await import("../lib/remote-store.ts");
const captures = await import("../lib/remote-captures.ts");
const remotePackage = await import("../lib/remote-package.ts");
const sessionReader = await import("../lib/session-reader.ts");
const remoteSession = await import("../lib/remote-session.ts");
const sessionExport = await import("../lib/session-export.ts");
const remoteRuntime = await import("../pi-packages/pi-remote-exec/runtime.ts");
const debugBundle = await import("../lib/debug-bundle.ts");

test.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

test("classifies observation commands and conservative sensitive commands", () => {
  assert.equal(security.isSensitiveRemoteCommand("show interfaces", "observe", "network-generic"), false);
  assert.equal(security.isSensitiveRemoteCommand("display version", "observe", "custom"), false);
  assert.equal(security.isSensitiveRemoteCommand("uname -a"), false);
  assert.equal(security.isSensitiveRemoteCommand("df -h"), false);
  assert.equal(security.isSensitiveRemoteCommand("ip addr show"), false);
  assert.equal(security.isSensitiveRemoteCommand("ip link set eth0 down"), true);
  assert.equal(security.isSensitiveRemoteCommand("date -s tomorrow"), true);
  assert.equal(security.isSensitiveRemoteCommand("date 01010000"), true);
  assert.equal(security.isSensitiveRemoteCommand("hostnamectl set-hostname bad"), true);
  assert.equal(security.isSensitiveRemoteCommand("psql"), true);
  assert.equal(security.isSensitiveRemoteCommand("find /tmp -delete"), true);
  assert.equal(security.isSensitiveRemoteCommand("ip -batch changes.txt"), true);
  assert.equal(security.isSensitiveRemoteCommand("hostname new-name"), true);
  assert.equal(security.isSensitiveRemoteCommand("show clock | include UTC"), true);
  assert.equal(security.isSensitiveRemoteCommand("show version\nreload", "observe", "network-generic"), true);
  assert.equal(security.isSensitiveRemoteCommand("sudo systemctl restart sshd"), true);
  assert.equal(security.isSensitiveRemoteCommand("echo unknown"), true);
  assert.equal(security.isSensitiveRemoteCommand("show version", "change"), true);
  assert.equal(security.sanitizeRemoteTerminalOutput("ok\u001b]52;c;ZXZpbA==\u0007done"), "okdone");
  assert.equal(security.sanitizeRemoteTerminalOutput("\u001b[32mgreen\u001b[0m"), "\u001b[32mgreen\u001b[0m");
});

test("uses strict platform grammars and keeps unknown hosts approval-only", () => {
  const cases = [
    ["uname -a", "linux", false],
    ["find /tmp -fprint0 audit.txt", "linux", true],
    ["ip route show default", "linux", false],
    ["ip route flush cache", "linux", true],
    ["ifconfig em0", "freebsd", false],
    ["ifconfig em0 inet 192.0.2.2/24", "freebsd", true],
    ["sysctl kern.hostname", "freebsd", false],
    ["sysctl -w kern.hostname=bad", "freebsd", true],
    ["ipconfig /all", "windows", false],
    ["ipconfig /release", "windows", true],
    ["sc query spooler", "windows", false],
    ["wmic process list", "windows", true],
    ["show version", "cisco", false],
    ["show run", "cisco", true],
    ["show running config", "cisco", true],
    ["show tech-support", "cisco", true],
    ["show version", "unknown", true],
    ["show version | include uptime", "cisco", true],
    ["Get-Service", "windows", false],
    ["Get-Service; restart-service spooler", "windows", true],
  ];
  for (const [command, hostType, sensitive] of cases) {
    assert.equal(security.isSensitiveRemoteCommand(command, "observe", hostType), sensitive, `${hostType}: ${command}`);
  }
});

test("detects only coherent host banners and redacts credentials across chunks", () => {
  assert.equal(security.detectRemoteHostType("Cisco IOS XE Software, Version 17"), "cisco");
  assert.equal(security.detectRemoteHostType("FreeBSD host 14.2"), "freebsd");
  assert.equal(security.detectRemoteHostType("Linux host 6.8"), "linux");
  assert.equal(security.detectRemoteHostType("Microsoft Windows Server 2025"), "windows");
  assert.equal(security.detectRemoteHostType("Cisco IOS on Microsoft Windows"), "unknown");
  assert.equal(security.detectRemoteHostType("opaque banner"), "unknown");
  const redacted = remoteRuntime.redactRemoteTextChunks(["login ok\r\ntemporary-", "secret\r\ndevice# "], ["temporary-secret"]);
  assert.doesNotMatch(redacted, /temporary-secret/);
  assert.match(redacted, /\[redacted\]/);
});

test("migrates legacy default patterns and disables legacy custom regular expressions", () => {
  const legacyDefault = store.normalizeRemoteProfile({
    name: "Legacy default", protocol: "ssh", host: "legacy.example", username: "operator", authMethod: "password",
    deviceMode: "linux", promptPattern: "(?:^|\\n)[^\\r\\n]*[$#]\\s*$",
  });
  assert.equal(legacyDefault.promptPreset, "unix");
  assert.equal(legacyDefault.legacyPatternRejected, false);
  const legacyCustom = store.normalizeRemoteProfile({
    name: "Legacy custom", protocol: "ssh", host: "legacy-custom.example", username: "operator", authMethod: "password",
    deviceMode: "network-generic", promptPattern: "^(a|aa)+$",
  });
  assert.equal(legacyCustom.legacyPatternRejected, true);
  assert.equal(legacyCustom.promptPattern, undefined);
});

test("excludes Remote tool calls and results from normal session exports", () => {
  const context = {
    messages: [
      { role: "assistant", content: [{ type: "toolCall", toolCallId: "remote", toolName: "remote_execute", input: { command: "show version" } }, { type: "text", text: "Checking." }], model: "m", provider: "p" },
      { role: "toolResult", toolCallId: "remote", toolName: "remote_execute", content: [{ type: "text", text: "sensitive remote output" }] },
      { role: "toolResult", toolCallId: "local", toolName: "read", content: [{ type: "text", text: "local output" }] },
    ],
    entryIds: ["one", "two", "three"], thinkingLevel: "off", model: null,
  };
  const filtered = sessionExport.filterRemoteSessionContext(context);
  assert.equal(filtered.messages.length, 2);
  assert.equal(filtered.messages[0].content[0].type, "text");
  assert.doesNotMatch(sessionExport.buildJsonSessionExport({ sessionId: "x", info: null, header: null, leafId: null, context, entries: [], exportedAt: "2026-01-01T00:00:00.000Z" }), /sensitive remote output|remote_execute/);
  const bundle = debugBundle.buildDebugBundle({
    sessionId: "remote-export-filter",
    header: { type: "session", id: "remote-export-filter", timestamp: "2026-01-01T00:00:00.000Z", cwd: workspace },
    entries: [
      { type: "message", id: "one", parentId: null, timestamp: "2026-01-01T00:00:00.000Z", message: context.messages[0] },
      { type: "message", id: "two", parentId: "one", timestamp: "2026-01-01T00:00:01.000Z", message: context.messages[1] },
    ],
    appVersion: "test", piVersion: "test",
  });
  assert.doesNotMatch(gunzipSync(bundle.data).toString("utf8"), /sensitive remote output|remote_execute/);
});

test("accepts only a real formal session and derives its cwd from the header", async () => {
  const id = "remote-formal-session";
  const file = join(agentDir, "remote-formal-session.jsonl");
  writeFileSync(file, `${JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: workspace })}\n`);
  sessionReader.cacheSessionPath(id, file);
  assert.deepEqual(await remoteSession.requireRemoteSession(id, workspace), { id, filePath: file, cwd: workspace });
  await assert.rejects(() => remoteSession.requireRemoteSession(id, outside), /not found/i);
  unlinkSync(file);
  await assert.rejects(() => remoteSession.requireRemoteSession(id), /not found/i);
  await assert.rejects(() => remoteSession.requireRemoteSession("random-session-id"), /not found/i);
});

test("stores profiles atomically with mode 0600 and never persists submitted secrets", () => {
  const profile = store.saveRemoteProfile({
    name: "Lab SSH",
    protocol: "ssh",
    host: "router.lab.example",
    port: 22,
    username: "operator",
    authMethod: "password",
    password: "must-not-persist",
    passphrase: "must-not-persist-either",
    deviceMode: "linux",
    timeoutMs: 30_000,
  });
  assert.equal(store.listRemoteProfiles()[0].id, profile.id);
  const raw = readFileSync(store.remoteProfilesPath(), "utf8");
  assert.doesNotMatch(raw, /must-not-persist/);
  assert.equal(lstatSync(store.remoteProfilesPath()).mode & 0o777, 0o600);
  assert.throws(() => store.saveRemoteProfile({ ...profile, id: undefined, name: "Unsafe Telnet", protocol: "telnet", port: 23, telnetEnabled: false }), /explicitly enabled/);
});

test("stores known host fingerprints without exposing key material", () => {
  const profile = store.listRemoteProfiles()[0];
  store.trustHostFingerprint(profile, "SHA256:test-fingerprint");
  assert.equal(store.getKnownHostFingerprint(profile), "SHA256:test-fingerprint");
  assert.equal(lstatSync(store.remoteKnownHostsPath()).mode & 0o777, 0o600);
});

test("loads the built-in package and registers all Remote tools", async () => {
  await remotePackage.enableRemotePackage(workspace);
  const status = await remotePackage.remotePackageStatus(workspace);
  assert.equal(status.configured, true);
  assert.equal(status.loaded, true);
  assert.deepEqual(status.errors, []);
});

test("pages, searches, and safely exports captures inside allowed roots", async () => {
  const profile = store.listRemoteProfiles()[0];
  const result = captures.saveRemoteCapture({
    agentSessionId: "agent-test",
    profileId: profile.id,
    command: "show interfaces",
    output: "\u001b[32mport1 up\u001b[0m\nport2 down\n",
    exitCode: 0,
    durationMs: 12,
  });
  assert.match(result.preview, /port1 up/);
  assert.doesNotMatch(result.preview, /\u001b/);
  const captureRoot = join(agentDir, "remote-captures");
  const captureDir = join(captureRoot, readdirSync(captureRoot)[0]);
  const captureFile = join(captureDir, readdirSync(captureDir).find((file) => file.startsWith(result.id)));
  const beforeRead = statSync(captureFile).mtimeMs;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(captures.readRemoteCapture("agent-test", result.id, 0, 8).text, "port1 up");
  assert.ok(statSync(captureFile).mtimeMs > beforeRead);
  assert.deepEqual(captures.searchRemoteCapture("agent-test", result.id, "DOWN").matches.map((item) => item.line), [2]);

  const exported = await captures.exportRemoteCapture("agent-test", result.id, workspace, "analysis/device.txt");
  assert.match(readFileSync(exported, "utf8"), /port2 down/);
  assert.rejects(() => captures.exportRemoteCapture("agent-test", result.id, workspace, "analysis/device.txt"), /already exists/);

  const link = join(workspace, "escape");
  symlinkSync(outside, link, "dir");
  assert.rejects(() => captures.exportRemoteCapture("agent-test", result.id, workspace, "escape/leak.txt"), /Access denied/);
  chmodSync(exported, 0o600);
});
