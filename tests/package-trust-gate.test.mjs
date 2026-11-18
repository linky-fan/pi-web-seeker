import assert from "node:assert/strict";
import test from "node:test";

const { AgentCommandError, PROJECT_TRUST_REQUIRED } = await import("../lib/agent-client.ts");
const { PackageTrustGateController } = await import("../lib/package-trust-gate.ts");

function trustRequired(cwd) {
  return new AgentCommandError("explicit trust required", 428, PROJECT_TRUST_REQUIRED, cwd);
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function decodeRequest(request) {
  return { url: request.input, method: request.init?.method, body: JSON.parse(request.init?.body) };
}

test("a first 428 opens the prompt without retrying the package setup", async () => {
  const cwd = "C:/work/unresolved";
  const requests = [];
  const gate = new PackageTrustGateController(async (input, init) => {
    requests.push({ input, init });
    return jsonResponse(200, {});
  });
  let enables = 0;

  await gate.runWithTrust("caller-cwd", async () => {
    enables += 1;
    throw trustRequired(cwd);
  });

  assert.equal(enables, 1);
  assert.deepEqual(gate.getSnapshot(), { cwd, resolving: false });
  assert.deepEqual(requests, []);
});

test("allow records workspace trust and retries package setup once", async () => {
  const cwd = "C:/work/allow";
  const requests = [];
  const gate = new PackageTrustGateController(async (input, init) => {
    requests.push({ input, init });
    return jsonResponse(200, { cwd, state: "trusted" });
  });
  let enables = 0;
  const enable = async () => {
    enables += 1;
    if (enables === 1) throw trustRequired(cwd);
  };

  await gate.runWithTrust(cwd, enable);
  await gate.resolve(true);

  assert.equal(enables, 2);
  assert.deepEqual(decodeRequest(requests[0]), {
    url: "api/workspaces/trust",
    method: "POST",
    body: { cwd, trusted: true },
  });
  assert.deepEqual(gate.getSnapshot(), { cwd: null, resolving: false });
});

test("a retry that still needs trust reopens the prompt and can be resolved", async () => {
  const cwd = "C:/work/retry-trust";
  const requests = [];
  const gate = new PackageTrustGateController(async (input, init) => {
    requests.push({ input, init });
    return jsonResponse(200, {});
  });
  let enables = 0;
  const enable = async () => {
    enables += 1;
    if (enables <= 2) throw trustRequired(cwd);
  };

  await gate.runWithTrust(cwd, enable);
  await gate.resolve(true);
  assert.deepEqual(gate.getSnapshot(), { cwd, resolving: false });
  await gate.resolve(true);

  assert.equal(enables, 3);
  assert.equal(requests.length, 2);
  assert.deepEqual(gate.getSnapshot(), { cwd: null, resolving: false });
});

test("deny records a session-only decision and never retries package setup", async () => {
  const cwd = "C:/work/deny";
  const requests = [];
  const gate = new PackageTrustGateController(async (input, init) => {
    requests.push({ input, init });
    return jsonResponse(200, { cwd, state: "untrusted" });
  });
  let enables = 0;

  await gate.runWithTrust(cwd, async () => {
    enables += 1;
    throw trustRequired(cwd);
  });
  await gate.resolve(false);

  assert.equal(enables, 1);
  assert.deepEqual(decodeRequest(requests[0]), {
    url: "api/workspaces/trust",
    method: "POST",
    body: { cwd, trusted: false },
  });
  assert.deepEqual(gate.getSnapshot(), { cwd: null, resolving: false });
});

test("dismissing the prompt performs no trust write and discards the pending enable", async () => {
  const cwd = "C:/work/dismiss";
  const requests = [];
  const gate = new PackageTrustGateController(async (input, init) => {
    requests.push({ input, init });
    return jsonResponse(200, {});
  });
  let enables = 0;

  await gate.runWithTrust(cwd, async () => {
    enables += 1;
    throw trustRequired(cwd);
  });
  gate.dismiss();
  await gate.resolve(true);

  assert.equal(enables, 1);
  assert.deepEqual(requests, []);
  assert.deepEqual(gate.getSnapshot(), { cwd: null, resolving: false });
});

test("a failed trust POST retains the prompt and pending enable for another choice", async () => {
  const cwd = "C:/work/post-failure";
  const requests = [];
  let failTrustPost = true;
  const gate = new PackageTrustGateController(async (input, init) => {
    requests.push({ input, init });
    return failTrustPost
      ? jsonResponse(500, { error: "store unavailable" })
      : jsonResponse(200, {});
  });
  let enables = 0;
  const enable = async () => {
    enables += 1;
    if (enables === 1) throw trustRequired(cwd);
  };

  await gate.runWithTrust(cwd, enable);
  await assert.rejects(gate.resolve(true), /store unavailable/);
  assert.deepEqual(gate.getSnapshot(), { cwd, resolving: false });

  failTrustPost = false;
  await gate.resolve(true);
  assert.equal(enables, 2);
  assert.equal(requests.length, 2);
  assert.deepEqual(gate.getSnapshot(), { cwd: null, resolving: false });
});

test("an unrelated package-enable error propagates and clears the pending enable", async () => {
  const gate = new PackageTrustGateController(async () => jsonResponse(200, {}));
  await assert.rejects(gate.runWithTrust("C:/work/error", async () => {
    throw new Error("package setup failed");
  }), /package setup failed/);

  await gate.resolve(true);
  assert.deepEqual(gate.getSnapshot(), { cwd: null, resolving: false });
});