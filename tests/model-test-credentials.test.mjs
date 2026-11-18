import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

const { literalCredentialRejection, nonLiteralHeaderName } = await import("../lib/model-test-credentials.ts");
const { runModelConnectionTest } = await import("../lib/model-test-runner.ts");

test("accepts literal keys and rejects shell/env references", () => {
  assert.equal(literalCredentialRejection("sk-literal-key-123"), null);
  assert.equal(literalCredentialRejection("key-with-$-inside"), null);
  assert.equal(literalCredentialRejection("   "), "empty");
  assert.equal(literalCredentialRejection(""), "empty");
  assert.equal(literalCredentialRejection("!op read secret"), "command");
  assert.equal(literalCredentialRejection("$MY_KEY"), "env-reference");
  assert.equal(literalCredentialRejection("${MY_KEY}"), "env-reference");
  assert.equal(literalCredentialRejection("prefix-$$literal"), "env-reference");
});

test("rejects non-literal header values from provider, model, and overrides", () => {
  assert.equal(nonLiteralHeaderName({ headers: { Authorization: "Bearer literal" } }, {}), null);
  assert.equal(nonLiteralHeaderName({ headers: { "X-Token": "$SECRET" } }, {}), "X-Token");
  assert.equal(nonLiteralHeaderName({}, { headers: { "X-Token": "!cmd" } }), "X-Token");
  assert.equal(nonLiteralHeaderName({ modelOverrides: { m: { headers: { "X-A": "${A}" } } } }, {}), "X-A");
});

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve({ body, headers: req.headers }));
  });
}

async function withReceiver(handler, fn) {
  const server = createServer(async (req, res) => {
    const request = await readBody(req);
    handler(request, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const SSE_BODY = [
  `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}`,
  "",
  `data: ${JSON.stringify({ id: "1", object: "chat.completion.chunk", created: 1, model: "test-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}`,
  "",
  "data: [DONE]",
  "",
].join("\n");

test("sends only the literal form key, never stored or environment keys", async () => {
  const previousEnv = process.env.PI_WEB_TEST_MODEL_KEY;
  process.env.PI_WEB_TEST_MODEL_KEY = "env-secret-must-not-be-sent";

  const seen = [];
  try {
    await withReceiver((request, res) => {
      seen.push(request.headers.authorization);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(SSE_BODY);
    }, async (baseUrl) => {
      const result = await runModelConnectionTest({
        providerName: "local-test",
        provider: { baseUrl, api: "openai-completions", apiKey: "literal-form-key" },
        model: { id: "test-model", api: "openai-completions" },
        apiKey: "literal-form-key",
      });
      assert.equal(result.ok, true, result.ok ? "" : result.error);
    });
    assert.deepEqual(seen, ["Bearer literal-form-key"]);
  } finally {
    if (previousEnv === undefined) delete process.env.PI_WEB_TEST_MODEL_KEY;
    else process.env.PI_WEB_TEST_MODEL_KEY = previousEnv;
  }
});

test("a keyless endpoint test sends a placeholder key and never a stored or environment key", async () => {
  const previousEnv = process.env.PI_WEB_TEST_MODEL_KEY;
  process.env.PI_WEB_TEST_MODEL_KEY = "env-value-must-not-be-sent";

  const seen = [];
  try {
    await withReceiver((request, res) => {
      seen.push(request.headers.authorization);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(SSE_BODY);
    }, async (baseUrl) => {
      const result = await runModelConnectionTest({
        providerName: "local-test",
        provider: { baseUrl, api: "openai-completions" },
        model: { id: "test-model", api: "openai-completions" },
        apiKey: "",
        allowNoAuth: true,
      });
      assert.equal(result.ok, true, result.ok ? "" : result.error);
    });
    assert.equal(seen.length, 1);
    assert.match(seen[0], /^Bearer /);
    assert.doesNotMatch(seen[0], /env-value-must-not-be-sent/);
  } finally {
    if (previousEnv === undefined) delete process.env.PI_WEB_TEST_MODEL_KEY;
    else process.env.PI_WEB_TEST_MODEL_KEY = previousEnv;
  }
});