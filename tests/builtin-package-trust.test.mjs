import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const fixtureRoot = mkdtempSync(join(tmpdir(), "pi-web-package-trust-"));
const agentDir = join(fixtureRoot, "agent");
const appRoot = join(fixtureRoot, "app");
const projectRoot = join(appRoot, "pi-packages");
const workspace = join(fixtureRoot, "workspace");
mkdirSync(agentDir, { recursive: true });
mkdirSync(join(projectRoot, "pi-opencli"), { recursive: true });
mkdirSync(join(projectRoot, "pi-remote-exec"), { recursive: true });
mkdirSync(workspace, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_WEB_APP_ROOT = appRoot;
process.env.PI_WEB_ALLOWED_ROOTS = fixtureRoot;
process.env.PI_WEB_SINGLE_WORKSPACE = "1";

const trust = await import("../lib/project-trust.ts");
const browser = await import("../lib/browser-package.ts");
const remote = await import("../lib/remote-package.ts");

test.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function settingsPath(cwd = workspace) {
  return join(cwd, ".pi", "settings.json");
}

for (const [name, enable] of [
  ["OpenCLI", browser.enableBrowserPackage],
  ["Remote", remote.enableRemotePackage],
]) {
  test(`${name} package enable asks before writing project settings or trust`, async () => {
    assert.equal(trust.projectTrustState(workspace), "trusted");
    assert.equal(trust.hasExplicitProjectTrustAllow(workspace), false);

    await assert.rejects(enable(workspace), {
      code: trust.PROJECT_TRUST_REQUIRED,
      cwd: workspace,
    });

    assert.equal(existsSync(settingsPath()), false);
    assert.equal(existsSync(join(agentDir, "trust.json")), false);
  });
}

test("session-only deny blocks package enable without persisting either settings or trust", async () => {
  trust.recordProjectTrust(workspace, false);
  await assert.rejects(browser.enableBrowserPackage(workspace), { code: "PROJECT_TRUST_DENIED" });
  await assert.rejects(remote.enableRemotePackage(workspace), { code: "PROJECT_TRUST_DENIED" });
  assert.equal(existsSync(settingsPath()), false);
  assert.equal(existsSync(join(agentDir, "trust.json")), false);
});

test("explicit allow enables built-in packages and repeat enable is idempotent", async () => {
  trust.forgetSessionProjectTrust(workspace);
  trust.recordProjectTrust(workspace, true);

  await browser.enableBrowserPackage(workspace);
  await browser.enableBrowserPackage(workspace);
  await remote.enableRemotePackage(workspace);
  await remote.enableRemotePackage(workspace);

  const settings = JSON.parse(readFileSync(settingsPath(), "utf8"));
  assert.deepEqual(settings.packages, [
    join(projectRoot, "pi-opencli"),
    join(projectRoot, "pi-remote-exec"),
  ]);
  assert.equal(trust.hasExplicitProjectTrustAllow(workspace), true);
  assert.equal(JSON.parse(readFileSync(join(agentDir, "trust.json"), "utf8"))[trust.canonicalWorkspacePath(workspace)], true);
});

test("explicit parent allow permits package enable in a child workspace", async () => {
  const parent = join(fixtureRoot, "mono");
  const child = join(parent, "apps", "project");
  mkdirSync(child, { recursive: true });
  trust.recordProjectTrust(parent, true);

  await remote.enableRemotePackage(child);
  const settings = JSON.parse(readFileSync(settingsPath(child), "utf8"));
  assert.deepEqual(settings.packages, [join(projectRoot, "pi-remote-exec")]);
});

test("pre-existing explicit deny in the persistent store does not count as allow", async () => {
  const denied = join(fixtureRoot, "persistently-denied");
  mkdirSync(denied, { recursive: true });
  const { ProjectTrustStore } = await import("@earendil-works/pi-coding-agent");
  new ProjectTrustStore(agentDir).set(denied, false);
  await assert.rejects(remote.enableRemotePackage(denied), { code: trust.PROJECT_TRUST_REQUIRED });
  assert.equal(existsSync(settingsPath(denied)), false);
});