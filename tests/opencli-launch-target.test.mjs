import assert from "node:assert/strict";
import test from "node:test";
import { win32 } from "node:path";
import {
  OpenCliResolutionError,
  resolveOpenCliLaunchTarget,
} from "../pi-packages/pi-opencli/launch-target.mjs";

function key(path) {
  return win32.normalize(path).toLowerCase();
}

function fakeWindowsFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles).map(([path, value]) => [key(path), String(value)]));
  return {
    exists: (path) => files.has(key(path)),
    readText: (path) => {
      const value = files.get(key(path));
      if (value === undefined) throw new Error(`Missing fixture: ${path}`);
      return value;
    },
    realpath: (path) => win32.normalize(path),
  };
}

function npmInstall(root, bin = "dist/src/main.js", options = {}) {
  const packageDir = win32.join(root, "node_modules", "@jackwener", "opencli");
  const manifest = options.manifest ?? JSON.stringify({ bin: { opencli: bin } });
  return {
    [win32.join(root, "opencli.cmd")]: "npm shim",
    [win32.join(packageDir, "package.json")]: manifest,
    ...(options.omitEntry ? {} : { [win32.resolve(packageDir, bin)]: "entry" }),
  };
}

const nodeExecutable = "C:\\Pi Web\\runtime\\node\\node.exe";

test("resolves a standard Windows npm shim to the package JavaScript entry", () => {
  const appData = "C:\\Users\\Dev User\\AppData\\Roaming";
  const root = win32.join(appData, "npm");
  const target = resolveOpenCliLaunchTarget({
    platform: "win32",
    env: { Path: `${root};C:\\Windows\\System32`, APPDATA: appData },
    nodeExecutable,
    fs: fakeWindowsFs(npmInstall(root)),
  });

  assert.equal(target.command, nodeExecutable);
  assert.deepEqual(target.prefixArgs, [win32.join(root, "node_modules", "@jackwener", "opencli", "dist", "src", "main.js")]);
  assert.equal(target.source, "npm-entry");
});

test("finds the npm package through APPDATA when the service PATH is stale", () => {
  const appData = "C:\\Users\\dev\\AppData\\Roaming";
  const root = win32.join(appData, "npm");
  const target = resolveOpenCliLaunchTarget({
    platform: "win32",
    env: { PATH: "C:\\Windows\\System32", APPDATA: appData },
    nodeExecutable,
    fs: fakeWindowsFs(npmInstall(root)),
  });

  assert.equal(target.source, "npm-entry");
  assert.equal(target.command, nodeExecutable);
});

test("uses NPM_CONFIG_PREFIX for a custom global npm directory", () => {
  const root = "D:\\Tools With Spaces\\npm-global";
  const target = resolveOpenCliLaunchTarget({
    platform: "win32",
    env: { PATH: "C:\\Windows\\System32", NPM_CONFIG_PREFIX: root },
    nodeExecutable,
    fs: fakeWindowsFs(npmInstall(root)),
  });

  assert.equal(target.source, "npm-entry");
  assert.match(target.prefixArgs[0], /Tools With Spaces/);
});

test("prefers PI_WEB_OPENCLI_BIN JavaScript entry over PATH", () => {
  const entry = "D:\\OpenCLI Custom\\main.mjs";
  const native = "C:\\Tools\\opencli.exe";
  const target = resolveOpenCliLaunchTarget({
    platform: "win32",
    env: { PI_WEB_OPENCLI_BIN: `"${entry}"`, PATH: "C:\\Tools" },
    nodeExecutable,
    fs: fakeWindowsFs({ [entry]: "entry", [native]: "binary" }),
  });

  assert.deepEqual(target, {
    command: nodeExecutable,
    prefixArgs: [entry],
    source: "override",
    displayName: "Node.js · OpenCLI",
  });
});

test("resolves an explicit PI_WEB_OPENCLI_BIN npm shim without a shell", () => {
  const root = "D:\\Explicit npm";
  const shim = win32.join(root, "opencli.cmd");
  const target = resolveOpenCliLaunchTarget({
    platform: "win32",
    env: { PI_WEB_OPENCLI_BIN: shim, PATH: "C:\\Windows\\System32" },
    nodeExecutable,
    fs: fakeWindowsFs(npmInstall(root)),
  });

  assert.equal(target.command, nodeExecutable);
  assert.equal(target.source, "override");
  assert.equal(target.prefixArgs.length, 1);
});

test("uses a native Windows executable directly without a shell", () => {
  const executable = "C:\\OpenCLI\\opencli.exe";
  const target = resolveOpenCliLaunchTarget({
    platform: "win32",
    env: { PATH: "C:\\OpenCLI" },
    nodeExecutable,
    fs: fakeWindowsFs({ [executable]: "binary" }),
  });

  assert.deepEqual(target, {
    command: executable,
    prefixArgs: [],
    source: "path-native",
    displayName: "OpenCLI",
  });
});

test("reports an unresolved shim instead of claiming OpenCLI is absent", () => {
  const root = "C:\\Users\\dev\\AppData\\Roaming\\npm";
  assert.throws(
    () => resolveOpenCliLaunchTarget({
      platform: "win32",
      env: { PATH: root },
      nodeExecutable,
      fs: fakeWindowsFs({ [win32.join(root, "opencli.cmd")]: "shim" }),
    }),
    (error) => error instanceof OpenCliResolutionError && error.code === "opencli_windows_shim_unresolved",
  );
});

test("rejects package bin entries that leave the OpenCLI package directory", () => {
  const root = "C:\\npm";
  assert.throws(
    () => resolveOpenCliLaunchTarget({
      platform: "win32",
      env: { PATH: root },
      nodeExecutable,
      fs: fakeWindowsFs(npmInstall(root, "../../outside.js")),
    }),
    (error) => error instanceof OpenCliResolutionError && error.code === "opencli_windows_shim_unresolved",
  );
});

test("reports an unresolved shim for malformed manifests and missing entries", () => {
  const malformedRoot = "C:\\broken-json";
  const missingEntryRoot = "C:\\missing-entry";
  for (const [root, files] of [
    [malformedRoot, npmInstall(malformedRoot, "dist/main.js", { manifest: "{" })],
    [missingEntryRoot, npmInstall(missingEntryRoot, "dist/main.js", { omitEntry: true })],
  ]) {
    assert.throws(
      () => resolveOpenCliLaunchTarget({
        platform: "win32",
        env: { PATH: root },
        nodeExecutable,
        fs: fakeWindowsFs(files),
      }),
      (error) => error instanceof OpenCliResolutionError && error.code === "opencli_windows_shim_unresolved",
    );
  }
});

test("reports a missing command when no override, PATH, or npm root is usable", () => {
  assert.throws(
    () => resolveOpenCliLaunchTarget({
      platform: "win32",
      env: { PATH: "C:\\Windows\\System32" },
      nodeExecutable,
      fs: fakeWindowsFs(),
    }),
    (error) => error instanceof OpenCliResolutionError && error.code === "opencli_not_found",
  );
});

test("keeps the existing POSIX system PATH behavior", () => {
  assert.deepEqual(resolveOpenCliLaunchTarget({ platform: "darwin", env: {}, nodeExecutable: "/usr/bin/node" }), {
    command: "opencli",
    prefixArgs: [],
    source: "system-path",
    displayName: "OpenCLI",
  });
});
