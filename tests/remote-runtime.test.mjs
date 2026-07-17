import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import ssh2 from "ssh2";
import iconv from "iconv-lite";

const { Server } = ssh2;

const fixtureRoot = mkdtempSync(join(tmpdir(), "pi-web-remote-runtime-"));
const agentDir = join(fixtureRoot, "agent");
mkdirSync(agentDir, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_WEB_ALLOWED_ROOTS = fixtureRoot;
process.env.PI_WEB_SINGLE_WORKSPACE = "1";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const { getKnownHostFingerprint, saveRemoteProfile } = await import("../lib/remote-store.ts");
const { getRemoteRuntime } = await import("../pi-packages/pi-remote-exec/runtime.ts");

let server;
let port;

function createMockSshServer(hostKey) {
  return new Server({ hostKeys: [hostKey] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (ctx) => {
      if (ctx.method === "password" && ctx.username === "tester" && ctx.password === "temporary-secret") ctx.accept();
      else ctx.reject();
    });
    client.on("ready", () => {
      client.on("session", (accept) => {
        const session = accept();
        session.on("pty", (acceptPty) => acceptPty?.());
        session.on("shell", (acceptShell) => {
          const stream = acceptShell();
          let waitingForPager = false;
          stream.write("mock$ ");
          stream.on("data", (chunk) => {
            if (waitingForPager && chunk.toString("utf8").includes(" ")) {
              waitingForPager = false;
              stream.write("\r\npage2\r\nmock# ");
              return;
            }
            const command = chunk.toString("utf8").trim();
            if (command === "show paged") {
              waitingForPager = true;
              stream.write(`${command}\r\npage1\r\n--More--`);
            } else if (command) stream.write(`${command}\r\nshell:${command}\r\nmock$ `);
          });
        });
        session.on("exec", (acceptExec, _rejectExec, info) => {
          const stream = acceptExec();
          if (info.command === "uname gb") {
            const encoded = iconv.encode("中文输出正常\n", "gb18030");
            stream.write(encoded.subarray(0, 1));
            stream.write(encoded.subarray(1, 3));
            stream.write(encoded.subarray(3));
            stream.exit(0);
            stream.end();
            return;
          }
          if (info.command === "uname big") {
            const chunk = Buffer.alloc(4_096, 0x78);
            for (let index = 0; index < 4_097; index += 1) stream.write(chunk);
            stream.exit(0);
            stream.end();
            return;
          }
          stream.write(`stdout:${info.command}\n`);
          stream.stderr.write("stderr:diagnostic\n");
          stream.exit(0);
          stream.end();
        });
      });
    });
  });
}

async function listen(serverInstance, requestedPort = 0) {
  await new Promise((resolve, reject) => {
    serverInstance.once("error", reject);
    serverInstance.listen(requestedPort, "127.0.0.1", () => resolve());
  });
  return serverInstance.address().port;
}

test.before(async () => {
  server = createMockSshServer(privateKey);
  port = await listen(server);
});

test.after(async () => {
  await getRemoteRuntime().close("ssh-agent-test").catch(() => {});
  server?.closeAllConnections?.();
  if (server) await new Promise((resolve) => server.close(resolve));
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function nextApproval(runtime, sessionId, kind) {
  return new Promise((resolve) => {
    const unsubscribe = runtime.subscribe(sessionId, (event) => {
      if (event.type === "approval_required" && event.approval?.kind === kind) {
        unsubscribe();
        resolve(event.approval);
      }
    });
  });
}

test("connects through a trusted SSH profile, captures output, and enforces control policy", async () => {
  const profile = saveRemoteProfile({
    name: "Mock SSH",
    protocol: "ssh",
    host: "127.0.0.1",
    port,
    username: "tester",
    authMethod: "password",
    deviceMode: "linux",
    commandMode: "exec",
    timeoutMs: 5_000,
  });
  const runtime = getRemoteRuntime();
  const approvalPromise = nextApproval(runtime, "ssh-agent-test", "host-key");
  const connectPromise = runtime.connect("ssh-agent-test", profile.id, { password: "temporary-secret" });
  const approval = await approvalPromise;
  assert.match(approval.fingerprint, /^SHA256:/);
  assert.equal(runtime.resolveApproval("ssh-agent-test", approval.id, "trust"), true);
  const connected = await connectPromise;
  assert.equal(connected.status, "connected");

  const result = await runtime.execute("ssh-agent-test", "uname -a", { intent: "observe", source: "agent" });
  assert.match(result.preview, /stdout:uname -a/);
  assert.match(result.preview, /stderr:diagnostic/);
  assert.equal(result.exitCode, 0);
  assert.equal(runtime.listCaptures("ssh-agent-test").length, 1);

  const sensitiveApproval = nextApproval(runtime, "ssh-agent-test", "command");
  const deniedCommand = runtime.execute("ssh-agent-test", "sudo reboot", { intent: "change", source: "agent" });
  const pending = await sensitiveApproval;
  await assert.rejects(() => runtime.execute("ssh-agent-test", "show version", { source: "agent" }), /already running/);
  runtime.resolveApproval("ssh-agent-test", pending.id, "deny");
  await assert.rejects(deniedCommand, /denied/);
  assert.equal(runtime.getSession("ssh-agent-test").status, "connected");

  const commandBarApproval = nextApproval(runtime, "ssh-agent-test", "command");
  const commandBarCommand = runtime.execute("ssh-agent-test", "psql", { intent: "observe", source: "command-bar" });
  const commandBarPending = await commandBarApproval;
  runtime.resolveApproval("ssh-agent-test", commandBarPending.id, "deny");
  await assert.rejects(commandBarCommand, /denied/);

  const controller = new AbortController();
  const cancelledApproval = nextApproval(runtime, "ssh-agent-test", "command");
  const cancelledCommand = runtime.execute("ssh-agent-test", "ip link set eth0 down", { source: "agent", signal: controller.signal });
  const cancelledPending = await cancelledApproval;
  controller.abort();
  await assert.rejects(cancelledCommand, /aborted/);
  assert.equal(runtime.resolveApproval("ssh-agent-test", cancelledPending.id, "allow_once"), false);

  runtime.setPolicy("ssh-agent-test", "full-auto");
  const exportPath = join(fixtureRoot, "exports", "capture.txt");
  const exportApproval = nextApproval(runtime, "ssh-agent-test", "export");
  const exportPromise = runtime.exportCapture("ssh-agent-test", result.id, fixtureRoot, exportPath, false);
  const exportPending = await exportApproval;
  assert.equal(existsSync(exportPath), false);
  runtime.resolveApproval("ssh-agent-test", exportPending.id, "allow_once");
  assert.equal(await exportPromise, exportPath);
  assert.match(readFileSync(exportPath, "utf8"), /stdout:uname -a/);
  const exportAbort = new AbortController();
  const cancelledExportPath = join(fixtureRoot, "exports", "cancelled.txt");
  const cancelledExportApproval = nextApproval(runtime, "ssh-agent-test", "export");
  const cancelledExport = runtime.exportCapture("ssh-agent-test", result.id, fixtureRoot, cancelledExportPath, false, { signal: exportAbort.signal });
  const cancelledExportPending = await cancelledExportApproval;
  exportAbort.abort();
  await assert.rejects(cancelledExport, /aborted/);
  assert.equal(runtime.resolveApproval("ssh-agent-test", cancelledExportPending.id, "allow_once"), false);
  assert.equal(existsSync(cancelledExportPath), false);
  const large = await runtime.execute("ssh-agent-test", "uname big", { source: "agent", timeoutMs: 30_000 });
  assert.equal(large.byteCount, 4_097 * 4_096);
  assert.equal(large.truncated, true);
  assert.equal(Buffer.byteLength(large.preview, "utf8"), 64 * 1_024);
  assert.equal(runtime.takeControl("ssh-agent-test").controlMode, "manual");
  await assert.rejects(() => runtime.execute("ssh-agent-test", "show clock", { source: "agent" }), /manual control/);
  assert.equal(runtime.resumeAgent("ssh-agent-test").controlMode, "agent");

  const shellProfile = saveRemoteProfile({
    name: "Mock Network CLI",
    protocol: "ssh",
    host: "127.0.0.1",
    port,
    username: "tester",
    authMethod: "password",
    deviceMode: "network-generic",
    commandMode: "shell",
    timeoutMs: 5_000,
  });
  await runtime.connect("ssh-agent-test", shellProfile.id, { password: "temporary-secret" });
  const paged = await runtime.execute("ssh-agent-test", "show paged", { intent: "observe", source: "agent" });
  assert.match(paged.preview, /page1/);
  assert.match(paged.preview, /page2/);
  await runtime.close("ssh-agent-test");
  assert.equal(runtime.getSession("ssh-agent-test").policyMode, "confirm-sensitive");
});

test("streams split GB18030 output without double decoding", async () => {
  const profile = saveRemoteProfile({
    name: "Mock GB18030",
    protocol: "ssh",
    host: "127.0.0.1",
    port,
    username: "tester",
    authMethod: "password",
    deviceMode: "linux",
    commandMode: "exec",
    encoding: "gb18030",
    timeoutMs: 5_000,
  });
  const runtime = getRemoteRuntime();
  await runtime.connect("gb18030-test", profile.id, { password: "temporary-secret" });
  const output = [];
  const unsubscribe = runtime.subscribe("gb18030-test", (event) => { if (event.type === "output") output.push(event.text || ""); });
  const result = await runtime.execute("gb18030-test", "uname gb", { source: "agent" });
  unsubscribe();
  assert.match(result.preview, /中文输出正常/);
  assert.match(output.join(""), /中文输出正常/);
  await runtime.close("gb18030-test");
});

test("hard-blocks a changed SSH host key without offering a new trust prompt", async () => {
  const profile = saveRemoteProfile({
    name: "Changed Host Key",
    protocol: "ssh",
    host: "127.0.0.1",
    port,
    username: "tester",
    authMethod: "password",
    deviceMode: "linux",
    timeoutMs: 2_000,
  });
  const runtime = getRemoteRuntime();
  if (!getKnownHostFingerprint(profile)) {
    const initialApprovalPromise = nextApproval(runtime, "changed-key-prime", "host-key");
    const initialConnectPromise = runtime.connect("changed-key-prime", profile.id, { password: "temporary-secret" });
    const initialApproval = await initialApprovalPromise;
    runtime.resolveApproval("changed-key-prime", initialApproval.id, "trust");
    await initialConnectPromise;
    await runtime.close("changed-key-prime");
  }
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
  const { privateKey: changedPrivateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  server = createMockSshServer(changedPrivateKey);
  await listen(server, port);
  let approvalCount = 0;
  const unsubscribe = runtime.subscribe("changed-key-test", (event) => {
    if (event.type === "approval_required") approvalCount += 1;
  });
  await assert.rejects(() => runtime.connect("changed-key-test", profile.id, { password: "temporary-secret" }), /host key changed/i);
  unsubscribe();
  assert.equal(approvalCount, 0);
  assert.equal(runtime.getSession("changed-key-test").status, "idle");
});

test("requires an explicit warning approval before opening Telnet", async () => {
  const profile = saveRemoteProfile({
    name: "Legacy Telnet",
    protocol: "telnet",
    host: "127.0.0.1",
    port: 23,
    username: "tester",
    authMethod: "password",
    deviceMode: "network-generic",
    telnetEnabled: true,
    timeoutMs: 1_000,
  });
  const runtime = getRemoteRuntime();
  const approvalPromise = nextApproval(runtime, "telnet-agent-test", "telnet");
  const controller = new AbortController();
  const connectPromise = runtime.connect("telnet-agent-test", profile.id, { password: "temporary-secret" }, { signal: controller.signal });
  const approval = await approvalPromise;
  controller.abort();
  await assert.rejects(connectPromise, /aborted/);
  assert.equal(runtime.resolveApproval("telnet-agent-test", approval.id, "allow_once"), false);
});

test("logs in to Telnet, advances pagination, and captures the complete response", async () => {
  const telnetServer = createServer((socket) => {
    let stage = "username";
    let waitingForPager = false;
    socket.write("Username: ");
    socket.on("data", (data) => {
      const text = data.toString("utf8");
      if (stage === "username") {
        stage = "password";
        socket.write("Password: ");
      } else if (stage === "password") {
        stage = "command";
        socket.write("\r\ndevice# ");
      } else if (waitingForPager && text.includes(" ")) {
        waitingForPager = false;
        socket.write("\r\npage2\r\ndevice# ");
      } else if (text.includes("show paged")) {
        waitingForPager = true;
        socket.write("show paged\r\npage1\r\n--More--");
      }
    });
  });
  const telnetPort = await listen(telnetServer);
  const profile = saveRemoteProfile({
    name: "Telnet Mock",
    protocol: "telnet",
    host: "127.0.0.1",
    port: telnetPort,
    username: "tester",
    authMethod: "password",
    deviceMode: "network-generic",
    telnetEnabled: true,
    timeoutMs: 2_000,
  });
  const runtime = getRemoteRuntime();
  const approvalPromise = nextApproval(runtime, "telnet-exec-test", "telnet");
  const connectPromise = runtime.connect("telnet-exec-test", profile.id, { password: "temporary-secret" });
  const approval = await approvalPromise;
  runtime.resolveApproval("telnet-exec-test", approval.id, "allow_once");
  await connectPromise;
  const result = await runtime.execute("telnet-exec-test", "show paged", { intent: "observe", source: "agent" });
  assert.match(result.preview, /page1/);
  assert.match(result.preview, /page2/);
  await runtime.close("telnet-exec-test");
  telnetServer.closeAllConnections?.();
  await new Promise((resolve) => telnetServer.close(resolve));
});
