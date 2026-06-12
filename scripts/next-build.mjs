import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(projectDir, "node_modules", "next", "dist", "bin", "next");

const forwardedArgs = process.argv.slice(2);
const hasBuilderFlag = forwardedArgs.some((arg) => arg === "--webpack" || arg === "--turbo" || arg === "--turbopack");
const envBuilder = process.env.PI_WEB_BUILD_ENGINE?.toLowerCase();
const envBuilderFlag =
  envBuilder === "webpack" ? "--webpack" :
  envBuilder === "turbo" || envBuilder === "turbopack" ? "--turbo" :
  undefined;
const defaultBuilderFlag = process.platform === "win32" ? "--turbo" : "--webpack";
const builderArgs = hasBuilderFlag ? forwardedArgs : [...forwardedArgs, envBuilderFlag ?? defaultBuilderFlag];

console.log(`pi-web-seeker: running next build ${builderArgs.join(" ")}`);

execFileSync(process.execPath, [nextBin, "build", projectDir, ...builderArgs], {
  cwd: projectDir,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PRIVATE_OUTPUT_TRACE_ROOT: process.env.NEXT_PRIVATE_OUTPUT_TRACE_ROOT || projectDir,
  },
});
