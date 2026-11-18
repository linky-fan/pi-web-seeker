import assert from "node:assert/strict";
import test from "node:test";

const { localRequestRejection } = await import("../lib/request-guard.ts");

const loopback = [127, 0, 0, 1].join(".");
const base = {
  method: "POST",
  url: "http://localhost:30141/api/workspaces/trust",
  host: "localhost:30141",
  origin: "http://localhost:30141",
  secFetchSite: "same-origin",
  accessTokenConfigured: false,
};

function request(overrides = {}) {
  return { ...base, ...overrides };
}

test("allows same-origin local browser mutations", () => {
  assert.equal(localRequestRejection(request()), null);
  assert.equal(localRequestRejection(request({
    host: `${loopback}:30141`,
    url: `http://${loopback}:30141/api/workspaces/trust`,
    origin: `http://${loopback}:30141`,
  })), null);
});

test("allows headerless loopback CLI mutations", () => {
  assert.equal(localRequestRejection(request({ origin: null, secFetchSite: null })), null);
});

test("rejects mismatched and opaque origins for mutations", () => {
  assert.equal(localRequestRejection(request({ origin: "https://attacker.example" })), "cross-origin");
  assert.equal(localRequestRejection(request({ origin: "null" })), "cross-origin");
});

test("rejects cross-site fetch metadata even without an Origin header", () => {
  assert.equal(localRequestRejection(request({ origin: null, secFetchSite: "cross-site" })), "cross-site");
});

test("rejects a rebinding host for both reads and mutations", () => {
  assert.equal(localRequestRejection(request({ host: "attacker.example" })), "invalid-host");
  assert.equal(localRequestRejection(request({ method: "GET", host: "attacker.example" })), "invalid-host");
});

test("allows loopback IPv4 and IPv6 hostnames with their own origins", () => {
  for (const hostname of [loopback, "[::1]"]) {
    const authority = `${hostname}:30141`;
    assert.equal(localRequestRejection(request({
      host: authority,
      url: `http://${authority}/api/test`,
      origin: `http://${authority}`,
    })), null);
  }
  assert.equal(localRequestRejection(request({
    host: "localhost:30141",
    url: "http://localhost:30141/api/test",
    origin: "http://localhost",
  })), "cross-origin");
});

test("allows an exact Origin match even when the proxy rewrote the request URL host", () => {
  // Next rewrites req.url to use localhost while forwarding the real Host header.
  assert.equal(localRequestRejection(request({
    host: `127.0.0.1:30141`,
    url: `http://localhost:30141/api/workspaces/trust`,
    origin: `http://127.0.0.1:30141`,
  })), null);
});

test("allows ordinary reads from a local origin without requiring browser metadata", () => {
  assert.equal(localRequestRejection(request({ method: "GET", origin: "https://attacker.example", secFetchSite: "cross-site" })), null);
});

test("leaves token-authenticated reverse proxies to the existing token gate", () => {
  assert.equal(localRequestRejection(request({
    host: "pi-web.example",
    url: "https://pi-web.example/api/test",
    origin: "https://attacker.example",
    secFetchSite: "cross-site",
    accessTokenConfigured: true,
  })), null);
});