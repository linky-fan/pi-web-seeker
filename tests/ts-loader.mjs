import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");

export async function resolve(specifier, context, nextResolve) {
  const candidates = [];
  if (specifier.startsWith("@/")) candidates.push(resolvePath(root, specifier.slice(2)));
  else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    candidates.push(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
  }
  for (const candidate of candidates) {
    for (const suffix of ["", ".ts", ".tsx", ".mjs", "/index.ts"]) {
      const path = `${candidate}${suffix}`;
      if (existsSync(path)) return { url: pathToFileURL(path).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
