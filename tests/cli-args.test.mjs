import assert from "node:assert/strict";
import test from "node:test";

const { isSafeCliArgument, isSafePackageSpec, isSafeTemplateName } = await import("../lib/cli-args.ts");

test("rejects values that would be read as command-line options", () => {
  assert.equal(isSafeCliArgument("-g"), false);
  assert.equal(isSafeCliArgument("--force"), false);
  assert.equal(isSafeCliArgument(""), false);
  assert.equal(isSafeCliArgument("react"), true);
  assert.equal(isSafeCliArgument("nginx config"), true);
});

test("rejects control characters in arguments", () => {
  assert.equal(isSafeCliArgument("a\u0000b"), false);
  assert.equal(isSafeCliArgument("a\nb"), false);
});

test("accepts ordinary skills package specs", () => {
  assert.equal(isSafePackageSpec("owner/repo@skill"), true);
  assert.equal(isSafePackageSpec("@scope/repo@skill"), true);
  assert.equal(isSafePackageSpec("react"), true);
  assert.equal(isSafePackageSpec("github:owner/repo"), true);
});

test("rejects option-like or malformed package specs", () => {
  assert.equal(isSafePackageSpec("-g"), false);
  assert.equal(isSafePackageSpec("--registry=http://evil"), false);
  assert.equal(isSafePackageSpec("owner/repo; rm -rf /"), false);
  assert.equal(isSafePackageSpec("a".repeat(201)), false);
  assert.equal(isSafePackageSpec(""), false);
});

test("template names must be a plain identifier", () => {
  for (const name of ["standard", "next-app", "auto_v2", "a.b"]) {
    assert.equal(isSafeTemplateName(name), true, name);
  }
  for (const name of ["../secrets", "a/b", "/abs", "-x", "", ".hidden", "a".repeat(65)]) {
    assert.equal(isSafeTemplateName(name), false, name);
  }
});