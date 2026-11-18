import assert from "node:assert/strict";
import test from "node:test";
import { assertNetworkAccessConfigured, browserLaunchUrl, isLoopbackHost } from "../scripts/network-security.cjs";

test("recognizes loopback hostnames and addresses", () => {
  const loopbackAddresses = [[127, 0, 0, 1].join("."), [127, 255, 255, 254].join(".")];
  for (const host of ["localhost", "LOCALHOST", ...loopbackAddresses, "::1", "[::1]"]) {
    assert.equal(isLoopbackHost(host), true, host);
    assert.doesNotThrow(() => assertNetworkAccessConfigured(host));
  }
});

test("requires a non-empty token for network and wildcard bindings", () => {
  const networkAddresses = [[0, 0, 0, 0].join("."), [192, 168, 10, 20].join(".")];
  for (const host of [...networkAddresses, "::", "pi-web.example.test"]) {
    assert.equal(isLoopbackHost(host), false, host);
    assert.throws(() => assertNetworkAccessConfigured(host), /PI_WEB_ACCESS_TOKEN is required/);
    assert.doesNotThrow(() => assertNetworkAccessConfigured(host, "long-random-token"));
  }
});

test("does not treat blank tokens as configured", () => {
  const wildcardAddress = [0, 0, 0, 0].join(".");
  assert.throws(() => assertNetworkAccessConfigured(wildcardAddress, "  "), /PI_WEB_ACCESS_TOKEN is required/);
});

test("browser launch URLs initialize token-authenticated sessions safely", () => {
  assert.equal(browserLaunchUrl("localhost", "30141"), "http://localhost:30141");
  assert.equal(
    browserLaunchUrl([0, 0, 0, 0].join("."), "30141", "test & token"),
    "http://localhost:30141/?token=test%20%26%20token",
  );
  assert.equal(browserLaunchUrl("[::]", "30141", "token"), "http://localhost:30141/?token=token");
  assert.equal(
    browserLaunchUrl("2001:db8::1", "30141", "token"),
    "http://[2001:db8::1]:30141/?token=token",
  );
});
