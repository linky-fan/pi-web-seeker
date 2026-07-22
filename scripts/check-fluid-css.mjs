import fs from "node:fs";
import postcss from "postcss";

const fluidPath = new URL("../app/fluid.css", import.meta.url);
const globalsPath = new URL("../app/globals.css", import.meta.url);

function splitSelectors(selector) {
  const result = [];
  let start = 0;
  let depth = 0;
  let quote = "";

  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(" || character === "[") {
      depth += 1;
    } else if (character === ")" || character === "]") {
      depth -= 1;
    } else if (character === "," && depth === 0) {
      result.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(selector.slice(start).trim());
  return result;
}

function normalizeSelector(selector) {
  return selector.replace(/\s+/g, " ").trim();
}

function hasPositiveFluidScope(selector) {
  return selector
    .replace(/:not\(\[data-ui=["']fluid["']\]\)/g, "")
    .includes('[data-ui="fluid"]');
}

function atRuleContext(rule) {
  const context = [];
  for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
    if (parent.type === "atrule") context.unshift(`@${parent.name} ${parent.params}`);
  }
  return context.join(" > ");
}

function isInsideKeyframes(rule) {
  for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
    if (parent.type === "atrule" && parent.name === "keyframes") return true;
  }
  return false;
}

const errors = [];
const fluidRoot = postcss.parse(fs.readFileSync(fluidPath, "utf8"), { from: fluidPath.pathname });
const seen = new Map();

fluidRoot.walkRules((rule) => {
  if (isInsideKeyframes(rule)) return;

  for (const selector of splitSelectors(rule.selector)) {
    if (!hasPositiveFluidScope(selector)) {
      errors.push(`${fluidPath.pathname}:${rule.source.start.line} is not Fluid-scoped: ${selector}`);
    }
  }

  const key = `${atRuleContext(rule)} || ${normalizeSelector(rule.selector)}`;
  const previousLine = seen.get(key);
  if (previousLine) {
    errors.push(`${fluidPath.pathname}:${rule.source.start.line} duplicates selector from line ${previousLine}: ${normalizeSelector(rule.selector)}`);
  } else {
    seen.set(key, rule.source.start.line);
  }
});

const globalsRoot = postcss.parse(fs.readFileSync(globalsPath, "utf8"), { from: globalsPath.pathname });
globalsRoot.walkRules((rule) => {
  if (isInsideKeyframes(rule)) return;
  for (const selector of splitSelectors(rule.selector)) {
    if (hasPositiveFluidScope(selector) || selector.includes(".pi-fluid-")) {
      errors.push(`${globalsPath.pathname}:${rule.source.start.line} contains a Fluid-only selector: ${selector}`);
    }
  }
});

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Fluid CSS check passed (${seen.size} scoped selector contexts).`);
}
