import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const fixtureRoot = mkdtempSync(join(tmpdir(), "pi-web-project-trust-"));
const agentDir = join(fixtureRoot, "agent");
const parentWorkspace = join(fixtureRoot, "projects");
const plainWorkspace = join(fixtureRoot, "plain");
mkdirSync(agentDir, { recursive: true });
mkdirSync(parentWorkspace, { recursive: true });
mkdirSync(plainWorkspace, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;

const trust = await import("../lib/project-trust.ts");
const { AgentCommandError, isProjectTrustRequiredError } = await import("../lib/agent-client.ts");

test.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

function trustedWorkspace(name) {
  const workspace = join(parentWorkspace, name);
  mkdirSync(join(workspace, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(workspace, ".pi", "settings.json"), "{}\n", "utf8");
  return workspace;
}

test("workspaces without project resources never prompt", () => {
  assert.equal(trust.requiresProjectTrust(plainWorkspace), false);
  assert.equal(trust.projectTrustState(plainWorkspace), "trusted");
  assert.equal(trust.isProjectTrustedForLoad(plainWorkspace), true);
});

test("first visit is unresolved and the loader gate keeps project resources out", () => {
  const workspace = trustedWorkspace("first");
  assert.equal(trust.requiresProjectTrust(workspace), true);
  assert.equal(trust.projectTrustState(workspace), "unresolved");
  assert.equal(trust.isProjectTrustedForLoad(workspace), false);
});

test("allowing a workspace is remembered across resets", () => {
  const workspace = trustedWorkspace("allowed");
  assert.equal(trust.recordProjectTrust(workspace, true), "trusted");

  trust.forgetSessionProjectTrust();
  assert.equal(trust.projectTrustState(workspace), "trusted");

  const stored = JSON.parse(readFileSync(join(agentDir, "trust.json"), "utf8"));
  assert.equal(Object.values(stored).includes(true), true);
});

test("denying a workspace lasts only until the session cache is cleared", () => {
  const workspace = trustedWorkspace("denied");
  assert.equal(trust.recordProjectTrust(workspace, false), "untrusted");
  assert.equal(trust.isProjectTrustedForLoad(workspace), false);

  trust.forgetSessionProjectTrust(workspace);
  assert.equal(trust.projectTrustState(workspace), "unresolved");
});

test("a parent decision covers child workspaces", () => {
  const parent = join(parentWorkspace, "mono");
  const child = join(parent, "packages", "app");
  mkdirSync(join(child, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(child, ".pi", "settings.json"), "{}\n", "utf8");

  trust.recordProjectTrust(parent, true);
  assert.equal(trust.projectTrustState(child), "trusted");

  trust.recordProjectTrust(parent, false);
  assert.equal(trust.projectTrustState(child), "untrusted");
});

test("package enable requires a persisted explicit allow, even without project resources", () => {
  assert.equal(trust.projectTrustState(plainWorkspace), "trusted");
  assert.equal(trust.hasExplicitProjectTrustAllow(plainWorkspace), false);
  assert.throws(() => trust.assertProjectTrustedForPackageEnable(plainWorkspace), {
    code: trust.PROJECT_TRUST_REQUIRED,
  });

  trust.recordProjectTrust(plainWorkspace, false);
  assert.equal(trust.hasExplicitProjectTrustAllow(plainWorkspace), false);
  assert.throws(() => trust.assertProjectTrustedForPackageEnable(plainWorkspace), {
    code: "PROJECT_TRUST_DENIED",
  });

  trust.forgetSessionProjectTrust(plainWorkspace);
  trust.recordProjectTrust(plainWorkspace, true);
  assert.equal(trust.hasExplicitProjectTrustAllow(plainWorkspace), true);
  assert.doesNotThrow(() => trust.assertProjectTrustedForPackageEnable(plainWorkspace));
});

test("setup trust errors map to structured API payloads recognized by the client", () => {
  const cwd = plainWorkspace;
  const required = trust.projectTrustErrorResponse(new trust.ProjectTrustRequiredError(cwd));
  assert.deepEqual(required, {
    status: 428,
    body: {
      error: `Explicit project trust is required for this workspace: ${cwd}`,
      code: "PROJECT_TRUST_REQUIRED",
      cwd,
    },
  });
  assert.equal(isProjectTrustRequiredError(new AgentCommandError(
    required.body.error,
    required.status,
    required.body.code,
    required.body.cwd,
  )), true);

  const denied = trust.projectTrustErrorResponse(new trust.ProjectTrustDeniedError(cwd));
  assert.equal(denied?.status, 403);
  assert.equal(denied?.body.code, "PROJECT_TRUST_DENIED");
  assert.equal(trust.projectTrustErrorResponse(new Error("unrelated")), null);
});

test("an explicit parent allow covers package enable in child workspaces", () => {
  const parent = join(parentWorkspace, "explicit-parent");
  const child = join(parent, "package");
  mkdirSync(child, { recursive: true });

  assert.equal(trust.hasExplicitProjectTrustAllow(child), false);
  trust.recordProjectTrust(parent, true);
  assert.equal(trust.hasExplicitProjectTrustAllow(child), true);
  assert.doesNotThrow(() => trust.assertProjectTrustedForPackageEnable(child));
});

function gatedWorkspace(name) {
  return trustedWorkspace(name);
}

test("a nearer persisted allow beats a parent session deny", () => {
  const parent = join(parentWorkspace, "near-allow");
  const child = join(parent, "pkg");
  mkdirSync(join(child, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(child, ".pi", "settings.json"), "{}\n", "utf8");

  trust.recordProjectTrust(parent, false);
  assert.equal(trust.projectTrustState(child), "untrusted");

  trust.forgetSessionProjectTrust();
  trust.recordProjectTrust(child, true);
  trust.recordProjectTrust(parent, false);
  assert.equal(trust.projectTrustState(child), "trusted");
  assert.equal(trust.hasExplicitProjectTrustAllow(child), true);
});

test("a nearer session deny beats a parent persisted allow", () => {
  const parent = join(parentWorkspace, "near-deny");
  const child = join(parent, "pkg");
  mkdirSync(join(child, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(child, ".pi", "settings.json"), "{}\n", "utf8");

  trust.recordProjectTrust(parent, true);
  assert.equal(trust.projectTrustState(child), "trusted");

  trust.recordProjectTrust(child, false);
  assert.equal(trust.projectTrustState(child), "untrusted");
  assert.equal(trust.hasExplicitProjectTrustAllow(child), false);
  assert.throws(() => trust.assertProjectTrustedForPackageEnable(child), { code: "PROJECT_TRUST_DENIED" });
});

test("session deny wins an exact-path tie against a persisted allow", () => {
  const workspace = gatedWorkspace("exact-tie");
  trust.recordProjectTrust(workspace, true);
  assert.equal(trust.projectTrustState(workspace), "trusted");

  trust.recordProjectTrust(workspace, false);
  assert.equal(trust.projectTrustState(workspace), "untrusted");

  const resolved = trust.resolveProjectTrust(workspace);
  assert.equal(resolved.source, "session");
  assert.equal(resolved.decision, false);
});

test("reload applies the current trust decision to a live settings manager", () => {
  const workspace = gatedWorkspace("reload-trust");
  const settings = { trusted: null, setProjectTrusted(value) { this.trusted = value; } };

  assert.throws(() => trust.applyProjectTrustToSettings(settings, workspace), {
    code: trust.PROJECT_TRUST_REQUIRED,
  });

  trust.recordProjectTrust(workspace, true);
  assert.equal(trust.applyProjectTrustToSettings(settings, workspace), "trusted");
  assert.equal(settings.trusted, true);

  trust.recordProjectTrust(workspace, false);
  assert.equal(trust.applyProjectTrustToSettings(settings, workspace), "untrusted");
  assert.equal(settings.trusted, false);
});