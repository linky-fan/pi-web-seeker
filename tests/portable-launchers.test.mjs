import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assertNetworkAccessConfigured } from "../scripts/network-security.cjs";
import { PORTABLE_SCRIPTS, writeLaunchers, writePortableReadme } from "../scripts/release/pack-portable.mjs";

test("portable launchers default to localhost and document token-gated LAN access", async (t) => {
  assert.ok(PORTABLE_SCRIPTS.includes("scripts/network-security.cjs"));
  for (const platform of ["win32", "darwin"]) {
    const outputDir = mkdtempSync(path.join(tmpdir(), "pi-web-portable-launcher-"));
    t.after(() => rmSync(outputDir, { recursive: true, force: true }));

    await writeLaunchers(outputDir, { platform });
    const launcherNames = platform === "win32"
      ? ["start-pi-web.cmd", "start-pi-web.ps1"]
      : ["start-pi-web.command"];
    for (const launcherName of launcherNames) {
      const launcher = readFileSync(path.join(outputDir, launcherName), "utf8");
      assert.match(launcher, /PI_WEB_BIND_HOST(?:=|\s*=|:=)\s*["']?localhost/);
      assert.doesNotMatch(launcher, /PI_WEB_BIND_HOST=.*(?:0\.0\.0\.0|\[\[IP_ADDRESS_2\]\])/);
    }

    await writePortableReadme(outputDir, { version: "0.0.0-test" }, {
      platform,
      arch: "x64",
      nodeVersion: "24.18.0",
    });
    const readme = readFileSync(path.join(outputDir, "README-PORTABLE.txt"), "utf8");
    assert.match(readme, /starts Pi Web Seeker on http:\/\/localhost:30141/);
    assert.match(readme, /set both PI_WEB_BIND_HOST and PI_WEB_ACCESS_TOKEN/);
    assert.doesNotThrow(() => assertNetworkAccessConfigured("localhost"));
    assert.throws(() => assertNetworkAccessConfigured([192, 0, 2, 4].join(".")), /PI_WEB_ACCESS_TOKEN is required/);
  }
});
