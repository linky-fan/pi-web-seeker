import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const nextBin = join(projectDir, "node_modules", "next", "dist", "bin", "next");

execFileSync(process.execPath, [nextBin, "build", projectDir, "--webpack"], {
  cwd: projectDir,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PRIVATE_OUTPUT_TRACE_ROOT: process.env.NEXT_PRIVATE_OUTPUT_TRACE_ROOT || projectDir,
  },
});
