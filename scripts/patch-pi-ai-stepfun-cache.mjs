#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const targets = [
  "node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js",
  "node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/api/openai-completions.js",
];

const replacements = [
  [
    "rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? rawUsage.cached_tokens ?? 0",
    "rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? rawUsage.cached_tokens ?? rawUsage.cached_token ?? 0",
  ],
  [
    "rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? 0",
    "rawUsage.prompt_tokens_details?.cached_tokens ?? rawUsage.prompt_cache_hit_tokens ?? rawUsage.cached_tokens ?? rawUsage.cached_token ?? 0",
  ],
];

let patched = 0;

for (const target of targets) {
  const file = resolve(target);
  if (!existsSync(file)) continue;

  const original = readFileSync(file, "utf8");
  if (replacements.some(([, after]) => original.includes(after))) continue;

  const replacement = replacements.find(([before]) => original.includes(before));
  if (!replacement) {
    console.warn(`pi-web-seeker: skipped pi-ai cache patch; pattern not found in ${target}`);
    continue;
  }

  writeFileSync(file, original.replace(replacement[0], replacement[1]));
  patched += 1;
}

if (patched > 0) {
  console.log(`pi-web-seeker: patched StepFun cached_tokens support in ${patched} pi-ai file(s)`);
}
